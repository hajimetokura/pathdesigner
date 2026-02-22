"""Toolpath generation: contour coords + machining settings → multi-pass Z step-down."""

import math

from nodes.geometry_utils import rotate_coords
from schemas import (
    BoundingBox,
    ContourExtractResult,
    MachiningSettings,
    OperationAssignment,
    OperationDetectResult,
    PlacementItem,
    StockSettings,
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
    stock: StockSettings,
    placements: list[PlacementItem] | None = None,
    object_origins: dict[str, list[float]] | None = None,
    bounding_boxes: dict[str, BoundingBox] | None = None,
) -> ToolpathGenResult:
    """Generate toolpaths from operation assignments.

    For contour operations, uses the assigned stock material's thickness
    as the cutting depth (to cut through the entire stock).

    Coordinate transform: model_space → stock_space
      1. Rotate around contour geometric center (if rotation != 0)
      2. Translate: stock_coord = (model_coord - origin) + placement_offset
    """
    # Build lookup: operation_id → DetectedOperation
    op_lookup = {op.operation_id: op for op in detected.operations}
    # Build lookup: material_id → StockMaterial
    mat_lookup = {m.material_id: m for m in stock.materials}
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

        # Compute coordinate transform: model → stock space
        placement = plc_lookup.get(detected_op.object_id)
        origin = ori_lookup.get(detected_op.object_id, [0.0, 0.0])
        origin_x, origin_y = origin[0], origin[1]
        place_x = placement.x_offset if placement else 0.0
        place_y = placement.y_offset if placement else 0.0
        rotation = placement.rotation if placement else 0
        dx = -origin_x + place_x
        dy = -origin_y + place_y

        # Compute rotation pivot: geometric center of all contours (world space)
        all_cx = [c[0] for ct in detected_op.geometry.contours for c in ct.coords]
        all_cy = [c[1] for ct in detected_op.geometry.contours for c in ct.coords]
        rot_cx = (min(all_cx) + max(all_cx)) / 2 if all_cx else 0.0
        rot_cy = (min(all_cy) + max(all_cy)) / 2 if all_cy else 0.0

        # For contour operations, cut through entire stock
        if detected_op.operation_type == "contour":
            total_depth = material.thickness
        else:
            total_depth = detected_op.geometry.depth

        # Sort: interior first, then exterior
        sorted_contours = sorted(
            detected_op.geometry.contours,
            key=lambda c: (0 if c.type == "interior" else 1),
        )

        for contour in sorted_contours:
            # Apply rotation (around BB center) then placement offset
            if rotation != 0 and len(contour.coords) >= 3:
                rotated = rotate_coords(contour.coords, rotation, rot_cx, rot_cy)
                offset_coords = [[c[0] + dx, c[1] + dy] for c in rotated]
            else:
                offset_coords = [[c[0] + dx, c[1] + dy] for c in contour.coords]

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

    # Return result with stock dimensions for preview
    first_material = stock.materials[0] if stock.materials else None
    return ToolpathGenResult(
        toolpaths=toolpaths,
        stock_width=first_material.width if first_material else None,
        stock_depth=first_material.depth if first_material else None,
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
