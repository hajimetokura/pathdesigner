"""Operation Detector — analyze BREP and detect required machining operations."""

import math
from pathlib import Path

from build123d import GeomType, Plane, ShapeList, Solid, import_step

from nodes.contour_extract import extract_contours
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
                # Drill: single center point as contour
                cx = round(feature["center_x"] - bb.min.X, 4)
                cy = round(feature["center_y"] - bb.min.Y, 4)
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
    """Analyze solid for cylindrical features (holes, pockets)."""
    features = []
    tolerance = 0.1

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

    return features


def _classify_feature(feature: dict, tool_diameter: float) -> str | None:
    """Classify a feature as drill, pocket, or None (skip → handled as contour)."""
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
    """Extract the contour of a pocket at the given Z level."""
    from shapely.geometry import Point

    # Create a circular contour from the feature data
    cx = round(feature["center_x"] - bb.min.X, 4)
    cy = round(feature["center_y"] - bb.min.Y, 4)
    radius = feature["radius"]

    # Generate circular polygon coords
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
