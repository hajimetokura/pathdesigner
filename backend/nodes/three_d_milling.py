"""3D Milling — Waterline roughing engine.

Slices a mesh at successive Z levels (top -> bottom) to produce
2.5D contour toolpaths suitable for CNC roughing.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import trimesh
from shapely.geometry import Polygon

from schemas import Toolpath, ToolpathPass


def _section_to_polygons(section, z_level: float) -> list[Polygon]:
    """Convert a trimesh Path3D section to Shapely polygons.

    Uses to_2D() and extracts vertices from entities directly,
    avoiding the need for networkx (which polygons_full requires).
    """
    try:
        path_2d, _transform = section.to_2D()
    except Exception:
        return []

    polygons: list[Polygon] = []
    for entity in path_2d.entities:
        points = path_2d.vertices[entity.points]
        if len(points) < 3:
            continue
        # Close the polygon if not already closed
        coords = [(float(p[0]), float(p[1])) for p in points]
        try:
            poly = Polygon(coords)
            if poly.is_valid and not poly.is_empty and poly.area > 1e-6:
                polygons.append(poly)
        except Exception:
            continue

    return polygons


def generate_waterline_roughing(
    mesh_file_path: str,
    z_step: float = 3.0,
    stock_to_leave: float = 0.5,
) -> list[Toolpath]:
    """Generate waterline roughing toolpaths from a mesh file.

    Algorithm:
      1. Load mesh with trimesh
      2. Get bounding box Z range
      3. For each Z level from top to bottom (z_step intervals):
         a. Slice mesh at Z -> get cross-section
         b. Convert to Shapely polygons
         c. Offset inward by stock_to_leave (if > 0)
         d. Convert polygon boundary to [[x, y, z]] path
      4. Return list[Toolpath]

    Raises:
        FileNotFoundError: If mesh_file_path does not exist.
    """
    path = Path(mesh_file_path)
    if not path.exists():
        raise FileNotFoundError(f"Mesh file not found: {mesh_file_path}")

    mesh = trimesh.load(str(path), force="mesh")
    if not isinstance(mesh, trimesh.Trimesh):
        raise ValueError(f"Invalid mesh file: {mesh_file_path}")

    bounds = mesh.bounds  # [[min_x, min_y, min_z], [max_x, max_y, max_z]]
    z_min = float(bounds[0][2])
    z_max = float(bounds[1][2])

    # Generate Z levels from top to bottom (skip very top, skip bottom)
    z_levels: list[float] = []
    z = z_max - z_step
    while z > z_min:
        z_levels.append(round(z, 6))
        z -= z_step

    toolpaths: list[Toolpath] = []
    op_counter = 0

    for z_level in z_levels:
        section = mesh.section(
            plane_origin=[0, 0, z_level],
            plane_normal=[0, 0, 1],
        )

        if section is None:
            continue

        polygons = _section_to_polygons(section, z_level)
        if not polygons:
            continue

        passes_for_level: list[ToolpathPass] = []

        for poly in polygons:
            # Apply stock_to_leave (inward offset)
            if stock_to_leave > 0:
                buffered = poly.buffer(-stock_to_leave)
                if buffered.is_empty:
                    continue
                # buffer may return MultiPolygon
                if hasattr(buffered, "geoms"):
                    work_polys = list(buffered.geoms)
                else:
                    work_polys = [buffered]
            else:
                work_polys = [poly]

            for wp in work_polys:
                if wp.is_empty:
                    continue
                coords_2d = list(wp.exterior.coords)
                path_3d = [
                    [round(float(c[0]), 4), round(float(c[1]), 4), round(z_level, 4)]
                    for c in coords_2d
                ]

                if len(path_3d) < 3:
                    continue

                passes_for_level.append(
                    ToolpathPass(
                        pass_number=len(passes_for_level) + 1,
                        z_depth=round(z_level, 4),
                        path=path_3d,
                        tabs=[],
                    )
                )

        if passes_for_level:
            op_counter += 1
            toolpaths.append(
                Toolpath(
                    operation_id=f"3d_roughing_{op_counter:03d}",
                    object_id="obj_001",
                    contour_type="exterior",
                    passes=passes_for_level,
                )
            )

    return toolpaths
