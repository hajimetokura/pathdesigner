"""Tests for mesh import schemas."""

from schemas import MeshImportResult, BrepObject, BoundingBox, Origin, FacesAnalysis


def test_mesh_import_result_valid():
    """MeshImportResult should accept valid mesh data."""
    obj = BrepObject(
        object_id="obj_001",
        file_name="test.stl",
        bounding_box=BoundingBox(x=100, y=80, z=45),
        thickness=45.0,
        origin=Origin(
            position=[0, 0, 0],
            reference="bounding_box_min",
            description="STL bounding box minimum",
        ),
        unit="mm",
        is_closed=True,
        is_planar=False,
        machining_type="3d",
        faces_analysis=FacesAnalysis(
            top_features=False, bottom_features=False, freeform_surfaces=True
        ),
        outline=[],
    )
    result = MeshImportResult(
        file_id="abc123",
        objects=[obj],
        object_count=1,
        mesh_file_path="/tmp/abc123.stl",
    )
    assert result.file_id == "abc123"
    assert result.mesh_file_path == "/tmp/abc123.stl"
    assert result.objects[0].machining_type == "3d"


def test_mesh_import_result_inherits_brep_import():
    """MeshImportResult should extend BrepImportResult."""
    from schemas import BrepImportResult

    assert issubclass(MeshImportResult, BrepImportResult)
