"""Tests for SnippetsDB and /snippets endpoints."""
import json
import pytest
import pytest_asyncio
from pathlib import Path
from fastapi.testclient import TestClient

from db import SnippetsDB


# ── DB unit tests ─────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def snippets_db(tmp_path: Path):
    db = SnippetsDB(tmp_path / "test_snippets.db")
    await db.init()
    yield db
    await db.close()


@pytest.mark.asyncio
async def test_save_and_get_snippet(snippets_db: SnippetsDB):
    sid = await snippets_db.save_snippet(
        name="Simple Box",
        code="from build123d import *\nresult = Box(10, 10, 10)",
        tags=["box", "simple"],
    )
    assert sid is not None
    row = await snippets_db.get_snippet(sid)
    assert row["name"] == "Simple Box"
    assert json.loads(row["tags"]) == ["box", "simple"]
    assert "Box(10" in row["code"]


@pytest.mark.asyncio
async def test_get_nonexistent_snippet(snippets_db: SnippetsDB):
    row = await snippets_db.get_snippet("nonexistent")
    assert row is None


@pytest.mark.asyncio
async def test_list_snippets(snippets_db: SnippetsDB):
    await snippets_db.save_snippet(name="Box", code="result = Box(10,10,10)")
    await snippets_db.save_snippet(name="Cylinder", code="result = Cylinder(5,10)")
    rows, total = await snippets_db.list_snippets()
    assert total == 2
    assert len(rows) == 2


@pytest.mark.asyncio
async def test_list_snippets_search(snippets_db: SnippetsDB):
    await snippets_db.save_snippet(name="Simple Box", code="result = Box(10,10,10)")
    await snippets_db.save_snippet(name="Cylinder", code="result = Cylinder(5,10)")
    rows, total = await snippets_db.list_snippets(q="Box")
    assert total == 1
    assert rows[0]["name"] == "Simple Box"


@pytest.mark.asyncio
async def test_delete_snippet(snippets_db: SnippetsDB):
    sid = await snippets_db.save_snippet(name="Temp", code="result = Box(1,1,1)")
    deleted = await snippets_db.delete_snippet(sid)
    assert deleted is True
    assert await snippets_db.get_snippet(sid) is None


@pytest.mark.asyncio
async def test_delete_nonexistent(snippets_db: SnippetsDB):
    deleted = await snippets_db.delete_snippet("ghost")
    assert deleted is False


# ── API endpoint tests ────────────────────────────────────────────────────────

@pytest.fixture
def client(tmp_path: Path):
    """TestClient with an isolated in-memory snippets DB per test."""
    import asyncio
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    import main as main_module
    from main import app

    # Create isolated SnippetsDB backed by a tmp file
    isolated_db = SnippetsDB(tmp_path / "snippets_api_test.db")
    asyncio.get_event_loop().run_until_complete(isolated_db.init())

    original = main_module._snippets_db
    main_module._snippets_db = isolated_db

    yield TestClient(app)

    main_module._snippets_db = original
    asyncio.get_event_loop().run_until_complete(isolated_db.close())


def test_post_snippet(client: TestClient):
    resp = client.post("/snippets", json={
        "name": "Box",
        "tags": ["box"],
        "code": "from build123d import *\nresult = Box(10,10,10)",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Box"
    assert data["id"] is not None


def test_get_snippets_list(client: TestClient):
    client.post("/snippets", json={"name": "A", "code": "result = Box(1,1,1)"})
    resp = client.get("/snippets")
    assert resp.status_code == 200
    data = resp.json()
    assert "snippets" in data
    assert "total" in data


def test_get_snippets_search(client: TestClient):
    client.post("/snippets", json={"name": "SearchMe", "code": "result = Box(1,1,1)"})
    client.post("/snippets", json={"name": "Other", "code": "result = Box(2,2,2)"})
    resp = client.get("/snippets?q=SearchMe")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    assert data["snippets"][0]["name"] == "SearchMe"


def test_delete_snippet(client: TestClient):
    post_resp = client.post("/snippets", json={"name": "ToDelete", "code": "result = Box(1,1,1)"})
    sid = post_resp.json()["id"]
    del_resp = client.delete(f"/snippets/{sid}")
    assert del_resp.status_code == 200
    # 再取得できないことを確認
    list_resp = client.get(f"/snippets?q=ToDelete")
    assert list_resp.json()["total"] == 0


def test_execute_snippet(client: TestClient):
    post_resp = client.post("/snippets", json={
        "name": "Box",
        "code": "from build123d import *\nresult = Box(10, 10, 10)",
    })
    sid = post_resp.json()["id"]
    exec_resp = client.post(f"/snippets/{sid}/execute")
    assert exec_resp.status_code == 200
    data = exec_resp.json()
    assert data["object_count"] > 0
    assert data["generated_code"] is not None
    assert data["model_used"] == "snippet"


def test_execute_nonexistent_snippet(client: TestClient):
    resp = client.post("/snippets/nonexistent/execute")
    assert resp.status_code == 404


def test_execute_invalid_code_snippet(client: TestClient):
    post_resp = client.post("/snippets", json={
        "name": "Bad",
        "code": "this is not valid python!!!",
    })
    sid = post_resp.json()["id"]
    resp = client.post(f"/snippets/{sid}/execute")
    assert resp.status_code == 422
