"""Mesh export — tessellate STEP solids for 3D preview."""

from pathlib import Path

from build123d import import_step


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
