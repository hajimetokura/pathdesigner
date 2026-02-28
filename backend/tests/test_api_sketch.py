"""Integration tests for /api/sketch-to-brep endpoint."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from main import app
from schemas import BrepObject, BoundingBox, Origin, FacesAnalysis


def _mock_objects():
    return [BrepObject(
        object_id="sketch-0", file_name="sketch_generated.step",
        bounding_box=BoundingBox(x=100, y=80, z=10),
        thickness=10,
        origin=Origin(position=[0, 0, 0], reference="bounding_box_min", description=""),
        unit="mm", is_closed=True, is_planar=True,
        machining_type="2d",
        faces_analysis=FacesAnalysis(
            top_features=False, bottom_features=False, freeform_surfaces=False,
        ),
        outline=[],
    )]


def test_sketch_to_brep_returns_sse_stages():
    """POST /api/sketch-to-brep returns SSE stream with stage and result events."""

    mock_objects = _mock_objects()

    async def mock_pipeline(prompt, *, image_base64=None, profile="general", on_stage=None):
        if on_stage:
            await on_stage("designing")
            await on_stage("coding")
            await on_stage("reviewing")
            await on_stage("executing")
        return "result = Box(100, 80, 10)", mock_objects, b"STEP data"

    with patch("main._get_llm") as mock_get_llm, \
         patch("main._get_db") as mock_get_db:
        mock_llm = MagicMock()
        mock_llm.generate_pipeline = mock_pipeline
        mock_get_llm.return_value = mock_llm

        mock_db = AsyncMock()
        mock_db.save_generation = AsyncMock(return_value="gen-sketch-1")
        mock_get_db.return_value = mock_db

        client = TestClient(app)
        response = client.post(
            "/api/sketch-to-brep",
            json={
                "image_base64": "data:image/png;base64,iVBORw0KGgo=",
                "prompt": "四角い板",
                "profile": "sketch_cutout",
            },
            headers={"Accept": "text/event-stream"},
        )

        assert response.status_code == 200
        text = response.text
        assert "event: stage" in text
        assert '"designing"' in text
        assert "event: result" in text

        # Verify generate_pipeline was called with sketch preamble + user prompt
        # and correct profile and image_base64
        # (mock_pipeline captures these via closure — we just check it ran)


def test_sketch_to_brep_missing_image():
    """POST /api/sketch-to-brep with empty image_base64 returns SSE error."""
    client = TestClient(app)
    response = client.post(
        "/api/sketch-to-brep",
        json={
            "image_base64": "",
            "prompt": "test",
        },
    )
    assert response.status_code == 200  # SSE always 200
    assert "event: error" in response.text


def test_sketch_to_brep_prompt_includes_preamble():
    """Verify the prompt sent to LLM includes sketch-specific preamble."""
    mock_objects = _mock_objects()
    captured_prompt = {}

    async def mock_pipeline(prompt, *, image_base64=None, profile="general", on_stage=None):
        captured_prompt["prompt"] = prompt
        captured_prompt["image_base64"] = image_base64
        captured_prompt["profile"] = profile
        if on_stage:
            await on_stage("executing")
        return "result = Box(10, 10, 10)", mock_objects, b"STEP"

    with patch("main._get_llm") as mock_get_llm, \
         patch("main._get_db") as mock_get_db:
        mock_llm = MagicMock()
        mock_llm.generate_pipeline = mock_pipeline
        mock_get_llm.return_value = mock_llm

        mock_db = AsyncMock()
        mock_db.save_generation = AsyncMock(return_value="gen-1")
        mock_get_db.return_value = mock_db

        client = TestClient(app)
        client.post(
            "/api/sketch-to-brep",
            json={
                "image_base64": "data:image/png;base64,abc123",
                "prompt": "丸い皿",
                "profile": "sketch_3d",
            },
        )

    assert "スケッチ" in captured_prompt["prompt"]
    assert "丸い皿" in captured_prompt["prompt"]
    assert captured_prompt["image_base64"] == "data:image/png;base64,abc123"
    assert captured_prompt["profile"] == "sketch_3d"


def test_sketch_to_brep_file_id_prefix():
    """Result file_id starts with 'sketch-'."""
    mock_objects = _mock_objects()

    async def mock_pipeline(prompt, *, image_base64=None, profile="general", on_stage=None):
        if on_stage:
            await on_stage("executing")
        return "result = Box(10, 10, 10)", mock_objects, b"STEP"

    with patch("main._get_llm") as mock_get_llm, \
         patch("main._get_db") as mock_get_db:
        mock_llm = MagicMock()
        mock_llm.generate_pipeline = mock_pipeline
        mock_get_llm.return_value = mock_llm

        mock_db = AsyncMock()
        mock_db.save_generation = AsyncMock(return_value="gen-1")
        mock_get_db.return_value = mock_db

        client = TestClient(app)
        response = client.post(
            "/api/sketch-to-brep",
            json={
                "image_base64": "data:image/png;base64,abc123",
                "prompt": "",
            },
        )

    text = response.text
    # Parse the result event
    for line in text.split("\n"):
        if line.startswith("data: ") and "file_id" in line:
            data = json.loads(line[6:])
            assert data["file_id"].startswith("sketch-")
            break
    else:
        pytest.fail("No result event with file_id found")
