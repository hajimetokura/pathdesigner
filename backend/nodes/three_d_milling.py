"""3D Milling — Waterline roughing engine.

Slices a mesh at successive Z levels (top -> bottom) to produce
2.5D contour toolpaths suitable for CNC roughing.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import trimesh
from shapely.geometry import Polygon

from schemas import ThreeDRoughingRequest, ThreeDFinishingRequest, Toolpath, ToolpathPass


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


def generate_waterline_roughing(req: ThreeDRoughingRequest) -> list[Toolpath]:
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
    path = Path(req.mesh_file_path)
    if not path.exists():
        raise FileNotFoundError(f"Mesh file not found: {req.mesh_file_path}")

    mesh = trimesh.load(str(path), force="mesh")
    if not isinstance(mesh, trimesh.Trimesh):
        raise ValueError(f"Invalid mesh file: {req.mesh_file_path}")

    bounds = mesh.bounds  # [[min_x, min_y, min_z], [max_x, max_y, max_z]]
    z_min = float(bounds[0][2])
    z_max = float(bounds[1][2])

    z_step = req.z_step
    stock_to_leave = req.stock_to_leave

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


def _ray_cast_z(triangles: np.ndarray, x: float, y: float) -> float | None:
    """Cast a vertical ray at (x, y) and return the highest Z intersection.

    Uses vectorized Möller–Trumbore for Z-axis rays (direction = [0,0,-1]).
    """
    v0 = triangles[:, 0, :]  # (N, 3)
    v1 = triangles[:, 1, :]
    v2 = triangles[:, 2, :]

    e1 = v1 - v0  # (N, 3)
    e2 = v2 - v0

    # Ray direction is [0, 0, -1], origin is [x, y, +inf]
    # h = cross(dir, e2) = cross([0,0,-1], e2) = [e2_y, -e2_x, 0]
    h = np.column_stack([e2[:, 1], -e2[:, 0], np.zeros(len(e2))])

    a = np.sum(e1 * h, axis=1)  # dot(e1, h)

    # Filter degenerate triangles
    valid = np.abs(a) > 1e-10
    if not np.any(valid):
        return None

    f = np.where(valid, 1.0 / np.where(valid, a, 1.0), 0.0)
    s = np.array([x, y, 0.0]) - v0  # s_z doesn't matter for u calc below

    u = f * np.sum(s * h, axis=1)

    # Filter by u in [0, 1]
    valid = valid & (u >= 0) & (u <= 1)
    if not np.any(valid):
        return None

    # q = cross(s, e1)
    q = np.cross(s, e1)

    # v = f * dot(dir, q) = f * dot([0,0,-1], q) = f * (-q_z)
    v_param = f * (-q[:, 2])
    valid = valid & (v_param >= 0) & (u + v_param <= 1)
    if not np.any(valid):
        return None

    # t = f * dot(e2, q)
    t = f * np.sum(e2 * q, axis=1)

    # Z at intersection: origin_z - t * dir_z = origin_z + t (since dir_z = -1)
    # But actually z = v0_z + u * e1_z + v * e2_z is simpler
    z_hits = v0[valid, 2] + u[valid] * e1[valid, 2] + v_param[valid] * e2[valid, 2]

    if len(z_hits) == 0:
        return None

    return float(np.max(z_hits))


def generate_raster_finishing(req: ThreeDFinishingRequest) -> list[Toolpath]:
    """Generate raster (scan-line) finishing toolpaths via ray casting.

    Algorithm:
      1. Load mesh with trimesh
      2. Get XY bounding box
      3. Generate parallel scan lines spaced by stepover * tool_diameter
      4. For each scan line, sample X (or Y) positions at regular intervals
      5. For each (x, y), cast ray downward -> get surface Z
      6. Output [[x, y, z]] paths per scan line (zigzag direction)

    The scan_angle parameter rotates the scan direction:
      - 0 = scan along X axis (constant Y per line)
      - 90 = scan along Y axis (constant X per line)
    """
    path_obj = Path(req.mesh_file_path)
    if not path_obj.exists():
        raise FileNotFoundError(f"Mesh file not found: {req.mesh_file_path}")

    mesh = trimesh.load(str(path_obj), force="mesh")
    if not isinstance(mesh, trimesh.Trimesh):
        raise ValueError(f"Invalid mesh file: {req.mesh_file_path}")

    tool_radius = req.tool.diameter / 2
    step = req.tool.diameter * req.stepover

    bounds = mesh.bounds  # [[min_x, min_y, min_z], [max_x, max_y, max_z]]
    x_min, y_min, z_min = float(bounds[0][0]), float(bounds[0][1]), float(bounds[0][2])
    x_max, y_max, z_max = float(bounds[1][0]), float(bounds[1][1]), float(bounds[1][2])

    # Rotation for scan angle
    angle_rad = np.radians(req.scan_angle)
    cos_a, sin_a = np.cos(angle_rad), np.sin(angle_rad)

    # Transform mesh bounding box corners to rotated coordinate system
    corners = np.array([
        [x_min, y_min], [x_max, y_min],
        [x_min, y_max], [x_max, y_max],
    ])
    # Rotate corners into scan coordinates (u = primary scan axis, v = step axis)
    rotated = np.column_stack([
        corners[:, 0] * cos_a + corners[:, 1] * sin_a,
        -corners[:, 0] * sin_a + corners[:, 1] * cos_a,
    ])
    u_min, u_max = float(rotated[:, 0].min()), float(rotated[:, 0].max())
    v_min, v_max = float(rotated[:, 1].min()), float(rotated[:, 1].max())

    # Precompute triangle data for ray casting
    triangles = mesh.triangles  # (N, 3, 3) array of triangle vertices

    # Sample spacing along scan direction
    sample_step = req.tool.diameter * 0.25  # 4 samples per tool diameter

    # Generate scan lines
    toolpaths: list[Toolpath] = []
    v = v_min + step / 2
    direction = 1
    line_idx = 0

    while v <= v_max - step / 2 + 0.001:
        # Generate sample points along this scan line in rotated coordinates
        u_samples = np.arange(u_min, u_max + sample_step, sample_step)
        if direction == -1:
            u_samples = u_samples[::-1]

        # Rotate back to world XY
        x_samples = u_samples * cos_a - v * sin_a
        y_samples = u_samples * sin_a + v * cos_a

        # For each sample point, find the highest Z on the mesh surface
        # by checking which triangle each (x,y) falls into
        best_z: dict[int, float] = {}
        for i in range(len(x_samples)):
            x, y = float(x_samples[i]), float(y_samples[i])
            z_hit = _ray_cast_z(triangles, x, y)
            if z_hit is not None:
                best_z[i] = z_hit

        # Build path from consecutive hits
        path_3d: list[list[float]] = []
        for i in range(len(x_samples)):
            if i in best_z:
                # Offset Z upward by tool radius for ballnose compensation
                z_surface = best_z[i] + tool_radius
                path_3d.append([
                    round(float(x_samples[i]), 4),
                    round(float(y_samples[i]), 4),
                    round(z_surface, 4),
                ])

        if len(path_3d) >= 2:
            line_idx += 1
            toolpaths.append(Toolpath(
                operation_id=f"3d_finishing_{line_idx:04d}",
                object_id="obj_001",
                contour_type="3d_finishing",
                passes=[ToolpathPass(
                    pass_number=1,
                    z_depth=round(z_min, 4),
                    path=path_3d,
                    tabs=[],
                )],
            ))

        direction *= -1
        v += step

    return toolpaths
