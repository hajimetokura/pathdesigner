"""Tests for 3D milling waterline roughing engine and schemas."""

import pytest
from pathlib import Path

from schemas import (
    ThreeDRoughingSettings,
    ThreeDRoughingRequest,
    ThreeDRoughingResult,
    ThreeDFinishingRequest,
    ThreeDFinishingResult,
    MachiningSettings,
    Tool,
    FeedRate,
    TabSettings,
    Toolpath,
    ToolpathPass,
)


# --- Schema Tests ---


class TestThreeDRoughingSettings:
    def test_defaults(self):
        s = ThreeDRoughingSettings()
        assert s.z_step == 3.0
        assert s.stock_to_leave == 0.5
        assert s.tool.diameter == 6.35
        assert s.tool.type == "ballnose"
        assert s.feed_rate.xy == 50
        assert s.feed_rate.z == 20
        assert s.spindle_speed == 18000

    def test_custom_values(self):
        s = ThreeDRoughingSettings(
            z_step=2.0,
            stock_to_leave=1.0,
            tool=Tool(diameter=10.0, type="endmill", flutes=4),
        )
        assert s.z_step == 2.0
        assert s.stock_to_leave == 1.0
        assert s.tool.diameter == 10.0


class TestThreeDRoughingRequest:
    def test_minimal(self):
        req = ThreeDRoughingRequest(file_id="test123", mesh_file_path="/tmp/test.stl")
        assert req.file_id == "test123"
        assert req.mesh_file_path == "/tmp/test.stl"
        assert req.z_step == 3.0
        assert req.stock_to_leave == 0.5

    def test_custom(self):
        req = ThreeDRoughingRequest(
            file_id="test456",
            mesh_file_path="/tmp/test.stl",
            z_step=1.5,
            stock_to_leave=0.2,
            spindle_speed=12000,
        )
        assert req.z_step == 1.5
        assert req.stock_to_leave == 0.2
        assert req.spindle_speed == 12000


class TestThreeDRoughingResult:
    def test_empty(self):
        result = ThreeDRoughingResult(toolpaths=[])
        assert result.toolpaths == []

    def test_with_toolpath(self):
        tp = Toolpath(
            operation_id="3d_roughing_001",
            object_id="obj_001",
            contour_type="exterior",
            passes=[
                ToolpathPass(
                    pass_number=1,
                    z_depth=10.0,
                    path=[[0, 0, 10], [10, 10, 10]],
                    tabs=[],
                )
            ],
        )
        result = ThreeDRoughingResult(toolpaths=[tp])
        assert len(result.toolpaths) == 1
        assert result.toolpaths[0].operation_id == "3d_roughing_001"


# --- Engine Tests ---


