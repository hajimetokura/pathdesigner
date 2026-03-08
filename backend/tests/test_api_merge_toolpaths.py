"""API tests for toolpath merge endpoint."""

import pytest
from fastapi.testclient import TestClient
from main import app
from schemas import Toolpath, ToolpathPass, ToolpathGenResult


@pytest.fixture
def client():
    return TestClient(app)


def test_merge_toolpaths_concatenates(client):
    """Merge endpoint should concatenate toolpath lists."""
    tp1 = ToolpathGenResult(toolpaths=[
        Toolpath(
            operation_id="roughing_001",
            object_id="obj_001",
            contour_type="3d_roughing",
            passes=[ToolpathPass(pass_number=1, z_depth=-5, path=[[0, 0, -5], [10, 0, -5]], tabs=[])],
        ),
    ])
    tp2 = ToolpathGenResult(toolpaths=[
        Toolpath(
            operation_id="finishing_001",
            object_id="obj_001",
            contour_type="3d_finishing",
            passes=[ToolpathPass(pass_number=1, z_depth=-3, path=[[0, 0, -3], [10, 0, -2]], tabs=[])],
        ),
    ])

    resp = client.post(
        "/api/merge-toolpaths",
        json={
            "sources": [tp1.model_dump(), tp2.model_dump()],
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["toolpaths"]) == 2
    assert data["toolpaths"][0]["contour_type"] == "3d_roughing"
    assert data["toolpaths"][1]["contour_type"] == "3d_finishing"
