"""BREP Import Node — STEP file analysis using build123d."""

from pathlib import Path

from build123d import Axis, GeomType, Plane, ShapeList, Solid, import_step

from nodes.geometry_utils import sample_wire_coords
from schemas import (
    BoundingBox,
    BrepObject,
    FacesAnalysis,
    Origin,
)


def analyze_step_file(filepath: str | Path, file_name: str) -> list[BrepObject]:
    """Import a STEP file and analyze each solid for CNC machining."""
    compound = import_step(str(filepath))
    solids = compound.solids()

    if not solids:
        raise ValueError("STEP file contains no solid objects")

    return [
        _analyze_solid(solid, index=i, file_name=file_name)
        for i, solid in enumerate(solids)
    ]


def _analyze_solid(solid: Solid, index: int, file_name: str) -> BrepObject:
    """Analyze a single Solid for CNC machining properties."""
    bb = solid.bounding_box()

    all_faces = solid.faces()
    planar_faces = all_faces.filter_by(GeomType.PLANE)
    freeform_faces = all_faces.filter_by(GeomType.BSPLINE)

    is_closed = solid.is_manifold
    is_planar = _check_is_planar(all_faces)
    machining_type = _determine_machining_type(all_faces, freeform_faces, is_planar)

    # Top/bottom face analysis (Z-axis sorted)
    sorted_by_z = planar_faces.sort_by(Axis.Z) if planar_faces else []
    top_features, bottom_features = _analyze_top_bottom(sorted_by_z, bb)

    # Extract bottom-face outline (relative to BB min)
    outline = _extract_outline(solid, bb)

    return BrepObject(
        object_id=f"obj_{index + 1:03d}",
        file_name=file_name,
        bounding_box=BoundingBox(x=bb.size.X, y=bb.size.Y, z=bb.size.Z),
        thickness=bb.size.Z,
        origin=Origin(
            position=[bb.min.X, bb.min.Y, bb.min.Z],
            reference="bounding_box_min",
            description="Bounding box minimum corner",
        ),
        unit="mm",
        is_closed=is_closed,
        is_planar=is_planar,
        machining_type=machining_type,
        faces_analysis=FacesAnalysis(
            top_features=top_features,
            bottom_features=bottom_features,
            freeform_surfaces=len(freeform_faces) > 0,
        ),
        outline=outline,
    )


def _check_is_planar(all_faces) -> bool:
    """Check if the shape is essentially planar (suitable for 2D CNC)."""
    for face in all_faces:
        geom = face.geom_type
        if geom in (GeomType.BSPLINE, GeomType.BEZIER, GeomType.REVOLUTION):
            return False
    return True


def _determine_machining_type(all_faces, freeform_faces, is_planar: bool) -> str:
    """Determine machining type: 2d / 2.5d / double_sided / 3d."""
    if len(freeform_faces) > 0:
        return "3d"

    if is_planar:
        return "2d"

    # Has cylinders/cones but no freeform → 2.5d (pockets, holes, chamfers)
    return "2.5d"


def _analyze_top_bottom(sorted_planar_faces, bb) -> tuple[bool, bool]:
    """Check if there are features on top/bottom faces beyond a flat plane."""
    if not sorted_planar_faces:
        return False, False

    tolerance = 0.1
    bb_min_z = bb.min.Z
    bb_max_z = bb.max.Z

    bottom_faces = [f for f in sorted_planar_faces if abs(f.center().Z - bb_min_z) < tolerance]
    top_faces = [f for f in sorted_planar_faces if abs(f.center().Z - bb_max_z) < tolerance]

    # Multiple faces at top/bottom level indicates features (pockets, steps, etc.)
    top_features = len(top_faces) > 1
    bottom_features = len(bottom_faces) > 1

    return top_features, bottom_features


def _extract_outline(solid: Solid, bb) -> list[list[float]]:
    """Extract bottom-face outline as 2D coords relative to BB min.

    Slices the solid at Z=bb.min.Z and samples the largest wire.
    Returns [[x, y], ...] with origin at (bb.min.X, bb.min.Y).
    Falls back to empty list on failure (non-critical for import).
    """
    try:
        wires = _intersect_wires(solid, bb.min.Z)
        if not wires:
            wires = _intersect_wires(solid, bb.min.Z + 0.001)
        if not wires:
            return []

        # Use the longest wire (outer boundary)
        longest = max(wires, key=lambda w: w.length)
        coords = sample_wire_coords(longest)

        # Translate to BB-min-relative coordinates
        ox, oy = bb.min.X, bb.min.Y
        return [[round(x - ox, 4), round(y - oy, 4)] for x, y in coords]
    except Exception:
        return []


def _intersect_wires(solid: Solid, z: float) -> list:
    """Intersect solid with XY plane at z and return wires."""
    plane = Plane.XY.offset(z)
    result = solid.intersect(plane)
    if result is None:
        return []
    if isinstance(result, ShapeList):
        items = list(result)
    else:
        items = [result]
    wires = []
    for item in items:
        if hasattr(item, "outer_wire"):
            wires.append(item.outer_wire())
            wires.extend(item.inner_wires())
        elif hasattr(item, "edges"):
            wires.append(item)
    return wires


