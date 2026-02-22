"""Toolpath generation: contour coords + machining settings → multi-pass Z step-down."""

import math

from schemas import (
    ContourExtractResult,
    MachiningSettings,
    OperationAssignment,
    OperationDetectResult,
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

    for contour in contour_result.contours:
        if contour.type != "exterior":
            continue

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
) -> ToolpathGenResult:
    """Generate toolpaths from operation assignments.

    For contour operations, uses the assigned stock material's thickness
    as the cutting depth (to cut through the entire stock).
    """
    # Build lookup: operation_id → DetectedOperation
    op_lookup = {op.operation_id: op for op in detected.operations}
    # Build lookup: material_id → StockMaterial
    mat_lookup = {m.material_id: m for m in stock.materials}

    toolpaths: list[Toolpath] = []

    for assignment in sorted(assignments, key=lambda a: a.order):
        if not assignment.enabled:
            continue

        detected_op = op_lookup.get(assignment.operation_id)
        if not detected_op:
            continue

        material = mat_lookup.get(assignment.material_id)
        if not material:
            continue

        # For contour operations, cut through entire stock
        if detected_op.operation_type == "contour":
            total_depth = material.thickness
        else:
            total_depth = detected_op.geometry.depth

        for contour in detected_op.geometry.contours:
            if contour.type != "exterior":
                continue

            passes = _compute_passes(
                coords=contour.coords,
                depth_per_pass=assignment.settings.depth_per_pass,
                total_depth=total_depth,
                tabs_settings=assignment.settings.tabs,
            )

            toolpaths.append(
                Toolpath(
                    operation_id=assignment.operation_id,
                    passes=passes,
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
