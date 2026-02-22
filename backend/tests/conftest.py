"""Test configuration and fixtures."""

import sys
from pathlib import Path

import pytest

# Add backend to path so imports work
sys.path.insert(0, str(Path(__file__).parent.parent))

FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def simple_box_step() -> Path:
    """Path to a simple 100x50x10mm box STEP file."""
    path = FIXTURES_DIR / "simple_box.step"
    if not path.exists():
        _generate_simple_box(path)
    return path


@pytest.fixture
def box_with_hole_step() -> Path:
    """Path to a 100x50x10mm box with a diameter-20mm through-hole STEP file."""
    path = FIXTURES_DIR / "box_with_hole.step"
    if not path.exists():
        _generate_box_with_hole(path)
    return path


@pytest.fixture
def box_with_small_hole_step() -> Path:
    """Path to a 100x50x10mm box with a diameter-4mm through-hole STEP file."""
    path = FIXTURES_DIR / "box_with_small_hole.step"
    if not path.exists():
        _generate_box_with_small_hole(path)
    return path


def _generate_simple_box(output_path: Path):
    """Generate a simple box STEP file using build123d."""
    from build123d import Box, export_step

    box = Box(100, 50, 10)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    export_step(box, str(output_path))


def _generate_box_with_hole(output_path: Path):
    """Generate a box with a 20mm-diameter through-hole."""
    from build123d import Box, Cylinder, Pos, export_step

    box = Box(100, 50, 10)
    hole = Pos(30, 0, 0) * Cylinder(10, 10)  # radius=10 → diameter=20mm
    result = box - hole
    output_path.parent.mkdir(parents=True, exist_ok=True)
    export_step(result, str(output_path))


def _generate_box_with_small_hole(output_path: Path):
    """Generate a box with a 4mm-diameter through-hole (smaller than 1/4\" endmill)."""
    from build123d import Box, Cylinder, Pos, export_step

    box = Box(100, 50, 10)
    hole = Pos(30, 0, 0) * Cylinder(2, 10)  # radius=2 → diameter=4mm
    result = box - hole
    output_path.parent.mkdir(parents=True, exist_ok=True)
    export_step(result, str(output_path))
