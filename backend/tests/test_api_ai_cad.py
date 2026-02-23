"""Integration tests for AI CAD API endpoints."""

import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from main import app

client = TestClient(app)


def test_get_models():
    """GET /ai-cad/models returns model list."""
    resp = client.get("/ai-cad/models")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 3
    assert any(m["is_default"] for m in data)


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
    """POST /ai-cad/generate without API key returns 500 or appropriate error."""
    import main
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    old_llm = main._llm
    main._llm = None  # Reset singleton so new client gets empty key
    try:
        resp = client.post("/ai-cad/generate", json={"prompt": "a box"})
        # Without API key, should fail gracefully
        assert resp.status_code in (500, 422)
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
