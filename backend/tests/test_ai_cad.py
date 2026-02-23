"""Tests for AI CAD code execution sandbox."""

import pytest

from nodes.ai_cad import execute_build123d_code, CodeExecutionError


def test_simple_box():
    """Execute simple box code and get BrepObject list."""
    code = "result = Box(100, 50, 10)"
    objects, step_bytes = execute_build123d_code(code)
    assert len(objects) >= 1
    obj = objects[0]
    assert abs(obj.bounding_box.x - 100) < 0.1
    assert abs(obj.bounding_box.y - 50) < 0.1
    assert abs(obj.bounding_box.z - 10) < 0.1
    assert step_bytes is not None
    assert len(step_bytes) > 100  # STEP file has content


def test_box_with_hole():
    """Execute code with boolean subtraction."""
    code = """\
box = Box(100, 50, 10)
hole = Pos(30, 0, 0) * Cylinder(10, 10)
result = box - hole
"""
    objects, step_bytes = execute_build123d_code(code)
    assert len(objects) >= 1
    assert objects[0].machining_type in ("2d", "2.5d")


def test_missing_result_raises():
    """Code without `result` variable should raise."""
    code = "x = Box(10, 10, 10)"
    with pytest.raises(CodeExecutionError, match="result"):
        execute_build123d_code(code)


def test_syntax_error_raises():
    """Invalid Python should raise CodeExecutionError."""
    code = "result = Box(10, 10,"
    with pytest.raises(CodeExecutionError):
        execute_build123d_code(code)


def test_forbidden_import_raises():
    """Importing os/subprocess should raise."""
    code = "import os; result = Box(10, 10, 10)"
    with pytest.raises(CodeExecutionError):
        execute_build123d_code(code)


def test_multiple_solids():
    """Compound with multiple solids returns multiple objects."""
    code = """\
b1 = Pos(-60, 0, 0) * Box(50, 30, 10)
b2 = Pos(60, 0, 0) * Box(50, 30, 10)
result = Compound(children=[b1, b2])
"""
    objects, _ = execute_build123d_code(code)
    assert len(objects) == 2


def test_outline_exists():
    """Verify outline data is generated for objects."""
    code = "result = Box(100, 50, 10)"
    objects, step_bytes = execute_build123d_code(code)
    assert all(obj.outline for obj in objects)
