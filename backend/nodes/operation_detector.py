"""Operation Detector — analyze BREP and detect required machining operations."""

import math
from pathlib import Path

from build123d import GeomType, Plane, ShapeList, Solid, import_step

from nodes.contour_extract import extract_contours
from nodes.geometry_utils import sample_wire_coords
from schemas import (
    Contour,
    DetectedOperation,
    FeedRate,
    MachiningSettings,
    OffsetApplied,
    OperationDetectResult,
    OperationGeometry,
    TabSettings,
    Tool,
)

# Default suggested settings per operation type
_DEFAULT_CONTOUR_SETTINGS = dict(
    operation_type="contour",
    tool=Tool(diameter=6.35, type="endmill", flutes=2),
    feed_rate=FeedRate(xy=75, z=25),
    jog_speed=200,
    spindle_speed=18000,
    depth_per_pass=6.0,
    total_depth=18.0,
    direction="climb",
    offset_side="outside",
    tabs=TabSettings(enabled=True, height=8, width=5, count=4),
)

_DEFAULT_POCKET_SETTINGS = dict(
    operation_type="pocket",
    tool=Tool(diameter=6.35, type="endmill", flutes=2),
    feed_rate=FeedRate(xy=60, z=20),
    jog_speed=200,
    spindle_speed=18000,
    depth_per_pass=3.0,
    total_depth=6.0,
    direction="climb",
    offset_side="none",
    tabs=TabSettings(enabled=False, height=0, width=0, count=0),
)

_DEFAULT_DRILL_SETTINGS = dict(
    operation_type="drill",
    tool=Tool(diameter=6.35, type="endmill", flutes=2),
    feed_rate=FeedRate(xy=75, z=15),
    jog_speed=200,
    spindle_speed=18000,
    depth_per_pass=6.0,
    total_depth=10.0,
    direction="climb",
    offset_side="none",
    tabs=TabSettings(enabled=False, height=0, width=0, count=0),
)


def detect_operations(
    step_path: str | Path,
    file_id: str,
    object_ids: list[str],
    tool_diameter: float = 6.35,
    offset_side: str = "outside",
) -> OperationDetectResult:
    """Detect machining operations from BREP geometry.

    Detects contour, pocket, and drill operations by analyzing the solid's
    cylindrical faces and planar features.
    """
    compound = import_step(str(step_path))
    solids = compound.solids()
    operations: list[DetectedOperation] = []
    op_counter = 0

    for object_id in object_ids:
        # Parse object index
        try:
            idx = int(object_id.split("_")[1]) - 1
        except (IndexError, ValueError):
            continue
        if idx < 0 or idx >= len(solids):
            continue

        solid = solids[idx]
        bb = solid.bounding_box()
        thickness = round(bb.max.Z - bb.min.Z, 6)

        # 1. Analyze features (cylindrical faces → drill / pocket candidates)
        features = _analyze_features(solid, bb)

        # 2. Classify each feature and create operations
        for feature in features:
            op_type = _classify_feature(feature, tool_diameter)
            op_counter += 1

            if op_type == "drill":
                # Drill: single center point as contour (world coords)
                cx = round(feature["center_x"], 4)
                cy = round(feature["center_y"], 4)
                contour = Contour(
                    id=f"contour_{op_counter:03d}",
                    type="drill_center",
                    coords=[[cx, cy]],
                    closed=False,
                )
                suggested = MachiningSettings(
                    **{
                        **_DEFAULT_DRILL_SETTINGS,
                        "total_depth": feature["depth"],
                    }
                )
                if tool_diameter != 6.35:
                    suggested = suggested.model_copy(
                        update={"tool": Tool(diameter=tool_diameter, type="endmill", flutes=2)}
                    )
                operations.append(
                    DetectedOperation(
                        operation_id=f"op_{op_counter:03d}",
                        object_id=object_id,
                        operation_type="drill",
                        geometry=OperationGeometry(
                            contours=[contour],
                            offset_applied=OffsetApplied(distance=0, side="none"),
                            depth=feature["depth"],
                        ),
                        suggested_settings=suggested,
                    )
                )

            elif op_type == "pocket":
                # Pocket: extract contour at pocket bottom Z
                if feature["type"] == "planar_pocket":
                    pocket_z = bb.max.Z - feature["depth"]
                else:
                    pocket_z = bb.min.Z + (thickness - feature["depth"])
                pocket_contour = _extract_pocket_contour(
                    solid, pocket_z, bb, feature, op_counter
                )
                if pocket_contour is None:
                    continue

                suggested = MachiningSettings(
                    **{
                        **_DEFAULT_POCKET_SETTINGS,
                        "total_depth": feature["depth"],
                    }
                )
                if tool_diameter != 6.35:
                    suggested = suggested.model_copy(
                        update={"tool": Tool(diameter=tool_diameter, type="endmill", flutes=2)}
                    )
                operations.append(
                    DetectedOperation(
                        operation_id=f"op_{op_counter:03d}",
                        object_id=object_id,
                        operation_type="pocket",
                        geometry=OperationGeometry(
                            contours=[pocket_contour],
                            offset_applied=OffsetApplied(distance=0, side="none"),
                            depth=feature["depth"],
                        ),
                        suggested_settings=suggested,
                    )
                )

        # 3. Always add contour operation for the exterior outline
        contour_result = extract_contours(
            step_path=step_path,
            object_id=object_id,
            tool_diameter=tool_diameter,
            offset_side=offset_side,
        )
        op_counter += 1
        suggested = MachiningSettings(
            **{**_DEFAULT_CONTOUR_SETTINGS, "total_depth": thickness}
        )
        if tool_diameter != 6.35:
            suggested = suggested.model_copy(
                update={"tool": Tool(diameter=tool_diameter, type="endmill", flutes=2)}
            )
        operations.append(
            DetectedOperation(
                operation_id=f"op_{op_counter:03d}",
                object_id=object_id,
                operation_type="contour",
                geometry=OperationGeometry(
                    contours=contour_result.contours,
                    offset_applied=contour_result.offset_applied,
                    depth=thickness,
                ),
                suggested_settings=suggested,
            )
        )

    return OperationDetectResult(operations=operations)


