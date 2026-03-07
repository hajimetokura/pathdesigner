"""Test mesh export (tessellation) for 3D preview."""

from nodes.mesh_export import tessellate_step_file, export_step_to_stl


def test_export_step_to_stl(simple_box_step, tmp_path):
    """Export a STEP file to STL and verify the result is loadable."""
    stl_path = export_step_to_stl(simple_box_step, output_dir=tmp_path)
    assert stl_path.exists()
    assert stl_path.suffix == ".stl"

    import trimesh
    mesh = trimesh.load(str(stl_path), force="mesh")
    assert len(mesh.vertices) > 0
    assert len(mesh.faces) > 0


def test_tessellate_simple_box(simple_box_step):
    """Tessellating a simple box should return valid mesh data."""
    result = tessellate_step_file(simple_box_step)
    assert len(result) > 0

    mesh = result[0]
    assert mesh["object_id"] == "obj_001"
    # Box has 6 faces, each face = 2 triangles = 12 triangles minimum
    assert len(mesh["vertices"]) > 0
    assert len(mesh["vertices"]) % 3 == 0  # flat [x,y,z,x,y,z,...]
    assert len(mesh["faces"]) > 0
    assert len(mesh["faces"]) % 3 == 0  # flat [i,j,k,i,j,k,...]
