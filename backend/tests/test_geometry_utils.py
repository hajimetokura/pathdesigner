"""Tests for geometry_utils shared functions."""

import pytest

from nodes.geometry_utils import (
    COORD_PRECISION,
    intersect_solid_at_z,
    sample_wire_coords,
    transform_coords,
)


class TestSampleWireCoords:
    """Tests for sample_wire_coords using build123d."""

    def test_import(self):
        """sample_wire_coords is importable."""
        assert callable(sample_wire_coords)

    def test_coord_precision_default(self):
        """COORD_PRECISION constant exists and is 6."""
        assert COORD_PRECISION == 6

    def test_proportional_mode_returns_coords(self):
        """Proportional mode samples a wire and returns coordinate tuples."""
        from build123d import Rectangle

        rect = Rectangle(20, 10)
        wire = rect.wire()
        coords = sample_wire_coords(wire, num_points=100, mode="proportional")
        assert len(coords) > 4
        # Should be closed (first == last)
        assert coords[0] == coords[-1]
        # All coords are (float, float) tuples
        for c in coords:
            assert len(c) == 2

    def test_resolution_mode_returns_coords(self):
        """Resolution mode samples a wire with ~2mm spacing."""
        from build123d import Rectangle

        rect = Rectangle(20, 10)
        wire = rect.wire()
        coords = sample_wire_coords(wire, mode="resolution", resolution=2.0)
        assert len(coords) > 4
        assert coords[0] == coords[-1]

    def test_precision_parameter(self):
        """Custom precision limits decimal places."""
        from build123d import Rectangle

        rect = Rectangle(20, 10)
        wire = rect.wire()
        coords = sample_wire_coords(wire, mode="proportional", precision=4)
        for x, y in coords:
            # Check decimal places <= 4
            sx = f"{x:.10f}".rstrip("0")
            if "." in sx:
                assert len(sx.split(".")[1]) <= 4

    def test_invalid_mode_raises(self):
        """Invalid mode raises ValueError."""
        from build123d import Rectangle

        rect = Rectangle(20, 10)
        wire = rect.wire()
        with pytest.raises(ValueError, match="mode"):
            sample_wire_coords(wire, mode="invalid")


class TestIntersectSolidAtZ:
    """Tests for intersect_solid_at_z using build123d."""

    def test_import(self):
        """intersect_solid_at_z is importable."""
        assert callable(intersect_solid_at_z)

    def test_returns_typed_wires(self):
        """Returns list of (wire, contour_type) tuples for a simple box."""
        from build123d import Box

        box = Box(20, 10, 5)
        bb = box.bounding_box()
        typed_wires = intersect_solid_at_z(box, bb.min.Z + 0.01)
        assert len(typed_wires) > 0
        for wire, contour_type in typed_wires:
            assert contour_type in ("exterior", "interior")
            assert hasattr(wire, "edges")

    def test_result_is_list_of_tuples(self):
        """Return type is always list of (wire, str) tuples."""
        from build123d import Box

        box = Box(20, 10, 5)
        result = intersect_solid_at_z(box, 0.0)
        assert isinstance(result, list)
        for wire, ctype in result:
            assert ctype in ("exterior", "interior")

    def test_at_boundary_z(self):
        """Returns wires when slicing at exact boundary Z."""
        from build123d import Box

        box = Box(20, 10, 5)
        bb = box.bounding_box()
        # Exact boundary may or may not intersect, but should not raise
        typed_wires = intersect_solid_at_z(box, bb.min.Z)
        assert isinstance(typed_wires, list)


class TestTransformCoords:
    """Tests for transform_coords (rotate + translate)."""

    def test_no_rotation(self):
        """With rotation=0, only translation is applied."""
        coords = [[10.0, 20.0], [30.0, 40.0]]
        result = transform_coords(coords, rotation=0, rot_cx=0, rot_cy=0, dx=5, dy=-3)
        assert result == [[15.0, 17.0], [35.0, 37.0]]

    def test_rotation_90(self):
        """90-degree rotation around origin then translate."""
        coords = [[10.0, 0.0], [10.0, 0.0]]
        result = transform_coords(coords, rotation=90, rot_cx=0, rot_cy=0, dx=0, dy=0)
        # (10, 0) rotated 90° CCW around (0,0) → (0, 10)
        for c in result:
            assert abs(c[0] - 0.0) < 0.01
            assert abs(c[1] - 10.0) < 0.01

    def test_single_point(self):
        """Works with a single point (drill center)."""
        coords = [[5.0, 5.0]]
        result = transform_coords(coords, rotation=0, rot_cx=0, rot_cy=0, dx=10, dy=20)
        assert result == [[15.0, 25.0]]
