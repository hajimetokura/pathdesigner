"""Tests for STL/OBJ mesh import."""

from nodes.mesh_import import analyze_mesh_file


def test_analyze_stl_basic(simple_box_stl):
    """Analyze a simple box STL and verify BrepObject-compatible output."""
    result = analyze_mesh_file(simple_box_stl, file_name="simple_box.stl")
    assert len(result) == 1

    obj = result[0]
    assert obj.object_id == "obj_001"
    assert obj.file_name == "simple_box.stl"
    assert obj.machining_type == "3d"
    assert obj.is_planar is False
    assert obj.faces_analysis.freeform_surfaces is True
    # Bounding box should be approximately 100x50x10
    assert abs(obj.bounding_box.x - 100) < 1
    assert abs(obj.bounding_box.y - 50) < 1
    assert abs(obj.bounding_box.z - 10) < 1
    assert abs(obj.thickness - 10) < 1


def test_analyze_stl_origin(simple_box_stl):
    """STL origin should be bounding_box_min."""
    result = analyze_mesh_file(simple_box_stl, file_name="box.stl")
    obj = result[0]
    assert obj.origin.reference == "bounding_box_min"
    assert len(obj.origin.position) == 3


def test_analyze_freeform_stl(freeform_stl):
    """Freeform (sphere) STL should be detected as 3D."""
    result = analyze_mesh_file(freeform_stl, file_name="sphere.stl")
    obj = result[0]
    assert obj.machining_type == "3d"
    assert obj.is_closed is True
    # Sphere radius=25, translated to Z=0 bottom → BB.z ≈ 50
    assert abs(obj.bounding_box.z - 50) < 1
