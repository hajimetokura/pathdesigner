"""Tests for outline-based collision detection in validate-placement."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def _make_request(placements, bounding_boxes, outlines=None, tool_diameter=6.35):
    body = {
        "placements": placements,
        "stock": {"materials": [{"material_id": "mtl_1", "thickness": 12, "width": 600, "depth": 400}]},
        "bounding_boxes": bounding_boxes,
    }
    if outlines is not None:
        body["outlines"] = outlines
    if tool_diameter is not None:
        body["tool_diameter"] = tool_diameter
    return client.post("/api/validate-placement", json=body)


def test_non_overlapping_placements_valid():
    """Two parts placed far apart should have no collision warnings."""
    placements = [
        {"object_id": "obj_001", "material_id": "mtl_1", "x_offset": 0, "y_offset": 0, "rotation": 0},
        {"object_id": "obj_002", "material_id": "mtl_1", "x_offset": 200, "y_offset": 0, "rotation": 0},
    ]
    bbs = {
        "obj_001": {"x": 100, "y": 50, "z": 10},
        "obj_002": {"x": 100, "y": 50, "z": 10},
    }
    resp = _make_request(placements, bbs)
    assert resp.status_code == 200
    data = resp.json()
    assert data["valid"] is True
    # No collision warnings (may have other warnings but no "Collision:")
    collision_warnings = [w for w in data["warnings"] if "Collision" in w or "collision" in w]
    assert len(collision_warnings) == 0


def test_overlapping_placements_detected():
    """Two parts placed at the same position should produce a collision warning."""
    placements = [
        {"object_id": "obj_001", "material_id": "mtl_1", "x_offset": 10, "y_offset": 10, "rotation": 0},
        {"object_id": "obj_002", "material_id": "mtl_1", "x_offset": 10, "y_offset": 10, "rotation": 0},
    ]
    bbs = {
        "obj_001": {"x": 100, "y": 50, "z": 10},
        "obj_002": {"x": 100, "y": 50, "z": 10},
    }
    resp = _make_request(placements, bbs)
    assert resp.status_code == 200
    data = resp.json()
    assert data["valid"] is False
    collision_warnings = [w for w in data["warnings"] if "衝突" in w.lower() or "collision" in w.lower()]
    assert len(collision_warnings) >= 1


def test_outline_based_collision():
    """Collision should use outline polygons when provided."""
    # L-shaped outline that doesn't overlap with a part placed in the gap
    l_outline = [[0, 0], [100, 0], [100, 20], [40, 20], [40, 50], [0, 50], [0, 0]]
    small_outline = [[0, 0], [50, 0], [50, 25], [0, 25], [0, 0]]

    placements = [
        {"object_id": "obj_001", "material_id": "mtl_1", "x_offset": 10, "y_offset": 10, "rotation": 0},
        {"object_id": "obj_002", "material_id": "mtl_1", "x_offset": 60, "y_offset": 35, "rotation": 0},
    ]
    bbs = {
        "obj_001": {"x": 100, "y": 50, "z": 10},
        "obj_002": {"x": 50, "y": 25, "z": 10},
    }
    outlines = {
        "obj_001": l_outline,
        "obj_002": small_outline,
    }
    # Without outlines (BB-based), these would overlap.
    # With outlines, obj_002 fits in the L-shape gap → no collision
    resp = _make_request(placements, bbs, outlines=outlines, tool_diameter=0)
    assert resp.status_code == 200
    data = resp.json()
    collision_warnings = [w for w in data["warnings"] if "衝突" in w.lower() or "collision" in w.lower()]
    assert len(collision_warnings) == 0


def test_tool_diameter_margin_causes_collision():
    """Parts close together should collide when tool diameter margin is applied."""
    # Two parts placed 5mm apart (edge to edge)
    placements = [
        {"object_id": "obj_001", "material_id": "mtl_1", "x_offset": 10, "y_offset": 10, "rotation": 0},
        {"object_id": "obj_002", "material_id": "mtl_1", "x_offset": 115, "y_offset": 10, "rotation": 0},
    ]
    bbs = {
        "obj_001": {"x": 100, "y": 50, "z": 10},
        "obj_002": {"x": 100, "y": 50, "z": 10},
    }
    # Gap = 115 - (10 + 100) = 5mm. Tool diameter = 6.35, margin = 3.175 per side → 6.35 total > 5mm gap
    resp = _make_request(placements, bbs, tool_diameter=6.35)
    data = resp.json()
    collision_warnings = [w for w in data["warnings"] if "衝突" in w.lower() or "collision" in w.lower()]
    assert len(collision_warnings) >= 1


def test_rotation_changes_collision():
    """Rotating a part may resolve or create collisions."""
    # 200x50 part at (10,10), 200x50 part at (10,70) — separated by 10mm in Y
    placements_no_rot = [
        {"object_id": "obj_001", "material_id": "mtl_1", "x_offset": 10, "y_offset": 10, "rotation": 0},
        {"object_id": "obj_002", "material_id": "mtl_1", "x_offset": 10, "y_offset": 70, "rotation": 0},
    ]
    bbs = {
        "obj_001": {"x": 200, "y": 50, "z": 10},
        "obj_002": {"x": 200, "y": 50, "z": 10},
    }
    # Without rotation: gap = 70 - (10+50) = 10mm, tool margin ~3.175 → no collision
    resp = _make_request(placements_no_rot, bbs, tool_diameter=0)
    data = resp.json()
    collision_warnings = [w for w in data["warnings"] if "衝突" in w.lower() or "collision" in w.lower()]
    assert len(collision_warnings) == 0

    # With obj_002 rotated 90°: a 200x50 part rotated becomes ~50x200 (centered on 100,25)
    # Rotated AABB center at (100,25), extends ±100 in Y → much taller, likely overlaps obj_001
    placements_rot = [
        {"object_id": "obj_001", "material_id": "mtl_1", "x_offset": 10, "y_offset": 10, "rotation": 0},
        {"object_id": "obj_002", "material_id": "mtl_1", "x_offset": 10, "y_offset": 70, "rotation": 90},
    ]
    resp2 = _make_request(placements_rot, bbs, tool_diameter=0)
    data2 = resp2.json()
    collision_warnings2 = [w for w in data2["warnings"] if "衝突" in w.lower() or "collision" in w.lower()]
    assert len(collision_warnings2) >= 1


def test_single_placement_no_collision():
    """Single part should never have collision warnings."""
    placements = [
        {"object_id": "obj_001", "material_id": "mtl_1", "x_offset": 10, "y_offset": 10, "rotation": 0},
    ]
    bbs = {"obj_001": {"x": 100, "y": 50, "z": 10}}
    resp = _make_request(placements, bbs)
    data = resp.json()
    collision_warnings = [w for w in data["warnings"] if "衝突" in w.lower() or "collision" in w.lower()]
    assert len(collision_warnings) == 0
