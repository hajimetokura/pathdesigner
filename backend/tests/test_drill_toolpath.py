"""Tests for peck drill toolpath generation."""

import math

from nodes.drill_toolpath import generate_drill_toolpath

# Penetration margin (same as in toolpath_gen.py)
PENETRATION_MARGIN = 0.3


def test_peck_drill_basic():
    """Peck drill with exact depth divisions."""
    passes = generate_drill_toolpath(
        center=[25.0, 15.0], total_depth=18.0, depth_per_peck=6.0, safe_z=38.0,
    )
    assert len(passes) == 3
    assert passes[0].z_depth == -6.0
    assert passes[1].z_depth == -12.0
    # Final pass goes past material bottom
    assert passes[2].z_depth == -(18.0 + PENETRATION_MARGIN)


def test_single_peck():
    """Shallow hole needs only one peck."""
    passes = generate_drill_toolpath(
        center=[10.0, 10.0], total_depth=4.0, depth_per_peck=6.0, safe_z=38.0,
    )
    assert len(passes) == 1
    assert passes[0].z_depth == -(4.0 + PENETRATION_MARGIN)


def test_non_divisible_depth():
    """Non-evenly divisible depth should round up number of pecks."""
    passes = generate_drill_toolpath(
        center=[10.0, 10.0], total_depth=10.0, depth_per_peck=3.0, safe_z=38.0,
    )
    # 10/3 = 3.33 → 4 pecks
    assert len(passes) == 4
    assert passes[0].z_depth == -3.0
    assert passes[1].z_depth == -6.0
    assert passes[2].z_depth == -9.0
    assert passes[3].z_depth == -(10.0 + PENETRATION_MARGIN)


def test_drill_path_is_center_point():
    """Each pass should move to the drill center point."""
    passes = generate_drill_toolpath(
        center=[30.0, 20.0], total_depth=12.0, depth_per_peck=6.0, safe_z=38.0,
    )
    for p in passes:
        assert p.path == [[30.0, 20.0]]


def test_drill_pass_numbers():
    """Pass numbers should be sequential 1-based."""
    passes = generate_drill_toolpath(
        center=[0.0, 0.0], total_depth=12.0, depth_per_peck=6.0, safe_z=38.0,
    )
    assert [p.pass_number for p in passes] == [1, 2]


def test_drill_no_tabs():
    """Drill passes should never have tabs."""
    passes = generate_drill_toolpath(
        center=[0.0, 0.0], total_depth=18.0, depth_per_peck=6.0, safe_z=38.0,
    )
    for p in passes:
        assert p.tabs == []
