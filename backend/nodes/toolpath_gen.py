"""Toolpath generation: contour coords + machining settings → multi-pass Z step-down."""

import math

from shapely.geometry import Polygon

from nodes.drill_toolpath import generate_drill_toolpath
from nodes.geometry_utils import transform_coords
from nodes.pocket_toolpath import generate_pocket_contour_parallel, generate_pocket_raster
from schemas import (
    BoundingBox,
    ContourExtractResult,
    MachiningSettings,
    OperationAssignment,
    OperationDetectResult,
    PlacementItem,
    SheetSettings,
    TabSegment,
    Toolpath,
    ToolpathGenResult,
    ToolpathPass,
)

# Penetration below material bottom (mm)
PENETRATION_MARGIN = 0.3


def generate_toolpath(
    contour_result: ContourExtractResult,
    settings: MachiningSettings,
) -> ToolpathGenResult:
    """Generate multi-pass toolpaths from contour + settings."""
    toolpaths = []

    # Sort: interior first, then exterior
    sorted_contours = sorted(
        contour_result.contours,
        key=lambda c: (0 if c.type == "interior" else 1),
    )

    for contour in sorted_contours:
        passes = _compute_passes(
            coords=contour.coords,
            depth_per_pass=settings.depth_per_pass,
            total_depth=settings.total_depth,
            tabs_settings=settings.tabs,
        )

        toolpaths.append(
            Toolpath(
                operation_id=contour_result.object_id,
                passes=passes,
            )
        )

    return ToolpathGenResult(toolpaths=toolpaths)


def generate_toolpath_from_operations(
    assignments: list[OperationAssignment],
    detected: OperationDetectResult,
    sheet: SheetSettings,
    placements: list[PlacementItem] | None = None,
    object_origins: dict[str, list[float]] | None = None,
    bounding_boxes: dict[str, BoundingBox] | None = None,
) -> ToolpathGenResult:
    """Generate toolpaths from operation assignments.

    For contour operations, uses the assigned sheet material's thickness
    as the cutting depth (to cut through the entire sheet).

    Coordinate transform: model_space → sheet_space
      1. Rotate around contour geometric center (if rotation != 0)
      2. Translate: sheet_coord = (model_coord - origin) + placement_offset
    """
    # Build lookup: operation_id → DetectedOperation
    op_lookup = {op.operation_id: op for op in detected.operations}
    # Build lookup: material_id → SheetMaterial
    mat_lookup = {m.material_id: m for m in sheet.materials}
    # Build lookup: object_id → PlacementItem
    plc_lookup = {p.object_id: p for p in (placements or [])}
    # Build lookup: object_id → (origin_x, origin_y)
    ori_lookup = object_origins or {}
    toolpaths: list[Toolpath] = []

    # Sort assignments by placement position (y asc → x asc) when placements exist
    if placements:
        op_to_obj = {op.operation_id: op.object_id for op in detected.operations}

        def _placement_sort_key(a: OperationAssignment):
            obj_id = op_to_obj.get(a.operation_id, "")
            plc = plc_lookup.get(obj_id)
            if plc:
                return (plc.y_offset, plc.x_offset, a.order)
            return (float("inf"), float("inf"), a.order)

        sorted_assignments = sorted(assignments, key=_placement_sort_key)
    else:
        sorted_assignments = sorted(assignments, key=lambda a: a.order)

    for assignment in sorted_assignments:
        if not assignment.enabled:
            continue

        detected_op = op_lookup.get(assignment.operation_id)
        if not detected_op:
            continue

        material = mat_lookup.get(assignment.material_id)
        if not material:
            continue

        # Compute coordinate transform: model → sheet space
        placement = plc_lookup.get(detected_op.object_id)
        origin = ori_lookup.get(detected_op.object_id, [0.0, 0.0])
        origin_x, origin_y = origin[0], origin[1]
        place_x = placement.x_offset if placement else 0.0
        place_y = placement.y_offset if placement else 0.0
        rotation = placement.rotation if placement else 0
        dx = -origin_x + place_x
        dy = -origin_y + place_y

        # Compute rotation pivot: object BB center in world space
        # Must match frontend PlacementPanel which rotates around (bb.x/2, bb.y/2)
        bb_info = (bounding_boxes or {}).get(detected_op.object_id)
        if bb_info is not None:
            rot_cx = origin_x + bb_info.x / 2
            rot_cy = origin_y + bb_info.y / 2
        else:
            # Fallback: geometric center of all contours (world space)
            all_cx = [c[0] for ct in detected_op.geometry.contours for c in ct.coords]
            all_cy = [c[1] for ct in detected_op.geometry.contours for c in ct.coords]
            rot_cx = (min(all_cx) + max(all_cx)) / 2 if all_cx else 0.0
            rot_cy = (min(all_cy) + max(all_cy)) / 2 if all_cy else 0.0

        # For contour operations, cut through entire sheet
        if detected_op.operation_type == "contour":
            total_depth = material.thickness
        else:
            total_depth = detected_op.geometry.depth

        # --- Drill operations ---
        if detected_op.operation_type == "drill":
            # Use centroid of first contour as drill center
            contour = detected_op.geometry.contours[0] if detected_op.geometry.contours else None
            if not contour:
                continue
            cx = sum(c[0] for c in contour.coords) / len(contour.coords)
            cy = sum(c[1] for c in contour.coords) / len(contour.coords)
            # Apply rotation then offset
            center = transform_coords([[cx, cy]], rotation, rot_cx, rot_cy, dx, dy)[0]
            drill_passes = generate_drill_toolpath(
                center=center,
                total_depth=total_depth,
                depth_per_peck=assignment.settings.depth_per_peck,
            )
            toolpaths.append(
                Toolpath(
                    operation_id=assignment.operation_id,
                    passes=drill_passes,
                    settings=assignment.settings,
                )
            )
            continue

        # --- Pocket operations ---
        if detected_op.operation_type == "pocket":
            contour = detected_op.geometry.contours[0] if detected_op.geometry.contours else None
            if not contour or len(contour.coords) < 3:
                continue
            # Apply rotation then offset to build the pocket polygon
            pocket_coords = transform_coords(contour.coords, rotation, rot_cx, rot_cy, dx, dy)
            polygon = Polygon(pocket_coords)
            if polygon.is_empty or not polygon.is_valid:
                continue
            tool_dia = assignment.settings.tool.diameter
            stepover = assignment.settings.pocket_stepover
            if assignment.settings.pocket_pattern == "raster":
                pocket_rings = generate_pocket_raster(polygon, tool_dia, stepover)
            else:
                pocket_rings = generate_pocket_contour_parallel(polygon, tool_dia, stepover)
            # Convert pocket rings into multi-pass Z step-down
            depth_per_pass = assignment.settings.depth_per_pass
            num_z_passes = math.ceil(total_depth / depth_per_pass)
            all_passes: list[ToolpathPass] = []
            pass_num = 0
            for z_i in range(num_z_passes):
                is_final = z_i == num_z_passes - 1
                z_depth = -PENETRATION_MARGIN if is_final else total_depth - ((z_i + 1) * depth_per_pass)
                for ring in pocket_rings:
                    pass_num += 1
                    all_passes.append(
                        ToolpathPass(
                            pass_number=pass_num,
                            z_depth=z_depth,
                            path=ring,
                            tabs=[],
                        )
                    )
            toolpaths.append(
                Toolpath(
                    operation_id=assignment.operation_id,
                    passes=all_passes,
                    settings=assignment.settings,
                )
            )
            continue

        # --- Contour operations (default) ---
        # Sort: interior first, then exterior
        sorted_contours = sorted(
            detected_op.geometry.contours,
            key=lambda c: (0 if c.type == "interior" else 1),
        )

        for contour in sorted_contours:
            # Apply rotation (around BB center) then placement offset
            offset_coords = transform_coords(contour.coords, rotation, rot_cx, rot_cy, dx, dy)

            passes = _compute_passes(
                coords=offset_coords,
                depth_per_pass=assignment.settings.depth_per_pass,
                total_depth=total_depth,
                tabs_settings=assignment.settings.tabs,
            )

            toolpaths.append(
                Toolpath(
                    operation_id=assignment.operation_id,
                    passes=passes,
                    settings=assignment.settings,
                )
            )

    # Return result with sheet dimensions for preview
    first_material = sheet.materials[0] if sheet.materials else None
    return ToolpathGenResult(
        toolpaths=toolpaths,
        sheet_width=first_material.width if first_material else None,
        sheet_depth=first_material.depth if first_material else None,
    )