def _analyze_features(solid: Solid, bb) -> list[dict]:
    """Analyze solid for cylindrical features and planar pockets.

    Cylindrical features are detected from CYLINDER faces.
    Planar pockets are detected by comparing cross-sections at different Z levels:
    if the top cross-section is smaller than the bottom, the difference is a pocket.
    """
    features = []
    tolerance = 0.1
    top_z = bb.max.Z
    bot_z = bb.min.Z

    # 1. Cylindrical features (holes, round pockets)
    for face in solid.faces():
        if face.geom_type != GeomType.CYLINDER:
            continue

        radius = face.radius
        center = face.center()
        fb = face.bounding_box()
        depth = round(fb.max.Z - fb.min.Z, 4)
        is_through = abs(depth - bb.size.Z) < tolerance

        features.append({
            "type": "cylindrical",
            "radius": radius,
            "depth": depth,
            "is_through": is_through,
            "center_x": center.X,
            "center_y": center.Y,
            "center_z": center.Z,
        })

    # 2. Planar pocket detection via cross-section area comparison
    #    Skip if cylindrical pockets already found (they handle those regions)
    has_cylindrical_pocket = any(
        f["type"] == "cylindrical" and not f["is_through"] for f in features
    )
    if not has_cylindrical_pocket:
        features.extend(_detect_planar_pockets(solid, bb, top_z, bot_z, tolerance))

    return features


