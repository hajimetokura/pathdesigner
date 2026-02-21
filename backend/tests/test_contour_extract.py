"""Tests for contour extraction node."""

from pathlib import Path

from nodes.contour_extract import extract_contours
from schemas import ContourExtractResult


def test_extract_contours_simple_box(simple_box_step: Path):
    """A 100x50x10 box should produce one closed exterior contour."""
    result = extract_contours(
        step_path=simple_box_step,
        object_id="obj_001",
        tool_diameter=6.35,
        offset_side="outside",
    )

    assert isinstance(result, ContourExtractResult)
    assert result.object_id == "obj_001"
    assert result.slice_z == -5.0  # Box(100,50,10) centered at origin → bottom at -5
    assert len(result.contours) >= 1

    exterior = [c for c in result.contours if c.type == "exterior"]
    assert len(exterior) == 1
    assert exterior[0].closed is True
    assert len(exterior[0].coords) >= 4  # At least 4 points for a rectangle

    assert result.offset_applied.distance > 0
    assert result.offset_applied.side == "outside"


def test_extract_contours_no_offset(simple_box_step: Path):
    """With offset_side='none', raw contour should be returned."""
    result = extract_contours(
        step_path=simple_box_step,
        object_id="obj_001",
        tool_diameter=6.35,
        offset_side="none",
    )

    assert result.offset_applied.distance == 0.0
    assert result.offset_applied.side == "none"
    assert len(result.contours) >= 1


def test_extract_contours_coords_are_2d(simple_box_step: Path):
    """All coordinates should be [x, y] pairs (2D)."""
    result = extract_contours(
        step_path=simple_box_step,
        object_id="obj_001",
        tool_diameter=6.35,
        offset_side="outside",
    )

    for contour in result.contours:
        for coord in contour.coords:
            assert len(coord) == 2, f"Expected 2D coord, got {coord}"


def test_extract_contours_offset_expands_box(simple_box_step: Path):
    """Outside offset should make the bounding region larger than 100x50."""
    result_no_offset = extract_contours(
        step_path=simple_box_step,
        object_id="obj_001",
        tool_diameter=6.35,
        offset_side="none",
    )
    result_with_offset = extract_contours(
        step_path=simple_box_step,
        object_id="obj_001",
        tool_diameter=6.35,
        offset_side="outside",
    )

    from shapely.geometry import Polygon

    poly_raw = Polygon(result_no_offset.contours[0].coords)
    poly_offset = Polygon(result_with_offset.contours[0].coords)

    assert poly_offset.area > poly_raw.area
