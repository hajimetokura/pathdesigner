"""API tests for 3D finishing endpoint."""

import pytest
from fastapi.testclient import TestClient
from main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_3d_finishing_endpoint(client, simple_box_step):
    """Upload STEP then generate finishing toolpath."""
    with open(simple_box_step, "rb") as f:
        upload_resp = client.post(
            "/api/upload-step",
            files={"file": ("box.step", f, "application/octet-stream")},
        )
    assert upload_resp.status_code == 200
    file_id = upload_resp.json()["file_id"]

    resp = client.post(
        "/api/3d-finishing",
        json={"file_id": file_id, "stepover": 0.3, "scan_angle": 0.0},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "toolpaths" in data
    assert len(data["toolpaths"]) > 0
    first_pass = data["toolpaths"][0]["passes"][0]
    assert len(first_pass["path"][0]) == 3


def test_3d_finishing_invalid_file(client):
    """Non-existent file_id should return 404."""
    resp = client.post(
        "/api/3d-finishing",
        json={"file_id": "nonexistent_xyz"},
    )
    assert resp.status_code == 404
