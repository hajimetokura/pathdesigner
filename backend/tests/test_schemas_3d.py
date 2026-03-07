"""Tests for 3D roughing schema additions."""
from schemas import (
    MachiningSettings,
    DetectedOperation,
    OperationGeometry,
    OffsetApplied,
    default_settings_for,
)


def test_3d_roughing_default_settings():
    settings = default_settings_for("3d_roughing")
    assert settings.operation_type == "3d_roughing"
    assert settings.tool.type == "ballnose"
    assert settings.tool.diameter == 6.35
    assert settings.z_step == 3.0
    assert settings.stock_to_leave == 0.5


def test_3d_roughing_machining_settings_valid():
    s = default_settings_for("3d_roughing")
    assert isinstance(s, MachiningSettings)
    assert s.z_step == 3.0
    assert s.stock_to_leave == 0.5


def test_2d_settings_default_3d_fields_zero():
    """2D operation types should have z_step=0, stock_to_leave=0 by default."""
    s = default_settings_for("contour")
    assert s.z_step == 0
    assert s.stock_to_leave == 0


def test_detected_operation_3d_roughing():
    settings = default_settings_for("3d_roughing")
    op = DetectedOperation(
        operation_id="op_001",
        object_id="obj_1",
        operation_type="3d_roughing",
        geometry=OperationGeometry(
            contours=[],
            offset_applied=OffsetApplied(distance=0, side="none"),
            depth=50.0,
        ),
        suggested_settings=settings,
    )
    assert op.operation_type == "3d_roughing"
    assert op.suggested_settings.z_step == 3.0
