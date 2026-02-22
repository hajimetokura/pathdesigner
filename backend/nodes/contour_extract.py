"""Contour Extract Node — slice BREP at Z=0 and extract 2D contours."""

from pathlib import Path

from build123d import Plane, ShapeList, Solid, import_step
from shapely.geometry import Polygon

from schemas import Contour, ContourExtractResult, OffsetApplied

# Tolerance for Z=0 section retry
SECTION_Z_RETRY_OFFSET = 0.001


def extract_contours(
    step_path: str | Path,
    object_id: str,
    tool_diameter: float = 6.35,
    offset_side: str = "outside",
) -> ContourExtractResult:
    """Extract 2D contours from a STEP file by sectioning at Z=0."""
    compound = import_step(str(step_path))
    solids = compound.solids()
    if not solids:
        raise ValueError("STEP file contains no solids")

    # Use the first solid (multi-object selection by object_id is future work)
    solid = solids[0]
    bb = solid.bounding_box()

    # Section at bottom face (Z = bb.min.Z)
    slice_z = bb.min.Z
    wires = _section_at_z(solid, slice_z)

    # Convert wires to shapely polygons
    raw_contours = _wires_to_polygons(wires)

    # Apply offset
    offset_distance = tool_diameter / 2.0
    if offset_side == "none" or offset_distance == 0:
        offset_contours = raw_contours
        applied_distance = 0.0
        applied_side = "none"
    else:
        offset_contours = _apply_offset(raw_contours, offset_distance, offset_side)
        applied_distance = offset_distance
        applied_side = offset_side

    # Convert to output schema
    contours = []
    for i, poly in enumerate(offset_contours):
        coords = _polygon_to_coords(poly)
        contours.append(
            Contour(
                id=f"contour_{i + 1:03d}",
                type="exterior",
                coords=coords,
                closed=True,
            )
        )

    thickness = round(bb.max.Z - bb.min.Z, 6)

    return ContourExtractResult(
        object_id=object_id,
        slice_z=round(slice_z, 6),
        thickness=thickness,
        contours=contours,
        offset_applied=OffsetApplied(distance=applied_distance, side=applied_side),
    )


def _section_at_z(solid: Solid, z: float) -> list:
    """Section a solid at given Z height using intersect. Retries with small offset if empty."""
    wires = _intersect_wires(solid, z)

    if not wires:
        # Retry with small offset (tolerance issue at exact boundary)
        wires = _intersect_wires(solid, z + SECTION_Z_RETRY_OFFSET)

    if not wires:
        raise ValueError(f"No cross-section found at Z={z}")

    return wires


def _intersect_wires(solid: Solid, z: float) -> list:
    """Intersect solid with XY plane at z and return wires."""
    plane = Plane.XY.offset(z)
    result = solid.intersect(plane)
    if result is None:
        return []
    # Result can be Face, Wire, or ShapeList
    if isinstance(result, ShapeList):
        items = list(result)
    else:
        items = [result]
    wires = []
    for item in items:
        if hasattr(item, "outer_wire"):
            # It's a Face — extract wires
            wires.append(item.outer_wire())
            wires.extend(item.inner_wires())
        elif hasattr(item, "edges"):
            # It's a Wire
            wires.append(item)
    return wires


def _wires_to_polygons(wires) -> list[Polygon]:
    """Convert build123d wires to shapely Polygons."""
    polygons = []
    for wire in wires:
        vertices = wire.vertices()
        if len(vertices) < 3:
            continue
        # Use the wire's edge sampling for smoother curves
        coords = _sample_wire_coords(wire)
        poly = Polygon(coords)
        if poly.is_valid and not poly.is_empty:
            polygons.append(poly)
    return polygons


def _sample_wire_coords(wire, num_points: int = 100) -> list[tuple[float, float]]:
    """Sample evenly-spaced points along a wire for accurate representation."""
    edges = wire.edges()
    coords = []
    for edge in edges:
        # Sample points along each edge
        length = edge.length
        if length < 0.001:
            continue
        n = max(2, int(num_points * length / wire.length))
        for i in range(n):
            t = i / n
            pt = edge.position_at(t)
            coords.append((round(pt.X, 6), round(pt.Y, 6)))
    # Close the polygon
    if coords and coords[0] != coords[-1]:
        coords.append(coords[0])
    return coords


def _apply_offset(
    polygons: list[Polygon], distance: float, side: str
) -> list[Polygon]:
    """Apply offset to polygons. outside=expand, inside=shrink."""
    result = []
    for poly in polygons:
        d = distance if side == "outside" else -distance
        buffered = poly.buffer(d, join_style="mitre")
        if not buffered.is_empty:
            result.append(buffered)
    return result


def _polygon_to_coords(poly: Polygon) -> list[list[float]]:
    """Convert a shapely Polygon exterior to [[x, y], ...] coordinate list."""
    return [[round(x, 4), round(y, 4)] for x, y in poly.exterior.coords]
