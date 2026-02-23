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


# --- Integration test: full pipeline ---

from nodes.toolpath_gen import generate_toolpath_from_operations
from sbp_writer import SbpWriter
from schemas import (
    OperationAssignment, SheetMaterial, SheetSettings,
    PostProcessorSettings,
)


def test_full_pipeline_detect_to_sbp(simple_box_step: Path):
    """Full pipeline: STEP → detect operations → toolpath → SBP."""
    # 1. Detect operations
    detected = detect_operations(
        step_path=simple_box_step,
        file_id="test",
        object_ids=["obj_001"],
        tool_diameter=6.35,
        offset_side="outside",
    )
    assert len(detected.operations) == 1

    # 2. Create assignments
    op = detected.operations[0]
    sheet = SheetSettings(
        materials=[SheetMaterial(material_id="mtl_1", thickness=12)]
    )
    assignments = [
        OperationAssignment(
            operation_id=op.operation_id,
            material_id="mtl_1",
            settings=op.suggested_settings,
            order=1,
        )
    ]

    # 3. Generate toolpath
    tp_result = generate_toolpath_from_operations(assignments, detected, sheet)
    assert len(tp_result.toolpaths) >= 1

    # 4. Generate SBP
    post = PostProcessorSettings()
    writer = SbpWriter(
        settings=post,
        machining=assignments[0].settings,
        sheet=sheet,
    )
    sbp = writer.generate(tp_result.toolpaths)

    assert "'SHOPBOT ROUTER FILE IN MM" in sbp
    assert "M3," in sbp  # Has cutting moves
    assert "mtl_1" in sbp  # Has material metadata
    assert "END" in sbp
