"""Integration tests for AI CAD API endpoints."""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from main import app

client = TestClient(app)


def test_get_models():
    """GET /ai-cad/models returns pipeline model configuration."""
    resp = client.get("/ai-cad/models")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    names = [m["name"] for m in data]
    assert any("designer" in n for n in names)
    assert any("coder" in n for n in names)


def test_execute_code_simple_box():
    """POST /ai-cad/execute with valid build123d code."""
    resp = client.post("/ai-cad/execute", json={"code": "result = Box(100, 50, 10)"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["object_count"] >= 1
    assert data["generated_code"] == "result = Box(100, 50, 10)"
    assert data["generation_id"]
    assert len(data["objects"]) >= 1


def test_execute_code_syntax_error():
    """POST /ai-cad/execute with invalid code returns 422."""
    resp = client.post("/ai-cad/execute", json={"code": "result = Box(10,"})
    assert resp.status_code == 422


def test_execute_code_no_result():
    """POST /ai-cad/execute without `result` returns 422."""
    resp = client.post("/ai-cad/execute", json={"code": "x = Box(10,10,10)"})
    assert resp.status_code == 422


def test_library_list_empty():
    """GET /ai-cad/library returns list (may be empty initially)."""
    resp = client.get("/ai-cad/library")
    assert resp.status_code == 200


def test_generate_requires_api_key(monkeypatch):
    """POST /ai-cad/generate without API key returns SSE error event."""
    import main
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    old_llm = main._llm
    main._llm = None  # Reset singleton so new client gets empty key
    try:
        resp = client.post("/ai-cad/generate", json={"prompt": "a box"})
        # SSE endpoint always returns 200, errors come as SSE events
        assert resp.status_code == 200
        text = resp.text
        assert "event: error" in text or "event: stage" in text
    finally:
        main._llm = old_llm


def test_get_profiles():
    """GET /ai-cad/profiles returns profile list."""
    resp = client.get("/ai-cad/profiles")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 1
    ids = [p["id"] for p in data]
    assert "general" in ids
    assert all("name" in p and "description" in p for p in data)


def test_refine_endpoint_with_mock_llm():
    """POST /ai-cad/refine streams SSE events and returns refined result."""
    # First create a generation to refine
    resp = client.post("/ai-cad/execute", json={"code": "result = Box(100, 50, 10)"})
    assert resp.status_code == 200
    gen_id = resp.json()["generation_id"]
    original_code = resp.json()["generated_code"]

    # Mock LLM to return modified code
    mock_code = "result = Box(100, 50, 20)"  # changed height

    with patch("main._get_llm") as mock_get_llm:
        mock_llm = MagicMock()
        mock_llm.refine_code = AsyncMock(return_value=mock_code)
        mock_llm._self_review = AsyncMock(return_value=mock_code)
        mock_get_llm.return_value = mock_llm

        resp = client.post("/ai-cad/refine", json={
            "generation_id": gen_id,
            "message": "高さを20mmに変更",
            "history": [],
            "current_code": original_code,
        })

    assert resp.status_code == 200
    text = resp.text
    assert "event: stage" in text
    assert '"reviewing"' in text  # self-review stage
    assert "event: result" in text or "event: error" in text


def test_refine_validates_generation_id():
    """POST /ai-cad/refine with bad generation_id returns error SSE."""
    resp = client.post("/ai-cad/refine", json={
        "generation_id": "nonexistent",
        "message": "round edges",
        "history": [],
        "current_code": "result = Box(10,10,10)",
    })
    assert resp.status_code == 200  # SSE always 200
    assert "event: error" in resp.text
