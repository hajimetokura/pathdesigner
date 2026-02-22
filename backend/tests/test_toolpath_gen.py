"""Tests for toolpath generation logic."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from nodes.toolpath_gen import generate_toolpath
from schemas import (
    ContourExtractResult,
    Contour,
    OffsetApplied,
    MachiningSettings,
    Tool,
    FeedRate,
    TabSettings,
    ToolpathGenResult,
)

# --- Fixtures ---

SQUARE_CONTOUR = ContourExtractResult(
    object_id="obj_001",
    slice_z=0.0,
    thickness=18.0,
    contours=[
        Contour(
            id="contour_001",
            type="exterior",
            coords=[
                [0.0, 0.0],
                [100.0, 0.0],
                [100.0, 50.0],
                [0.0, 50.0],
                [0.0, 0.0],
            ],
            closed=True,
        )
    ],
    offset_applied=OffsetApplied(distance=3.175, side="outside"),
)

SETTINGS_NO_TABS = MachiningSettings(
    operation_type="contour",
    tool=Tool(diameter=6.35, type="endmill", flutes=2),
    feed_rate=FeedRate(xy=75.0, z=25.0),
    jog_speed=200.0,
    spindle_speed=18000,
    depth_per_pass=6.0,
    total_depth=18.0,
    direction="climb",
    offset_side="outside",
    tabs=TabSettings(enabled=False, height=3.0, width=5.0, count=4),
)

SETTINGS_WITH_TABS = MachiningSettings(
    operation_type="contour",
    tool=Tool(diameter=6.35, type="endmill", flutes=2),
    feed_rate=FeedRate(xy=75.0, z=25.0),
    jog_speed=200.0,
    spindle_speed=18000,
    depth_per_pass=6.0,
    total_depth=18.0,
    direction="climb",
    offset_side="outside",
    tabs=TabSettings(enabled=True, height=8.0, width=5.0, count=4),
)


def test_generate_toolpath_basic():
    """Should generate correct number of passes for 18mm depth at 6mm/pass."""
    result = generate_toolpath(SQUARE_CONTOUR, SETTINGS_NO_TABS)
    assert isinstance(result, ToolpathGenResult)
    assert len(result.toolpaths) == 1

    tp = result.toolpaths[0]
    assert tp.operation_id == "obj_001"
    # 18mm / 6mm = 3 passes
    assert len(tp.passes) == 3


def test_z_depths_step_down():
    """Z depths should step down from surface to penetration."""
    result = generate_toolpath(SQUARE_CONTOUR, SETTINGS_NO_TABS)
    passes = result.toolpaths[0].passes
    z_values = [p.z_depth for p in passes]

    # Each pass should be deeper than the previous
    for i in range(1, len(z_values)):
        assert z_values[i] < z_values[i - 1], f"Pass {i+1} not deeper: {z_values}"

    # Final pass should be negative (penetration)
    assert z_values[-1] < 0


def test_pass_paths_match_contour():
    """Each pass should follow the contour coordinates."""
    result = generate_toolpath(SQUARE_CONTOUR, SETTINGS_NO_TABS)
    for p in result.toolpaths[0].passes:
        assert len(p.path) == len(SQUARE_CONTOUR.contours[0].coords)


def test_no_tabs_on_non_final_passes():
    """Tabs should only appear on the final pass."""
    result = generate_toolpath(SQUARE_CONTOUR, SETTINGS_WITH_TABS)
    passes = result.toolpaths[0].passes
    for p in passes[:-1]:
        assert len(p.tabs) == 0, f"Pass {p.pass_number} should have no tabs"


def test_tabs_on_final_pass():
    """Final pass should have tabs when enabled."""
    result = generate_toolpath(SQUARE_CONTOUR, SETTINGS_WITH_TABS)
    final_pass = result.toolpaths[0].passes[-1]
    assert len(final_pass.tabs) == 4  # count=4


def test_tab_z_height():
    """Tab z_tab should be above final cutting depth."""
    result = generate_toolpath(SQUARE_CONTOUR, SETTINGS_WITH_TABS)
    final_pass = result.toolpaths[0].passes[-1]
    for tab in final_pass.tabs:
        assert tab.z_tab > final_pass.z_depth


def test_tabs_disabled():
    """When tabs disabled, no tabs on any pass."""
    result = generate_toolpath(SQUARE_CONTOUR, SETTINGS_NO_TABS)
    for p in result.toolpaths[0].passes:
        assert len(p.tabs) == 0


def test_uneven_depth_division():
    """When total_depth not evenly divisible, last pass goes to penetration."""
    settings = SETTINGS_NO_TABS.model_copy(
        update={"depth_per_pass": 7.0, "total_depth": 18.0}
    )
    result = generate_toolpath(SQUARE_CONTOUR, settings)
    passes = result.toolpaths[0].passes
    # ceil(18/7) = 3 passes
    assert len(passes) == 3
    assert passes[-1].z_depth < 0  # penetration


# --- Operation-centric tests ---

from nodes.toolpath_gen import generate_toolpath_from_operations
from schemas import (
    OperationAssignment, OperationGeometry, DetectedOperation, OperationDetectResult,
    StockMaterial, StockSettings,
)


def _make_square_contour():
    """Create a simple 100x50 square contour."""
    return Contour(
        id="c_001",
        type="exterior",
        coords=[[0, 0], [100, 0], [100, 50], [0, 50], [0, 0]],
        closed=True,
    )


def _make_settings(total_depth: float = 18.0):
    return MachiningSettings(
        operation_type="contour",
        tool=Tool(diameter=6.35, type="endmill", flutes=2),
        feed_rate=FeedRate(xy=75, z=25),
        jog_speed=200,
        spindle_speed=18000,
        depth_per_pass=6.0,
        total_depth=total_depth,
        direction="climb",
        offset_side="outside",
        tabs=TabSettings(enabled=True, height=8, width=5, count=4),
    )


def test_generate_from_operations_single():
    """Single contour operation should produce toolpath with correct Z depths."""
    contour = _make_square_contour()
    detected = OperationDetectResult(
        operations=[
            DetectedOperation(
                operation_id="op_001",
                object_id="obj_001",
                operation_type="contour",
                geometry=OperationGeometry(
                    contours=[contour],
                    offset_applied=OffsetApplied(distance=3.175, side="outside"),
                    depth=10.0,
                ),
                suggested_settings=_make_settings(10.0),
            )
        ]
    )
    assignments = [
        OperationAssignment(
            operation_id="op_001",
            material_id="mtl_1",
            settings=_make_settings(10.0),
            order=1,
        )
    ]
    stock = StockSettings(
        materials=[StockMaterial(material_id="mtl_1", thickness=12)]
    )

    result = generate_toolpath_from_operations(assignments, detected, stock)

    assert isinstance(result, ToolpathGenResult)
    assert len(result.toolpaths) == 1
    # Stock is 12mm, depth_per_pass=6 → 2 passes
    tp = result.toolpaths[0]
    assert len(tp.passes) == 2
    # Final pass should penetrate below stock bottom
    assert tp.passes[-1].z_depth < 0


def test_generate_from_operations_disabled():
    """Disabled operations should be skipped."""
    contour = _make_square_contour()
    detected = OperationDetectResult(
        operations=[
            DetectedOperation(
                operation_id="op_001",
                object_id="obj_001",
                operation_type="contour",
                geometry=OperationGeometry(
                    contours=[contour],
                    offset_applied=OffsetApplied(distance=3.175, side="outside"),
                    depth=10.0,
                ),
                suggested_settings=_make_settings(10.0),
            )
        ]
    )
    assignments = [
        OperationAssignment(
            operation_id="op_001",
            material_id="mtl_1",
            enabled=False,
            settings=_make_settings(10.0),
            order=1,
        )
    ]
    stock = StockSettings(
        materials=[StockMaterial(material_id="mtl_1", thickness=12)]
    )

    result = generate_toolpath_from_operations(assignments, detected, stock)
    assert len(result.toolpaths) == 0


def test_interior_contours_processed():
    """Interior contours should also produce toolpaths."""
    exterior = Contour(
        id="c_001", type="exterior",
        coords=[[0, 0], [100, 0], [100, 50], [0, 50], [0, 0]], closed=True,
    )
    interior = Contour(
        id="c_002", type="interior",
        coords=[[30, 10], [70, 10], [70, 40], [30, 40], [30, 10]], closed=True,
    )
    detected = OperationDetectResult(
        operations=[
            DetectedOperation(
                operation_id="op_001",
                object_id="obj_001",
                operation_type="contour",
                geometry=OperationGeometry(
                    contours=[exterior, interior],
                    offset_applied=OffsetApplied(distance=3.175, side="outside"),
                    depth=10.0,
                ),
                suggested_settings=_make_settings(10.0),
            )
        ]
    )
    assignments = [
        OperationAssignment(
            operation_id="op_001",
            material_id="mtl_1",
            settings=_make_settings(10.0),
            order=1,
        )
    ]
    stock = StockSettings(
        materials=[StockMaterial(material_id="mtl_1", thickness=12)]
    )

    result = generate_toolpath_from_operations(assignments, detected, stock)

    # Should have 2 toolpaths: interior first, then exterior
    assert len(result.toolpaths) == 2


def test_interior_before_exterior_order():
    """Interior contours should be processed before exterior contours."""
    exterior = Contour(
        id="c_001", type="exterior",
        coords=[[0, 0], [100, 0], [100, 50], [0, 50], [0, 0]], closed=True,
    )
    interior = Contour(
        id="c_002", type="interior",
        coords=[[30, 10], [70, 10], [70, 40], [30, 40], [30, 10]], closed=True,
    )
    detected = OperationDetectResult(
        operations=[
            DetectedOperation(
                operation_id="op_001",
                object_id="obj_001",
                operation_type="contour",
                geometry=OperationGeometry(
                    contours=[exterior, interior],  # exterior first in input
                    offset_applied=OffsetApplied(distance=3.175, side="outside"),
                    depth=10.0,
                ),
                suggested_settings=_make_settings(10.0),
            )
        ]
    )
    assignments = [
        OperationAssignment(
            operation_id="op_001",
            material_id="mtl_1",
            settings=_make_settings(10.0),
            order=1,
        )
    ]
    stock = StockSettings(
        materials=[StockMaterial(material_id="mtl_1", thickness=12)]
    )

    result = generate_toolpath_from_operations(assignments, detected, stock)

    # First toolpath should be from interior, second from exterior
    assert len(result.toolpaths) == 2
    # Interior contour coords start at [30, 10]
    assert result.toolpaths[0].passes[0].path[0][0] == 30.0
    # Exterior contour coords start at [0, 0]
    assert result.toolpaths[1].passes[0].path[0][0] == 0.0
