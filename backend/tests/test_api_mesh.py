"""API tests for mesh upload endpoint."""

import io

import pytest
from fastapi.testclient import TestClient
from main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_upload_stl(client, simple_box_stl):
    """Upload STL file and verify MeshImportResult."""
    with open(simple_box_stl, "rb") as f:
        response = client.post(
            "/api/upload-mesh",
            files={"file": ("box.stl", f, "application/octet-stream")},
        )
    assert response.status_code == 200
    data = response.json()
    assert "file_id" in data
    assert "mesh_file_path" in data
    assert data["object_count"] == 1
    assert data["objects"][0]["machining_type"] == "3d"


def test_upload_invalid_extension(client):
    """Reject non-mesh files."""
    fake = io.BytesIO(b"not a mesh")
    response = client.post(
        "/api/upload-mesh",
        files={"file": ("test.txt", fake, "text/plain")},
    )
    assert response.status_code == 400
    assert "stl" in response.json()["detail"].lower()


def test_upload_no_filename(client):
    """Reject upload without filename."""
    fake = io.BytesIO(b"data")
    response = client.post(
        "/api/upload-mesh",
        files={"file": ("", fake, "application/octet-stream")},
    )
    assert response.status_code in (400, 422)


def test_mesh_result_compatible_with_brep_flow(client, simple_box_stl):
    """MeshImportResult should contain data PlacementNode needs."""
    with open(simple_box_stl, "rb") as f:
        response = client.post(
            "/api/upload-mesh",
            files={"file": ("box.stl", f, "application/octet-stream")},
        )
    data = response.json()

    # PlacementNode requires: file_id, objects (with bounding_box, object_id, origin)
    assert data["file_id"]
    obj = data["objects"][0]
    assert "bounding_box" in obj
    assert "object_id" in obj
    assert "origin" in obj
    assert obj["origin"]["reference"] == "bounding_box_min"
    assert len(obj["origin"]["position"]) == 3


def test_mesh_upload_freeform(client, freeform_stl):
    """Verify freeform mesh (sphere) uploads and analyzes correctly."""
    with open(freeform_stl, "rb") as f:
        response = client.post(
            "/api/upload-mesh",
            files={"file": ("sphere.stl", f, "application/octet-stream")},
        )
    assert response.status_code == 200
    data = response.json()
    assert data["objects"][0]["machining_type"] == "3d"
    assert data["objects"][0]["is_closed"] is True
