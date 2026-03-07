"""Mesh export — tessellate STEP solids for 3D preview."""

from pathlib import Path

import numpy as np
import trimesh
from build123d import import_step


def export_step_to_stl(
    step_path: str | Path, output_dir: str | Path | None = None, tolerance: float = 0.1
) -> Path:
    """Convert a STEP file to STL for use with 3D toolpath engines."""
    step_path = Path(step_path)
    if output_dir is None:
        output_dir = step_path.parent
    output_dir = Path(output_dir)

    compound = import_step(str(step_path))
    solids = compound.solids()
    if not solids:
        raise ValueError("STEP file contains no solids")

    all_vertices: list[list[float]] = []
    all_faces: list[list[int]] = []
    vertex_offset = 0

    for solid in solids:
        verts_raw, tris_raw = solid.tessellate(tolerance)
        for v in verts_raw:
            all_vertices.append([v.X, v.Y, v.Z])
        for tri in tris_raw:
            all_faces.append([t + vertex_offset for t in tri])
        vertex_offset += len(verts_raw)

    mesh = trimesh.Trimesh(
        vertices=np.array(all_vertices), faces=np.array(all_faces)
    )

    stl_path = output_dir / f"{step_path.stem}.stl"
    mesh.export(str(stl_path))
    return stl_path


def tessellate_step_file(
    filepath: str | Path, tolerance: float = 0.5
) -> list[dict]:
    """Tessellate all solids in a STEP file and return mesh data.

    Returns a list of dicts, one per solid:
        {
            "object_id": "obj_001",
            "vertices": [x0, y0, z0, x1, y1, z1, ...],  # flat
            "faces": [i0, j0, k0, i1, j1, k1, ...],      # flat
        }
    """
    compound = import_step(str(filepath))
    solids = compound.solids()

    meshes = []
    for i, solid in enumerate(solids):
        verts_raw, tris_raw = solid.tessellate(tolerance)

        vertices: list[float] = []
        for v in verts_raw:
            vertices.extend([v.X, v.Y, v.Z])

        faces: list[int] = []
        for tri in tris_raw:
            faces.extend(tri)

        meshes.append({
            "object_id": f"obj_{i + 1:03d}",
            "vertices": vertices,
            "faces": faces,
        })

    return meshes
