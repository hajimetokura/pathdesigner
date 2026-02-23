"""Contour Extract Node — slice BREP at Z=0 and extract 2D contours."""

import math
from pathlib import Path

from build123d import Solid, import_step
from shapely.geometry import Polygon

from nodes.geometry_utils import intersect_solid_at_z, sample_wire_coords
from schemas import Contour, ContourExtractResult, OffsetApplied

# Tolerance for Z=0 section retry
SECTION_Z_RETRY_OFFSET = 0.001


def extract_contours(
    step_path: str | Path,
    object_id: str,
    tool_diameter: float = 6.35,
    offset_side: str = "outside",
    solid: Solid | None = None,
) -> ContourExtractResult:
    """Extract 2D contours from a STEP file by sectioning at Z=0.

    If *solid* is provided, it is used directly and the STEP file is not re-imported.
    """
    if solid is None:
        compound = import_step(str(step_path))
        solids = compound.solids()
        if not solids:
            raise ValueError("STEP file contains no solids")

        # Map object_id (e.g. "obj_002") to solid index
        try:
            idx = int(object_id.split("_")[1]) - 1
        except (IndexError, ValueError):
            raise ValueError(f"Invalid object_id format: {object_id!r}")
        if idx < 0 or idx >= len(solids):
            raise ValueError(
                f"object_id {object_id!r} out of range (file has {len(solids)} solids)"
            )
        solid = solids[idx]
    bb = solid.bounding_box()

    # Section at bottom face (Z = bb.min.Z)
    slice_z = bb.min.Z
    typed_wires = _section_at_z(solid, slice_z)

    # Convert wires to shapely polygons with type info
    typed_polygons = _wires_to_polygons(typed_wires)

    # Apply offset and filter
    offset_distance = tool_diameter / 2.0
    min_hole_area = math.pi * (tool_diameter / 2) ** 2

    if offset_side == "none" or offset_distance == 0:
        applied_distance = 0.0
        applied_side = "none"
    else:
        applied_distance = offset_distance
        applied_side = offset_side

    # Convert to output schema
    contours = []
    for poly, contour_type in typed_polygons:
        # Filter: interior contours smaller than tool can reach
        if contour_type == "interior" and poly.area < min_hole_area:
            continue

        # Apply offset: exterior → expand outward, interior → shrink inward
        if applied_distance > 0:
            if contour_type == "exterior":
                d = applied_distance if offset_side == "outside" else -applied_distance
            else:
                # Interior: offset inward (negative buffer to shrink the hole path)
                d = -applied_distance if offset_side == "outside" else applied_distance
            buffered = poly.buffer(d, join_style="mitre")
            if buffered.is_empty:
                continue
            poly = buffered

        coords = _polygon_to_coords(poly)
        contours.append(
            Contour(
                id=f"contour_{len(contours) + 1:03d}",
                type=contour_type,
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
    wires = intersect_solid_at_z(solid, z)

    if not wires:
        # Retry with small offset (tolerance issue at exact boundary)
        wires = intersect_solid_at_z(solid, z + SECTION_Z_RETRY_OFFSET)

    if not wires:
        raise ValueError(f"No cross-section found at Z={z}")

    return wires


def _wires_to_polygons(typed_wires: list[tuple]) -> list[tuple[Polygon, str]]:
    """Convert build123d (wire, contour_type) tuples to (Polygon, contour_type) tuples."""
    polygons = []
    for wire, contour_type in typed_wires:
        edges = wire.edges()
        if not edges:
            continue
        # Use the wire's edge sampling for smoother curves
        coords = sample_wire_coords(wire)
        poly = Polygon(coords)
        if poly.is_valid and not poly.is_empty:
            polygons.append((poly, contour_type))
    return polygons



def _polygon_to_coords(poly: Polygon) -> list[list[float]]:
    """Convert a shapely Polygon exterior to [[x, y], ...] coordinate list."""
    return [[round(x, 4), round(y, 4)] for x, y in poly.exterior.coords]
