"""Test placement validation."""

from schemas import (
    PlacementItem,
    SheetMaterial,
    SheetSettings,
    BoundingBox,
)


def test_placement_within_bounds():
    """Placement within stock bounds should produce no warnings."""
    from main import _validate_placement
    placement = PlacementItem(
        object_id="obj_001",
        material_id="mtl_1",
        x_offset=10,
        y_offset=10,
        rotation=0,
    )
    stock = SheetMaterial(material_id="mtl_1", width=600, depth=400, thickness=18)
    bb = BoundingBox(x=100, y=50, z=10)
    warnings = _validate_placement(placement, stock, bb)
    assert len(warnings) == 0


def test_placement_out_of_bounds():
    """Placement exceeding stock bounds should produce a warning."""
    from main import _validate_placement
    placement = PlacementItem(
        object_id="obj_001",
        material_id="mtl_1",
        x_offset=550,
        y_offset=10,
        rotation=0,
    )
    stock = SheetMaterial(material_id="mtl_1", width=600, depth=400, thickness=18)
    bb = BoundingBox(x=100, y=50, z=10)
    warnings = _validate_placement(placement, stock, bb)
    assert len(warnings) > 0
    assert "X" in warnings[0]
