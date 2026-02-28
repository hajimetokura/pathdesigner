"""Tests for align node — flatten assembled solids for CNC."""

import tempfile
from pathlib import Path

import pytest
from build123d import Box, Pos, Compound, Solid, export_step
from fastapi.testclient import TestClient

from main import app
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


# --- API Tests ---


@pytest.fixture
def client():
    return TestClient(app)


def _upload_furniture_step(client) -> str:
    """Helper: create a furniture compound STEP, upload it, return file_id."""
    t = 18
    shelf = Box(400, 300, t)
    side = Box(t, 300, 600)
    top = Pos(200 + t/2, 0, 600 - t/2) * shelf
    left = Pos(0, 0, 300) * side
    compound = Compound(children=[left, top])

    with tempfile.NamedTemporaryFile(suffix=".step", delete=False) as f:
        export_step(compound, f.name)
        step_bytes = Path(f.name).read_bytes()

    resp = client.post(
        "/api/upload-step",
        files={"file": ("test.step", step_bytes, "application/octet-stream")},
    )
    assert resp.status_code == 200
    return resp.json()["file_id"]


def test_align_parts_endpoint(client):
    """POST /api/align-parts should return re-analyzed flat parts."""
    file_id = _upload_furniture_step(client)

    resp = client.post("/api/align-parts", json={"file_id": file_id})
    assert resp.status_code == 200

    data = resp.json()
    assert "file_id" in data
    assert data["file_id"] != file_id  # New file_id for aligned STEP
    assert len(data["objects"]) == 2

    for obj in data["objects"]:
        # All parts should have thickness ≈ 18mm (Z after alignment)
        assert obj["bounding_box"]["z"] == pytest.approx(18, abs=1.0)


def test_align_parts_file_not_found(client):
    """Should return 404 for unknown file_id."""
    resp = client.post("/api/align-parts", json={"file_id": "nonexistent"})
    assert resp.status_code == 404
