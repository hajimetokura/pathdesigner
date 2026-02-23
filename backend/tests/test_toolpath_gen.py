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
    BoundingBox,
    OperationAssignment, OperationGeometry, DetectedOperation, OperationDetectResult,
    PlacementItem, SheetMaterial, SheetSettings,
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
    stock = SheetSettings(
        materials=[SheetMaterial(material_id="mtl_1", thickness=12)]
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
    stock = SheetSettings(
        materials=[SheetMaterial(material_id="mtl_1", thickness=12)]
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
    stock = SheetSettings(
        materials=[SheetMaterial(material_id="mtl_1", thickness=12)]
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
    stock = SheetSettings(
        materials=[SheetMaterial(material_id="mtl_1", thickness=12)]
    )

    result = generate_toolpath_from_operations(assignments, detected, stock)

    # First toolpath should be from interior, second from exterior
    assert len(result.toolpaths) == 2
    # Interior contour coords start at [30, 10]
    assert result.toolpaths[0].passes[0].path[0][0] == 30.0
    # Exterior contour coords start at [0, 0]
    assert result.toolpaths[1].passes[0].path[0][0] == 0.0


def test_rotation_90_transforms_coords():
    """90-degree rotation should swap X/Y coordinates around BB center."""
    contour = Contour(
        id="c_001", type="exterior",
        coords=[[0, 0], [100, 0], [100, 50], [0, 50], [0, 0]], closed=True,
    )
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
    stock = SheetSettings(
        materials=[SheetMaterial(material_id="mtl_1", thickness=12)]
    )
    placements = [
        PlacementItem(object_id="obj_001", material_id="mtl_1", x_offset=0, y_offset=0, rotation=90)
    ]
    bounding_boxes = {"obj_001": BoundingBox(x=100, y=50, z=10)}

    result_no_rot = generate_toolpath_from_operations(
        assignments, detected, stock,
    )
    result_with_rot = generate_toolpath_from_operations(
        assignments, detected, stock, placements, bounding_boxes=bounding_boxes,
    )

    # After 90° rotation, the path should be different
    path_no_rot = result_no_rot.toolpaths[0].passes[0].path
    path_with_rot = result_with_rot.toolpaths[0].passes[0].path
    assert path_no_rot != path_with_rot

    # A 100x50 box rotated 90° around center (50, 25) should have different bounds
    xs = [p[0] for p in path_with_rot]
    ys = [p[1] for p in path_with_rot]
    # Rotated: width ~50, height ~100 (swapped)
    assert (max(xs) - min(xs)) < 60  # was 100, now ~50
    assert (max(ys) - min(ys)) > 90  # was 50, now ~100


def test_rotation_with_world_space_coords():
    """Rotation must work for contours in world-space (not BB-min-relative).

    In real usage, contour_extract produces world-space coords (e.g. centered box
    has coords from -50 to 50), and objectOrigins provides bb.min for offset.
    The rotation center must be the geometric center of the contour, not (0,0)
    or (bb.x/2, bb.y/2).
    """
    # Simulate a Box(100, 50, 10) at position (200, 100) in world space
    # (e.g. 2nd object in a multi-object STEP file)
    contour = Contour(
        id="c_001", type="exterior",
        coords=[[150, 75], [250, 75], [250, 125], [150, 125], [150, 75]], closed=True,
    )
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
    stock = SheetSettings(
        materials=[SheetMaterial(material_id="mtl_1", thickness=12)]
    )
    # origin = bb.min = (150, 75), placement at (10, 10)
    object_origins = {"obj_001": [150.0, 75.0]}

    # Without rotation: should map to (10, 10) → (110, 60)
    result_no_rot = generate_toolpath_from_operations(
        assignments, detected, stock,
        [PlacementItem(object_id="obj_001", material_id="mtl_1", x_offset=10, y_offset=10, rotation=0)],
        object_origins=object_origins,
    )
    path_no_rot = result_no_rot.toolpaths[0].passes[0].path
    assert path_no_rot[0][0] == 10.0  # min-X maps to x_offset
    assert path_no_rot[0][1] == 10.0  # min-Y maps to y_offset

    # With 90° rotation: rotated 100x50 becomes 50x100
    # The part should still be near placement offset, not fly off to negative coords
    result_with_rot = generate_toolpath_from_operations(
        assignments, detected, stock,
        [PlacementItem(object_id="obj_001", material_id="mtl_1", x_offset=10, y_offset=10, rotation=90)],
        object_origins=object_origins,
    )
    path_with_rot = result_with_rot.toolpaths[0].passes[0].path
    xs = [p[0] for p in path_with_rot]
    ys = [p[1] for p in path_with_rot]

    # After rotation, all coords should be near the placement area, not negative
    assert min(xs) >= -30, f"X went too negative: {min(xs)} (rotation center is wrong)"
    assert min(ys) >= -30, f"Y went too negative: {min(ys)} (rotation center is wrong)"

    # Width and height should swap: ~50 wide, ~100 tall (was 100x50)
    assert (max(xs) - min(xs)) < 60, f"Width should be ~50, got {max(xs) - min(xs)}"
    assert (max(ys) - min(ys)) > 90, f"Height should be ~100, got {max(ys) - min(ys)}"


def test_generate_toolpath_includes_settings():
    """Each Toolpath should carry its operation's MachiningSettings."""
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
                    depth=18.0,
                ),
                suggested_settings=_make_settings(),
            )
        ]
    )
    settings = _make_settings()
    assignments = [
        OperationAssignment(
            operation_id="op_001",
            material_id="mtl_1",
            settings=settings,
            order=1,
        )
    ]
    stock = SheetSettings(
        materials=[SheetMaterial(material_id="mtl_1", thickness=18.0)]
    )

    result = generate_toolpath_from_operations(assignments, detected, stock)

    for tp in result.toolpaths:
        assert tp.settings is not None
        assert tp.settings.spindle_speed == 18000


