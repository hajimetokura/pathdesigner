"""Mesh Import Node — STL/OBJ file analysis using trimesh."""

from pathlib import Path

import trimesh

from schemas import BoundingBox, BrepObject, FacesAnalysis, Origin


def analyze_mesh_file(filepath: str | Path, file_name: str) -> list[BrepObject]:
    """Import a mesh file (STL/OBJ) and analyze for CNC machining.

    Unlike BREP import, mesh files lack topological info (face types, edges).
    All meshes are classified as machining_type="3d".
    """
    mesh = trimesh.load(str(filepath), force="mesh")

    if not isinstance(mesh, trimesh.Trimesh):
        raise ValueError(f"File does not contain a valid mesh: {file_name}")

    bounds = mesh.bounds  # [[min_x, min_y, min_z], [max_x, max_y, max_z]]
    bb_min = bounds[0]
    bb_max = bounds[1]
    size = bb_max - bb_min

    return [
        BrepObject(
            object_id="obj_001",
            file_name=file_name,
            bounding_box=BoundingBox(
                x=round(float(size[0]), 4),
                y=round(float(size[1]), 4),
                z=round(float(size[2]), 4),
            ),
            thickness=round(float(size[2]), 4),
            origin=Origin(
                position=[round(float(bb_min[0]), 4), round(float(bb_min[1]), 4), round(float(bb_min[2]), 4)],
                reference="bounding_box_min",
                description="Mesh bounding box minimum",
            ),
            unit="mm",
            is_closed=bool(mesh.is_watertight),
            is_planar=False,
            machining_type="3d",
            faces_analysis=FacesAnalysis(
                top_features=False,
                bottom_features=False,
                freeform_surfaces=True,
            ),
            outline=[],
        )
    ]
