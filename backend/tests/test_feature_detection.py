"""Tests for extended operation detection (drill / pocket / contour)."""

from pathlib import Path

from nodes.operation_detector import detect_operations
from schemas import OperationDetectResult


def test_simple_box_detects_contour(simple_box_step: Path):
    """A simple box should detect one contour operation."""
    result = detect_operations(
        step_path=simple_box_step,
        file_id="test",
        object_ids=["obj_001"],
    )
    assert len(result.operations) == 1
    assert result.operations[0].operation_type == "contour"


def test_through_hole_detected_as_drill(box_with_small_hole_step: Path):
    """Through-hole with diameter <= tool_diameter*2 → drill."""
    result = detect_operations(
        step_path=box_with_small_hole_step,
        file_id="test",
        object_ids=["obj_001"],
        tool_diameter=6.35,
    )
    op_types = [op.operation_type for op in result.operations]
    assert "drill" in op_types
    # Also has a contour for the outer shape
    assert "contour" in op_types


def test_through_large_hole_detected_as_contour(box_with_hole_step: Path):
    """Through-hole with large diameter → interior contour (not drill)."""
    result = detect_operations(
        step_path=box_with_hole_step,
        file_id="test",
        object_ids=["obj_001"],
        tool_diameter=6.35,
    )
    op_types = [op.operation_type for op in result.operations]
    # Large hole (diameter=20mm) should NOT be a drill
    assert "drill" not in op_types
    assert "contour" in op_types


def test_blind_pocket_detected(box_with_pocket_step: Path):
    """Non-through cavity → pocket."""
    result = detect_operations(
        step_path=box_with_pocket_step,
        file_id="test",
        object_ids=["obj_001"],
        tool_diameter=6.35,
    )
    op_types = [op.operation_type for op in result.operations]
    assert "pocket" in op_types
    # Also has a contour for the outer shape
    assert "contour" in op_types


def test_drill_has_center_coords(box_with_small_hole_step: Path):
    """Drill operation geometry should contain center point as coords."""
    result = detect_operations(
        step_path=box_with_small_hole_step,
        file_id="test",
        object_ids=["obj_001"],
        tool_diameter=6.35,
    )
    drill_ops = [op for op in result.operations if op.operation_type == "drill"]
    assert len(drill_ops) == 1
    drill = drill_ops[0]
    # Should have exactly 1 contour with center point
    assert len(drill.geometry.contours) == 1
    coords = drill.geometry.contours[0].coords
    assert len(coords) >= 1


def test_pocket_has_depth(box_with_pocket_step: Path):
    """Pocket operation should have correct depth (not full thickness)."""
    result = detect_operations(
        step_path=box_with_pocket_step,
        file_id="test",
        object_ids=["obj_001"],
        tool_diameter=6.35,
    )
    pocket_ops = [op for op in result.operations if op.operation_type == "pocket"]
    assert len(pocket_ops) == 1
    pocket = pocket_ops[0]
    # Pocket depth should be less than full thickness (10mm)
    assert pocket.geometry.depth < 10.0
    assert pocket.geometry.depth > 0.0
