"""Integration tests for /ai-cad/generate with sketch (image) input."""

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


def test_generate_with_image_returns_sse_stages():
    """POST /ai-cad/generate with image_base64 returns SSE stream with stage and result events."""

    mock_objects = _mock_objects()

    async def mock_pipeline(prompt, *, image_base64=None, profile="general",
                            coder_model=None, on_stage=None, on_detail=None):
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
            "/ai-cad/generate",
            json={
                "prompt": "四角い板",
                "image_base64": "data:image/png;base64,iVBORw0KGgo=",
                "profile": "sketch_cutout",
            },
            headers={"Accept": "text/event-stream"},
        )

        assert response.status_code == 200
        text = response.text
        assert "event: stage" in text
        assert '"designing"' in text
        assert "event: result" in text


def test_generate_with_image_includes_preamble():
    """Verify the prompt sent to LLM includes sketch-specific preamble when image is present."""
    mock_objects = _mock_objects()
    captured = {}

    async def mock_pipeline(prompt, *, image_base64=None, profile="general",
                            coder_model=None, on_stage=None, on_detail=None):
        captured["prompt"] = prompt
        captured["image_base64"] = image_base64
        captured["profile"] = profile
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
            "/ai-cad/generate",
            json={
                "prompt": "丸い皿",
                "image_base64": "data:image/png;base64,abc123",
                "profile": "sketch_3d",
            },
        )

    assert "スケッチ" in captured["prompt"]
    assert "丸い皿" in captured["prompt"]
    assert captured["image_base64"] == "data:image/png;base64,abc123"
    assert captured["profile"] == "sketch_3d"


def test_generate_with_image_file_id_prefix():
    """Result file_id starts with 'sketch-' when image is provided."""
    mock_objects = _mock_objects()

    async def mock_pipeline(prompt, *, image_base64=None, profile="general",
                            coder_model=None, on_stage=None, on_detail=None):
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
            "/ai-cad/generate",
            json={
                "prompt": "",
                "image_base64": "data:image/png;base64,abc123",
            },
        )

    text = response.text
    for line in text.split("\n"):
        if line.startswith("data: ") and "file_id" in line:
            data = json.loads(line[6:])
            assert data["file_id"].startswith("sketch-")
            break
    else:
        pytest.fail("No result event with file_id found")


def test_generate_text_only_file_id_prefix():
    """Result file_id starts with 'ai-cad-' when no image is provided."""
    mock_objects = _mock_objects()

    async def mock_pipeline(prompt, *, image_base64=None, profile="general",
                            coder_model=None, on_stage=None, on_detail=None):
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
            "/ai-cad/generate",
            json={"prompt": "円柱を作って"},
        )

    text = response.text
    for line in text.split("\n"):
        if line.startswith("data: ") and "file_id" in line:
            data = json.loads(line[6:])
            assert data["file_id"].startswith("ai-cad-")
            break
    else:
        pytest.fail("No result event with file_id found")


def test_generate_with_coder_model():
    """Verify coder_model is passed through to generate_pipeline."""
    mock_objects = _mock_objects()
    captured = {}

    async def mock_pipeline(prompt, *, image_base64=None, profile="general",
                            coder_model=None, on_stage=None, on_detail=None):
        captured["coder_model"] = coder_model
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
            "/ai-cad/generate",
            json={
                "prompt": "テスト",
                "image_base64": "data:image/png;base64,abc123",
                "coder_model": "deepseek/deepseek-r1",
            },
        )

    assert captured["coder_model"] == "deepseek/deepseek-r1"
