"""API tests for 3D roughing endpoint."""

import pytest
from fastapi.testclient import TestClient
from main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_3d_roughing_endpoint(client, simple_box_step):
    """Upload STEP then call 3D roughing endpoint with file_id."""
    with open(simple_box_step, "rb") as f:
        upload_resp = client.post(
            "/api/upload-step",
            files={"file": ("box.step", f, "application/octet-stream")},
        )
    assert upload_resp.status_code == 200
    file_id = upload_resp.json()["file_id"]

    resp = client.post(
        "/api/3d-roughing",
        json={"file_id": file_id, "z_step": 5.0, "stock_to_leave": 0.0},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "toolpaths" in data
    assert len(data["toolpaths"]) > 0

    tp = data["toolpaths"][0]
    assert tp["operation_id"].startswith("3d_roughing_")
    assert tp["contour_type"] == "exterior"
    assert len(tp["passes"]) > 0


def test_3d_roughing_invalid_file(client):
    """Should return 404 for non-existent file_id."""
    resp = client.post(
        "/api/3d-roughing",
        json={"file_id": "nonexistent_xyz", "z_step": 5.0},
    )
    assert resp.status_code == 404
