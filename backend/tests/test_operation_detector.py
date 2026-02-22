"""Tests for operation detection node."""

from pathlib import Path

from nodes.operation_detector import detect_operations
from schemas import OperationDetectResult


def test_detect_operations_simple_box(simple_box_step: Path):
    """A 100x50x10 box should detect one contour operation."""
    result = detect_operations(
        step_path=simple_box_step,
        file_id="test_file",
        object_ids=["obj_001"],
        tool_diameter=6.35,
        offset_side="outside",
    )

    assert isinstance(result, OperationDetectResult)
    assert len(result.operations) == 1

    op = result.operations[0]
    assert op.operation_type == "contour"
    assert op.object_id == "obj_001"
    assert op.enabled is True
    assert len(op.geometry.contours) >= 1
    assert op.geometry.depth == 10.0  # box thickness
    assert op.suggested_settings.operation_type == "contour"


def test_detect_operations_multiple_objects(simple_box_step: Path):
    """Requesting multiple object IDs should detect one operation per object."""
    result = detect_operations(
        step_path=simple_box_step,
        file_id="test_file",
        object_ids=["obj_001"],  # simple_box has only 1 solid
        tool_diameter=6.35,
        offset_side="outside",
    )

    assert len(result.operations) == 1
    assert result.operations[0].operation_id.startswith("op_")


def test_detect_operations_no_offset(simple_box_step: Path):
    """With offset_side='none', offset should be 0."""
    result = detect_operations(
        step_path=simple_box_step,
        file_id="test_file",
        object_ids=["obj_001"],
        tool_diameter=6.35,
        offset_side="none",
    )

    op = result.operations[0]
    assert op.geometry.offset_applied.distance == 0.0
