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


def _generate_simple_box(output_path: Path):
    """Generate a simple box STEP file using build123d."""
    from build123d import Box, export_step

    box = Box(100, 50, 10)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    export_step(box, str(output_path))