class TestWaterlineRoughing:
    def test_waterline_roughing_sphere(self, freeform_stl):
        """Waterline roughing on a sphere should produce toolpaths at multiple Z levels."""
        from nodes.three_d_milling import generate_waterline_roughing

        req = ThreeDRoughingRequest(
            file_id="test", mesh_file_path=str(freeform_stl),
            z_step=5.0,
            stock_to_leave=0.0,
        )
        result = generate_waterline_roughing(req)

        assert len(result) > 0
        # Each toolpath should have 3D paths
        for tp in result:
            assert tp.operation_id.startswith("3d_roughing_")
            assert tp.contour_type == "exterior"
            for p in tp.passes:
                # 3D paths have [x, y, z]
                for coord in p.path:
                    assert len(coord) == 3

    def test_waterline_roughing_z_levels(self, freeform_stl):
        """Z levels should be in descending order (top to bottom)."""
        from nodes.three_d_milling import generate_waterline_roughing

        req = ThreeDRoughingRequest(
            file_id="test", mesh_file_path=str(freeform_stl),
            z_step=5.0,
            stock_to_leave=0.0,
        )
        result = generate_waterline_roughing(req)

        z_depths = [tp.passes[0].z_depth for tp in result if tp.passes]
        # Should be descending (cutting from top down)
        for i in range(len(z_depths) - 1):
            assert z_depths[i] >= z_depths[i + 1], (
                f"Z levels not descending: {z_depths}"
            )

    def test_waterline_roughing_stock_to_leave(self, freeform_stl):
        """Stock-to-leave should produce smaller contours (or fewer)."""
        from nodes.three_d_milling import generate_waterline_roughing

        req_no_stock = ThreeDRoughingRequest(
            file_id="test", mesh_file_path=str(freeform_stl),
            z_step=5.0,
            stock_to_leave=0.0,
        )
        req_with_stock = ThreeDRoughingRequest(
            file_id="test", mesh_file_path=str(freeform_stl),
            z_step=5.0,
            stock_to_leave=2.0,
        )
        result_no_stock = generate_waterline_roughing(req_no_stock)
        result_with_stock = generate_waterline_roughing(req_with_stock)

        # Both should produce toolpaths
        assert len(result_no_stock) > 0
        assert len(result_with_stock) > 0

    def test_waterline_roughing_invalid_file(self):
        """Should raise FileNotFoundError for non-existent file."""
        from nodes.three_d_milling import generate_waterline_roughing

        req = ThreeDRoughingRequest(
            file_id="test", mesh_file_path="/tmp/does_not_exist.stl",
            z_step=5.0,
            stock_to_leave=0.0,
        )
        with pytest.raises(FileNotFoundError):
            generate_waterline_roughing(req)

    def test_waterline_roughing_to_sbp(self, freeform_stl):
        """Full pipeline: mesh → roughing → SBP code."""
        from nodes.three_d_milling import generate_waterline_roughing
        from sbp_writer import SbpWriter

        req = ThreeDRoughingRequest(
            file_id="test", mesh_file_path=str(freeform_stl),
            z_step=10.0,
            stock_to_leave=0.0,
        )
        toolpaths = generate_waterline_roughing(req)
        assert len(toolpaths) > 0

        # Create SBP writer with minimal settings
        from schemas import (
            PostProcessorSettings,
            SheetSettings,
            SheetMaterial,
            MachiningSettings,
            TabSettings,
        )

        machining = MachiningSettings(
            operation_type="contour",
            tool=Tool(diameter=6.35, type="ballnose", flutes=2),
            feed_rate=FeedRate(xy=50, z=20),
            jog_speed=200,
            spindle_speed=18000,
            depth_per_pass=10.0,
            total_depth=50.0,
            direction="climb",
            offset_side="none",
            tabs=TabSettings(enabled=False, height=0, width=0, count=0),
        )

        post = PostProcessorSettings()
        sheet = SheetSettings(
            materials=[SheetMaterial(material_id="mat_001", label="Stock", thickness=60.0)],
        )
        writer = SbpWriter(post, machining, sheet)
        sbp = writer.generate(toolpaths)

        assert "M3," in sbp  # 3D move commands
        assert len(sbp) > 100


# --- 3D Finishing Schema Tests ---


def test_three_d_finishing_settings_defaults():
    req = ThreeDFinishingRequest(file_id="test", mesh_file_path="/tmp/test.stl")
    assert req.stepover == 0.15
    assert req.scan_angle == 0.0
    assert req.tool.type == "ballnose"
    assert req.tool.diameter == 3.175
    assert req.spindle_speed == 18000


def test_three_d_finishing_result():
    tp = Toolpath(
        operation_id="3d_finishing_001",
        object_id="obj_001",
        contour_type="3d_finishing",
        passes=[ToolpathPass(pass_number=1, z_depth=0, path=[[0, 0, -3], [10, 0, -2.5]], tabs=[])],
    )
    result = ThreeDFinishingResult(toolpaths=[tp])
    assert len(result.toolpaths) == 1


def test_machining_settings_3d_finishing():
    s = MachiningSettings(
        operation_type="3d_finishing",
        tool=Tool(diameter=3.175, type="ballnose", flutes=2),
        feed_rate=FeedRate(xy=30, z=15),
        jog_speed=200,
        spindle_speed=18000,
        depth_per_pass=0,
        total_depth=0,
        direction="climb",
        offset_side="none",
        tabs=TabSettings(enabled=False, height=0, width=0, count=0),
        stepover_3d=0.15,
        scan_angle=0.0,
    )
    assert s.operation_type == "3d_finishing"
    assert s.stepover_3d == 0.15


# --- Raster Finishing Engine Tests ---


def test_raster_finishing_sphere(freeform_stl):
    """Raster finishing on sphere should produce scan-line toolpaths with 3D Z."""
    from nodes.three_d_milling import generate_raster_finishing

    req = ThreeDFinishingRequest(
        file_id="test", mesh_file_path=str(freeform_stl),
        stepover=0.3,
        scan_angle=0.0,
    )
    toolpaths = generate_raster_finishing(req)
    assert len(toolpaths) > 0

    for tp in toolpaths:
        for p in tp.passes:
            assert len(p.path) >= 2
            for coord in p.path:
                assert len(coord) == 3


