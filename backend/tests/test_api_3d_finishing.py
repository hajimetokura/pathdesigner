"""API tests for 3D finishing endpoint."""

import pytest
from fastapi.testclient import TestClient
from main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_3d_finishing_endpoint(client, freeform_stl):
    """Upload STL then generate finishing toolpath."""
    with open(freeform_stl, "rb") as f:
        upload_resp = client.post(
            "/api/upload-mesh",
            files={"file": ("sphere.stl", f, "application/octet-stream")},
        )
    assert upload_resp.status_code == 200
    mesh_path = upload_resp.json()["mesh_file_path"]

    resp = client.post(
        "/api/3d-finishing",
        json={
            "mesh_file_path": mesh_path,
            "stepover": 0.3,
            "scan_angle": 0.0,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "toolpaths" in data
    assert len(data["toolpaths"]) > 0
    first_pass = data["toolpaths"][0]["passes"][0]
    assert len(first_pass["path"][0]) == 3


def test_3d_finishing_invalid_file(client):
    """Non-existent mesh file should return 400."""
    resp = client.post(
        "/api/3d-finishing",
        json={"mesh_file_path": "/tmp/nonexistent_xyz.stl"},
    )
    assert resp.status_code == 400
