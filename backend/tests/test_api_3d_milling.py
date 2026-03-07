"""API tests for 3D roughing endpoint."""

import io

import pytest
from fastapi.testclient import TestClient
from main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_3d_roughing_endpoint(client, freeform_stl):
    """Upload STL then call 3D roughing endpoint."""
    # First upload the mesh
    with open(freeform_stl, "rb") as f:
        upload_resp = client.post(
            "/api/upload-mesh",
            files={"file": ("sphere.stl", f, "application/octet-stream")},
        )
    assert upload_resp.status_code == 200
    mesh_file_path = upload_resp.json()["mesh_file_path"]

    # Call roughing endpoint
    resp = client.post(
        "/api/3d-roughing",
        json={
            "mesh_file_path": mesh_file_path,
            "z_step": 5.0,
            "stock_to_leave": 0.0,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "toolpaths" in data
    assert len(data["toolpaths"]) > 0

    # Verify toolpath structure
    tp = data["toolpaths"][0]
    assert tp["operation_id"].startswith("3d_roughing_")
    assert tp["contour_type"] == "exterior"
    assert len(tp["passes"]) > 0


def test_3d_roughing_invalid_file(client):
    """Should return 400 for non-existent mesh file."""
    resp = client.post(
        "/api/3d-roughing",
        json={
            "mesh_file_path": "/tmp/does_not_exist_xyz.stl",
            "z_step": 5.0,
        },
    )
    assert resp.status_code == 400
    assert "not found" in resp.json()["detail"].lower() or "exist" in resp.json()["detail"].lower()
