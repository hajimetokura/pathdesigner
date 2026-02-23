"""Tests for geometry_utils shared functions."""

import pytest

from nodes.geometry_utils import COORD_PRECISION, sample_wire_coords


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
