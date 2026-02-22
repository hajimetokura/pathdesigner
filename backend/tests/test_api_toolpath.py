"""Tests for toolpath generation and SBP generation API endpoints."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

CONTOUR_RESULT = {
    "object_id": "obj_001",
    "slice_z": 0.0,
    "contours": [
        {
            "id": "contour_001",
            "type": "exterior",
            "coords": [[0, 0], [100, 0], [100, 50], [0, 50], [0, 0]],
            "closed": True,
        }
    ],
    "offset_applied": {"distance": 3.175, "side": "outside"},
}

MACHINING_SETTINGS = {
    "operation_type": "contour",
    "tool": {"diameter": 6.35, "type": "endmill", "flutes": 2},
    "feed_rate": {"xy": 75.0, "z": 25.0},
    "jog_speed": 200.0,
    "spindle_speed": 18000,
    "depth_per_pass": 6.0,
    "total_depth": 18.0,
    "direction": "climb",
    "offset_side": "outside",
    "tabs": {"enabled": True, "height": 8.0, "width": 5.0, "count": 4},
}


def test_generate_toolpath_endpoint():
    """POST /api/generate-toolpath should return toolpaths."""
    resp = client.post(
        "/api/generate-toolpath",
        json={
            "contour_result": CONTOUR_RESULT,
            "machining_settings": MACHINING_SETTINGS,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "toolpaths" in data
    assert len(data["toolpaths"]) == 1
    assert len(data["toolpaths"][0]["passes"]) == 3


def test_generate_sbp_endpoint():
    """POST /api/generate-sbp should return SBP code."""
    # First generate toolpaths
    tp_resp = client.post(
        "/api/generate-toolpath",
        json={
            "contour_result": CONTOUR_RESULT,
            "machining_settings": MACHINING_SETTINGS,
        },
    )
    toolpath_result = tp_resp.json()

    # Then generate SBP
    resp = client.post(
        "/api/generate-sbp",
        json={
            "toolpath_result": toolpath_result,
            "machining_settings": MACHINING_SETTINGS,
            "post_processor": {},  # use defaults
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "sbp_code" in data
    assert "filename" in data
    assert "SHOPBOT ROUTER FILE" in data["sbp_code"]
    assert data["filename"].endswith(".sbp")
