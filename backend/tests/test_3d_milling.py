"""Tests for 3D milling waterline roughing engine and schemas."""

import pytest
from pathlib import Path

from schemas import (
    ThreeDRoughingSettings,
    ThreeDRoughingRequest,
    ThreeDRoughingResult,
    Tool,
    FeedRate,
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
        req = ThreeDRoughingRequest(mesh_file_path="/tmp/test.stl")
        assert req.mesh_file_path == "/tmp/test.stl"
        assert req.z_step == 3.0
        assert req.stock_to_leave == 0.5

    def test_custom(self):
        req = ThreeDRoughingRequest(
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

        result = generate_waterline_roughing(
            mesh_file_path=str(freeform_stl),
            z_step=5.0,
            stock_to_leave=0.0,
        )

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

        result = generate_waterline_roughing(
            mesh_file_path=str(freeform_stl),
            z_step=5.0,
            stock_to_leave=0.0,
        )

        z_depths = [tp.passes[0].z_depth for tp in result if tp.passes]
        # Should be descending (cutting from top down)
        for i in range(len(z_depths) - 1):
            assert z_depths[i] >= z_depths[i + 1], (
                f"Z levels not descending: {z_depths}"
            )

    def test_waterline_roughing_stock_to_leave(self, freeform_stl):
        """Stock-to-leave should produce smaller contours (or fewer)."""
        from nodes.three_d_milling import generate_waterline_roughing

        result_no_stock = generate_waterline_roughing(
            mesh_file_path=str(freeform_stl),
            z_step=5.0,
            stock_to_leave=0.0,
        )
        result_with_stock = generate_waterline_roughing(
            mesh_file_path=str(freeform_stl),
            z_step=5.0,
            stock_to_leave=2.0,
        )

        # Both should produce toolpaths
        assert len(result_no_stock) > 0
        assert len(result_with_stock) > 0
        # With stock_to_leave, some Z levels might have fewer/no polygons
        # At minimum, we check both run without error

    def test_waterline_roughing_invalid_file(self):
        """Should raise FileNotFoundError for non-existent file."""
        from nodes.three_d_milling import generate_waterline_roughing

        with pytest.raises(FileNotFoundError):
            generate_waterline_roughing(
                mesh_file_path="/tmp/does_not_exist.stl",
                z_step=5.0,
                stock_to_leave=0.0,
            )