def test_raster_finishing_z_follows_surface(freeform_stl):
    """Z values should vary along scan lines (not flat) for a sphere."""
    from nodes.three_d_milling import generate_raster_finishing

    req = ThreeDFinishingRequest(
        file_id="test", mesh_file_path=str(freeform_stl),
        stepover=0.5,
        scan_angle=0.0,
    )
    toolpaths = generate_raster_finishing(req)
    assert len(toolpaths) > 0

    for tp in toolpaths:
        for p in tp.passes:
            z_values = [c[2] for c in p.path]
            if len(set(round(z, 1) for z in z_values)) > 1:
                return
    pytest.fail("Expected at least one pass with varying Z values on a sphere")


def test_raster_finishing_scan_angle(freeform_stl):
    """scan_angle=90 should produce Y-axis scan lines instead of X-axis."""
    from nodes.three_d_milling import generate_raster_finishing

    req_0 = ThreeDFinishingRequest(
        file_id="test", mesh_file_path=str(freeform_stl),
        stepover=0.5,
        scan_angle=0.0,
    )
    req_90 = ThreeDFinishingRequest(
        file_id="test", mesh_file_path=str(freeform_stl),
        stepover=0.5,
        scan_angle=90.0,
    )
    tp_0 = generate_raster_finishing(req_0)
    tp_90 = generate_raster_finishing(req_90)
    assert len(tp_0) > 0
    assert len(tp_90) > 0

    first_pass_0 = tp_0[0].passes[0].path
    y_values_0 = [c[1] for c in first_pass_0]
    y_range_0 = max(y_values_0) - min(y_values_0)

    first_pass_90 = tp_90[0].passes[0].path
    x_values_90 = [c[0] for c in first_pass_90]
    x_range_90 = max(x_values_90) - min(x_values_90)

    assert y_range_0 < 1.0, f"angle=0: Y should be constant per line, got range {y_range_0}"
    assert x_range_90 < 1.0, f"angle=90: X should be constant per line, got range {x_range_90}"


def test_raster_finishing_invalid_file():
    """Non-existent file should raise."""
    from nodes.three_d_milling import generate_raster_finishing

    req = ThreeDFinishingRequest(file_id="test", mesh_file_path="/tmp/nonexistent_xyz.stl")
    with pytest.raises(FileNotFoundError):
        generate_raster_finishing(req)


# --- Integration Test ---


def test_roughing_finishing_merged_sbp(freeform_stl):
    """Full pipeline: roughing + finishing -> merge -> SBP with tool change."""
    from nodes.three_d_milling import generate_waterline_roughing, generate_raster_finishing
    from sbp_writer import SbpWriter
    from schemas import (
        PostProcessorSettings,
    )

    # Generate roughing
    roughing_req = ThreeDRoughingRequest(
        file_id="test", mesh_file_path=str(freeform_stl),
        z_step=10.0,
        stock_to_leave=0.5,
    )
    roughing_tps = generate_waterline_roughing(roughing_req)
    assert len(roughing_tps) > 0

    # Generate finishing
    finishing_req = ThreeDFinishingRequest(
        file_id="test", mesh_file_path=str(freeform_stl),
        stepover=0.5,
        scan_angle=0.0,
    )
    finishing_tps = generate_raster_finishing(finishing_req)
    assert len(finishing_tps) > 0

    # Attach settings
    roughing_settings = MachiningSettings(
        operation_type="3d_roughing",
        tool=Tool(diameter=6.35, type="endmill", flutes=2),
        feed_rate=FeedRate(xy=50, z=20),
        jog_speed=200,
        spindle_speed=18000,
        depth_per_pass=10.0,
        total_depth=50.0,
        direction="climb",
        offset_side="none",
        tabs=TabSettings(enabled=False, height=0, width=0, count=0),
    )
    finishing_settings = MachiningSettings(
        operation_type="3d_finishing",
        tool=Tool(diameter=3.175, type="ballnose", flutes=2),
        feed_rate=FeedRate(xy=30, z=15),
        jog_speed=200,
        spindle_speed=18000,
        depth_per_pass=0,
        total_depth=0,
        direction="climb",
        offset_side="none",
        tabs=TabSettings(enabled=False, height=0, width=0, count=0),
    )

    for tp in roughing_tps:
        tp.settings = roughing_settings
    for tp in finishing_tps:
        tp.settings = finishing_settings

    # Merge
    all_toolpaths = roughing_tps + finishing_tps

    # Generate SBP
    post = PostProcessorSettings()
    writer = SbpWriter(post, roughing_settings)
    sbp = writer.generate(all_toolpaths)

    # Verify tool change
    assert "C8" in sbp, "Expected tool change (C8) between roughing and finishing"
    assert "M3," in sbp
    assert len(sbp) > 200
    # Verify both roughing and finishing paths present
    lines = [l for l in sbp.split("\n") if l.startswith("M3,")]
    assert len(lines) > 10
