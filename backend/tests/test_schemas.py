"""Tests for schema validation."""

import pytest
from schemas import (
    SheetMaterial, SheetSettings,
    Contour, OffsetApplied, MachiningSettings,
    Tool, FeedRate, TabSettings,
    OperationGeometry, DetectedOperation, OperationDetectResult,
    OperationAssignment, OperationEditResult,
    PostProcessorSettings,
    ToolpathGenRequest, SbpGenRequest, ToolpathGenResult,
)


def test_sheet_material_defaults():
    mat = SheetMaterial(material_id="mtl_1")
    assert mat.width == 600
    assert mat.depth == 400
    assert mat.thickness == 18
    assert mat.x_position == 0
    assert mat.y_position == 0
    assert mat.label == ""


def test_sheet_settings_single_material():
    settings = SheetSettings(
        materials=[SheetMaterial(material_id="mtl_1", thickness=24)]
    )
    assert len(settings.materials) == 1
    assert settings.materials[0].thickness == 24


def test_sheet_settings_multiple_materials():
    settings = SheetSettings(
        materials=[
            SheetMaterial(material_id="mtl_1", thickness=15),
            SheetMaterial(material_id="mtl_2", thickness=24),
        ]
    )
    assert len(settings.materials) == 2


def test_sheet_settings_serialization():
    settings = SheetSettings(
        materials=[SheetMaterial(material_id="mtl_1", label="合板 18mm")]
    )
    data = settings.model_dump()
    restored = SheetSettings(**data)
    assert restored.materials[0].label == "合板 18mm"


def test_detected_operation_contour():
    geom = OperationGeometry(
        contours=[
            Contour(id="c_001", type="exterior", coords=[[0, 0], [10, 0], [10, 10], [0, 0]], closed=True)
        ],
        offset_applied=OffsetApplied(distance=3.175, side="outside"),
        depth=18.0,
    )
    op = DetectedOperation(
        operation_id="op_001",
        object_id="obj_001",
        operation_type="contour",
        geometry=geom,
        suggested_settings=MachiningSettings(
            operation_type="contour",
            tool=Tool(diameter=6.35, type="endmill", flutes=2),
            feed_rate=FeedRate(xy=75, z=25),
            jog_speed=200,
            spindle_speed=18000,
            depth_per_pass=6.0,
            total_depth=18.0,
            direction="climb",
            offset_side="outside",
            tabs=TabSettings(enabled=True, height=8, width=5, count=4),
        ),
    )
    assert op.enabled is True
    assert op.operation_type == "contour"


def test_operation_detect_result():
    result = OperationDetectResult(operations=[])
    assert len(result.operations) == 0


def test_operation_assignment():
    assignment = OperationAssignment(
        operation_id="op_001",
        material_id="mtl_1",
        settings=MachiningSettings(
            operation_type="contour",
            tool=Tool(diameter=6.35, type="endmill", flutes=2),
            feed_rate=FeedRate(xy=75, z=25),
            jog_speed=200,
            spindle_speed=18000,
            depth_per_pass=6.0,
            total_depth=18.0,
            direction="climb",
            offset_side="outside",
            tabs=TabSettings(enabled=True, height=8, width=5, count=4),
        ),
        order=1,
    )
    assert assignment.enabled is True
    assert assignment.material_id == "mtl_1"


def test_operation_edit_result():
    result = OperationEditResult(assignments=[])
    assert len(result.assignments) == 0


def test_post_processor_no_material():
    """PostProcessorSettings should not have a material field."""
    settings = PostProcessorSettings()
    assert "material" not in PostProcessorSettings.model_fields
    assert settings.safe_z == 38.0


def test_toolpath_gen_request_new_format():
    """ToolpathGenRequest should accept operations + detected_operations + sheet."""
    req = ToolpathGenRequest(
        operations=[],
        detected_operations=OperationDetectResult(operations=[]),
        sheet=SheetSettings(materials=[SheetMaterial(material_id="mtl_1")]),
    )
    assert len(req.operations) == 0


def test_sbp_gen_request_new_format():
    """SbpGenRequest should accept sheet instead of material in post_processor."""
    req = SbpGenRequest(
        toolpath_result=ToolpathGenResult(toolpaths=[]),
        operations=[],
        sheet=SheetSettings(materials=[SheetMaterial(material_id="mtl_1")]),
        post_processor=PostProcessorSettings(),
    )
    assert len(req.sheet.materials) == 1


def test_default_settings_for_contour():
    """default_settings_for('contour') should return valid contour settings."""
    from schemas import default_settings_for
    s = default_settings_for("contour")
    assert s.operation_type == "contour"
    assert s.tabs.enabled is True
    assert s.offset_side == "outside"


def test_default_settings_for_pocket():
    """default_settings_for('pocket') should return valid pocket settings."""
    from schemas import default_settings_for
    s = default_settings_for("pocket")
    assert s.operation_type == "pocket"
    assert s.tabs.enabled is False
    assert s.offset_side == "none"


def test_default_settings_for_drill():
    """default_settings_for('drill') should return valid drill settings."""
    from schemas import default_settings_for
    s = default_settings_for("drill")
    assert s.operation_type == "drill"
    assert s.tabs.enabled is False
    assert s.depth_per_peck > 0


def test_machining_settings_pocket():
    """Pocket settings should use pocket-specific fields."""
    settings = MachiningSettings(
        operation_type="pocket",
        tool=Tool(diameter=6.35, type="endmill", flutes=2),
        feed_rate=FeedRate(xy=50, z=20),
        jog_speed=200,
        spindle_speed=18000,
        depth_per_pass=3.0,
        total_depth=6.0,
        direction="climb",
        offset_side="none",
        tabs=TabSettings(enabled=False, height=0, width=0, count=0),
        pocket_pattern="contour-parallel",
        pocket_stepover=0.4,
    )
    assert settings.operation_type == "pocket"
    assert settings.pocket_pattern == "contour-parallel"
    assert settings.pocket_stepover == 0.4


def test_machining_settings_drill():
    """Drill settings should use drill-specific fields."""
    settings = MachiningSettings(
        operation_type="drill",
        tool=Tool(diameter=3.0, type="endmill", flutes=2),
        feed_rate=FeedRate(xy=50, z=15),
        jog_speed=200,
        spindle_speed=18000,
        depth_per_pass=3.0,
        total_depth=18.0,
        direction="climb",
        offset_side="none",
        tabs=TabSettings(enabled=False, height=0, width=0, count=0),
        depth_per_peck=4.0,
    )
    assert settings.operation_type == "drill"
    assert settings.depth_per_peck == 4.0


def test_api_imports():
    """Verify main.py can import all required schemas and functions."""
    from main import app
    assert app.title == "PathDesigner"