def test_rotation_0_no_change():
    """0-degree rotation should not modify coordinates."""
    contour = Contour(
        id="c_001", type="exterior",
        coords=[[0, 0], [100, 0], [100, 50], [0, 50], [0, 0]], closed=True,
    )
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
    stock = SheetSettings(
        materials=[SheetMaterial(material_id="mtl_1", thickness=12)]
    )
    placements = [
        PlacementItem(object_id="obj_001", material_id="mtl_1", x_offset=10, y_offset=20, rotation=0)
    ]
    bounding_boxes = {"obj_001": BoundingBox(x=100, y=50, z=10)}

    result = generate_toolpath_from_operations(
        assignments, detected, stock, placements, bounding_boxes=bounding_boxes,
    )

    # With offset (10, 20) and no rotation, first point should be [10, 20]
    path = result.toolpaths[0].passes[0].path
    assert path[0][0] == 10.0
    assert path[0][1] == 20.0


def test_toolpath_ordering_by_placement():
    """Toolpaths should be ordered by placement: y_offset asc, then x_offset asc."""
    settings = _make_settings()
    contour = _make_square_contour()

    def make_op(op_id, obj_id):
        return DetectedOperation(
            operation_id=op_id, object_id=obj_id,
            operation_type="contour",
            geometry=OperationGeometry(
                contours=[contour],
                offset_applied=OffsetApplied(distance=3.175, side="outside"),
                depth=18.0,
            ),
            suggested_settings=settings,
        )

    detected = OperationDetectResult(operations=[
        make_op("op_A", "obj_A"),
        make_op("op_B", "obj_B"),
        make_op("op_C", "obj_C"),
    ])

    # obj_C at top-right, obj_A at bottom-left, obj_B at bottom-right
    placements = [
        PlacementItem(object_id="obj_C", material_id="mtl_1", x_offset=200, y_offset=200),
        PlacementItem(object_id="obj_A", material_id="mtl_1", x_offset=10, y_offset=10),
        PlacementItem(object_id="obj_B", material_id="mtl_1", x_offset=200, y_offset=10),
    ]

    # order values intentionally reversed vs. expected placement order
    assignments = [
        OperationAssignment(operation_id="op_A", material_id="mtl_1", settings=settings, order=3),
        OperationAssignment(operation_id="op_B", material_id="mtl_1", settings=settings, order=2),
        OperationAssignment(operation_id="op_C", material_id="mtl_1", settings=settings, order=1),
    ]
    stock = SheetSettings(
        materials=[SheetMaterial(material_id="mtl_1", thickness=18.0)]
    )

    result = generate_toolpath_from_operations(assignments, detected, stock, placements)

    # Expected order by placement: obj_A (y=10,x=10), obj_B (y=10,x=200), obj_C (y=200,x=200)
    # NOT by assignment.order (which would give C, B, A)
    op_ids = [tp.operation_id for tp in result.toolpaths]
    assert op_ids[0] == "op_A"
    assert op_ids[1] == "op_B"
    assert op_ids[2] == "op_C"
