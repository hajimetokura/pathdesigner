"""Tests for align node — flatten assembled solids for CNC."""

import pytest
from build123d import Box, Pos, Compound, Solid

from nodes.align import align_solids


def test_flat_box_unchanged():
    """A flat box (X > Z) should stay roughly the same orientation."""
    flat = Box(100, 50, 10)
    results = align_solids([flat])
    assert len(results) == 1
    bb = results[0].bounding_box()
    # Thickness (smallest dim) should be Z
    assert bb.size.Z == pytest.approx(10, abs=0.5)
    assert bb.size.X == pytest.approx(100, abs=0.5)
    # Bottom should sit at Z=0
    assert bb.min.Z == pytest.approx(0, abs=0.1)


def test_standing_panel_gets_laid_flat():
    """A vertical panel (thin in X) should be rotated so thin dim becomes Z."""
    # 18mm thick, 300 deep, 600 tall → standing panel
    standing = Box(18, 300, 600)
    results = align_solids([standing])
    assert len(results) == 1
    bb = results[0].bounding_box()
    # After alignment, Z should be the thinnest dimension (18mm)
    assert bb.size.Z == pytest.approx(18, abs=0.5)
    assert bb.min.Z == pytest.approx(0, abs=0.1)


def test_multiple_solids():
    """Multiple solids should all be aligned independently."""
    flat = Box(100, 50, 10)
    standing = Box(18, 300, 600)
    results = align_solids([flat, standing])
    assert len(results) == 2
    for r in results:
        bb = r.bounding_box()
        assert bb.min.Z == pytest.approx(0, abs=0.1)


def test_compound_solids_from_furniture():
    """Simulate a simple shelf: side panels + shelves in assembled position."""
    t = 18
    shelf = Box(400, 300, t)
    side = Box(t, 300, 600)

    top = Pos(200 + t/2, 0, 600 - t/2) * shelf
    bottom = Pos(200 + t/2, 0, t/2) * shelf
    left = Pos(0, 0, 300) * side
    right = Pos(400 + t, 0, 300) * side

    compound = Compound(children=[left, right, top, bottom])
    solids = list(compound.solids())
    results = align_solids(solids)

    assert len(results) == 4
    for r in results:
        bb = r.bounding_box()
        # All pieces should have Z = 18 (board thickness)
        assert bb.size.Z == pytest.approx(18, abs=1.0)
        # All should sit at Z=0
        assert bb.min.Z == pytest.approx(0, abs=0.1)