def _compute_passes(
    coords: list[list[float]],
    depth_per_pass: float,
    total_depth: float,
    tabs_settings,
) -> list[ToolpathPass]:
    """Compute Z step-down passes with optional tabs on final pass."""
    num_passes = math.ceil(total_depth / depth_per_pass)
    passes: list[ToolpathPass] = []

    for i in range(num_passes):
        pass_number = i + 1
        is_final = pass_number == num_passes

        if is_final:
            z_depth = -PENETRATION_MARGIN
        else:
            z_depth = total_depth - (pass_number * depth_per_pass)

        tabs: list[TabSegment] = []
        if is_final and tabs_settings.enabled:
            tabs = _compute_tabs(coords, tabs_settings, z_depth)

        passes.append(
            ToolpathPass(
                pass_number=pass_number,
                z_depth=z_depth,
                path=coords,
                tabs=tabs,
            )
        )

    return passes


def _compute_tabs(
    coords: list[list[float]],
    tabs_settings,
    z_depth: float,
) -> list[TabSegment]:
    """Place tabs at equal intervals along the contour perimeter."""
    n_points = len(coords)
    if n_points < 2 or tabs_settings.count <= 0:
        return []

    # Compute cumulative distances along the path
    distances = [0.0]
    for i in range(1, n_points):
        dx = coords[i][0] - coords[i - 1][0]
        dy = coords[i][1] - coords[i - 1][1]
        distances.append(distances[-1] + math.hypot(dx, dy))

    total_length = distances[-1]
    if total_length <= 0:
        return []

    tab_spacing = total_length / tabs_settings.count
    tab_half_width = tabs_settings.width / 2.0
    z_tab = _tab_z(tabs_settings.height, z_depth)

    tabs: list[TabSegment] = []
    for t in range(tabs_settings.count):
        center_dist = tab_spacing * (t + 0.5)
        start_dist = center_dist - tab_half_width
        end_dist = center_dist + tab_half_width

        start_idx = _distance_to_index(distances, max(0.0, start_dist))
        end_idx = _distance_to_index(distances, min(total_length, end_dist))

        if end_idx <= start_idx:
            end_idx = min(start_idx + 1, n_points - 1)

        tabs.append(TabSegment(start_index=start_idx, end_index=end_idx, z_tab=z_tab))

    return tabs


def _tab_z(tab_height: float, z_depth: float) -> float:
    """Calculate tab top Z position. Tab rises from cutting depth."""
    return z_depth + tab_height


def _distance_to_index(distances: list[float], target: float) -> int:
    """Find the path index closest to the target cumulative distance."""
    for i, d in enumerate(distances):
        if d >= target:
            return i
    return len(distances) - 1
