"""Tests for pocket toolpath generation (contour-parallel + raster)."""

from shapely.geometry import Polygon

from nodes.pocket_toolpath import generate_pocket_contour_parallel, generate_pocket_raster


class TestContourParallel:
    def test_rectangular_pocket(self):
        """Rectangular pocket produces multiple offset rings."""
        polygon = Polygon([(0, 0), (50, 0), (50, 30), (0, 30)])
        paths = generate_pocket_contour_parallel(polygon, tool_diameter=6.35, stepover=0.5)
        assert len(paths) > 1

    def test_rings_shrink_inward(self):
        """Each successive ring should be smaller than the previous."""
        polygon = Polygon([(0, 0), (80, 0), (80, 60), (0, 60)])
        paths = generate_pocket_contour_parallel(polygon, tool_diameter=6.35, stepover=0.5)
        areas = []
        for path in paths:
            p = Polygon(path)
            if p.is_valid and not p.is_empty:
                areas.append(p.area)
        # Areas should be monotonically decreasing
        for i in range(1, len(areas)):
            assert areas[i] < areas[i - 1]

    def test_small_polygon_returns_at_least_one(self):
        """A polygon just larger than tool diameter should produce at least 1 path."""
        polygon = Polygon([(0, 0), (10, 0), (10, 10), (0, 10)])
        paths = generate_pocket_contour_parallel(polygon, tool_diameter=6.35, stepover=0.5)
        assert len(paths) >= 1

    def test_tiny_polygon_returns_empty(self):
        """A polygon smaller than tool radius should return empty."""
        polygon = Polygon([(0, 0), (2, 0), (2, 2), (0, 2)])
        paths = generate_pocket_contour_parallel(polygon, tool_diameter=6.35, stepover=0.5)
        assert len(paths) == 0

    def test_circular_pocket(self):
        """Circular pocket (from Phase 11.1) should produce concentric rings."""
        import math
        n = 64
        r = 15
        coords = [(r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n)) for i in range(n)]
        polygon = Polygon(coords)
        paths = generate_pocket_contour_parallel(polygon, tool_diameter=6.35, stepover=0.5)
        assert len(paths) >= 2


class TestRaster:
    def test_rectangular_pocket(self):
        """Rectangular pocket produces zigzag scan lines."""
        polygon = Polygon([(0, 0), (50, 0), (50, 30), (0, 30)])
        paths = generate_pocket_raster(polygon, tool_diameter=6.35, stepover=0.5)
        assert len(paths) > 1

    def test_alternating_direction(self):
        """Successive scan lines should alternate direction (zigzag)."""
        polygon = Polygon([(0, 0), (50, 0), (50, 30), (0, 30)])
        paths = generate_pocket_raster(polygon, tool_diameter=6.35, stepover=0.5)
        if len(paths) >= 2:
            # Check that first point X values alternate between left and right sides
            first_x_0 = paths[0][0][0]
            first_x_1 = paths[1][0][0]
            # They should start from different sides
            assert abs(first_x_0 - first_x_1) > 10  # significantly different start points

    def test_tiny_polygon_returns_empty(self):
        """A polygon smaller than tool diameter should return empty."""
        polygon = Polygon([(0, 0), (2, 0), (2, 2), (0, 2)])
        paths = generate_pocket_raster(polygon, tool_diameter=6.35, stepover=0.5)
        assert len(paths) == 0