def _detect_planar_pockets(
    solid: Solid, bb, top_z: float, bot_z: float, tolerance: float
) -> list[dict]:
    """Detect planar pockets by comparing cross-sections at each Z level.

    Scans from top to bottom. At each intermediate Z where cross-section area
    increases, the new region is a pocket at that depth. This handles multi-level
    (nested) pockets by detecting each level independently.
    """
    features: list[dict] = []

    # Collect horizontal PLANE face Z levels as candidate pocket boundaries
    z_levels: list[float] = []
    for face in solid.faces():
        if face.geom_type != GeomType.PLANE:
            continue
        fb = face.bounding_box()
        if fb.size.Z > tolerance:
            continue  # skip vertical
        cz = round(face.center().Z, 2)
        if abs(cz - round(top_z, 2)) < tolerance or abs(cz - round(bot_z, 2)) < tolerance:
            continue
        z_levels.append(cz)

    if not z_levels:
        # No intermediate horizontal faces — try top vs bottom comparison
        z_levels = [bot_z + (top_z - bot_z) / 2]

    # Sort descending (scan from top down) and deduplicate
    z_levels = sorted(set(z_levels), reverse=True)

    # Slice at top to get reference cross-section
    prev_poly = _slice_to_shapely(solid, top_z - 0.01, bb)
    if prev_poly is None:
        return features

    for z in z_levels:
        curr_poly = _slice_to_shapely(solid, z - 0.01, bb)
        if curr_poly is None:
            continue

        new_region = curr_poly.difference(prev_poly)
        if new_region.is_empty or new_region.area < 10:
            prev_poly = curr_poly
            continue

        depth = round(top_z - z, 4)
        if depth <= 0:
            prev_poly = curr_poly
            continue

        # Split MultiPolygon into individual pocket features
        if new_region.geom_type == "MultiPolygon":
            polys = list(new_region.geoms)
        else:
            polys = [new_region]

        for poly in polys:
            if poly.area < 10:
                continue
            features.append({
                "type": "planar_pocket",
                "depth": depth,
                "area": round(poly.area, 2),
                "shapely_polygon": poly,
            })

        prev_poly = curr_poly

    return features


def _classify_feature(feature: dict, tool_diameter: float) -> str | None:
    """Classify a feature as drill, pocket, or None (skip → handled as contour)."""
    if feature["type"] == "planar_pocket":
        return "pocket"

    if feature["type"] != "cylindrical":
        return None

    diameter = feature["radius"] * 2

    if feature["is_through"]:
        # Through-hole: drill if small enough, otherwise handled by contour extraction
        if diameter <= tool_diameter * 2:
            return "drill"
        return None  # Large through-hole → contour interior handles it
    else:
        # Blind cavity → pocket
        return "pocket"


def _extract_pocket_contour(
    solid: Solid, z: float, bb, feature: dict, counter: int
) -> Contour | None:
    """Extract the contour of a pocket at the given Z level.

    For cylindrical features, generates a circular contour.
    For planar pockets, uses cross-section difference to find pocket boundary.
    """
    if feature["type"] == "planar_pocket":
        return _extract_planar_pocket_contour_diff(solid, bb, feature, counter)

    # Cylindrical: generate circular contour from feature data (world coords)
    cx = round(feature["center_x"], 4)
    cy = round(feature["center_y"], 4)
    radius = feature["radius"]

    n_points = 64
    coords = []
    for i in range(n_points + 1):
        angle = 2 * math.pi * i / n_points
        x = round(cx + radius * math.cos(angle), 4)
        y = round(cy + radius * math.sin(angle), 4)
        coords.append([x, y])

    return Contour(
        id=f"contour_{counter:03d}",
        type="pocket",
        coords=coords,
        closed=True,
    )


def _slice_to_shapely(solid: Solid, z: float, bb):
    """Slice solid at Z and return a Shapely polygon (origin-offset)."""
    from build123d import Face as B3dFace
    from shapely.geometry import Polygon
    from shapely.ops import unary_union

    plane = Plane(origin=(0, 0, z), z_dir=(0, 0, 1))
    result = solid.intersect(plane)
    if result is None:
        return None

    faces = [result] if isinstance(result, B3dFace) else list(result)
    polys = []
    for face in faces:
        outer_coords = sample_wire_coords(face.outer_wire(), mode="resolution", resolution=2.0, precision=4)
        if len(outer_coords) < 3:
            continue
        holes = []
        for iw in face.inner_wires():
            hole_coords = sample_wire_coords(iw, mode="resolution", resolution=2.0, precision=4)
            if len(hole_coords) >= 3:
                holes.append(hole_coords)
        poly = Polygon(outer_coords, holes)
        if poly.is_valid and poly.area > 0:
            polys.append(poly)

    if not polys:
        return None
    return unary_union(polys)




def _extract_planar_pocket_contour_diff(
    solid: Solid, bb, feature: dict, counter: int
) -> Contour | None:
    """Extract pocket contour from pre-computed Shapely polygon."""
    poly = feature.get("shapely_polygon")
    if poly is None or poly.is_empty:
        return None

    coords = [[round(x, 4), round(y, 4)] for x, y in poly.exterior.coords]

    return Contour(
        id=f"contour_{counter:03d}",
        type="pocket",
        coords=coords,
        closed=True,
    )


