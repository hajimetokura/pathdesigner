"""BREP Import Node — STEP file analysis using build123d."""

from pathlib import Path

from build123d import Axis, GeomType, Solid, import_step

from schemas import (
    BoundingBox,
    BrepImportResult,
    BrepObject,
    FacesAnalysis,
    Origin,
)


def analyze_step_file(filepath: str | Path, file_name: str) -> BrepImportResult:
    """Import a STEP file and analyze each solid for CNC machining."""
    compound = import_step(str(filepath))
    solids = compound.solids()

    if not solids:
        raise ValueError("STEP file contains no solid objects")

    objects = [
        _analyze_solid(solid, index=i, file_name=file_name)
        for i, solid in enumerate(solids)
    ]
    return BrepImportResult(objects=objects, object_count=len(objects))


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
