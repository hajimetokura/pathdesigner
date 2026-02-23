"""Tests for SQLite generation storage."""

import pytest
import pytest_asyncio

from db import GenerationDB


@pytest_asyncio.fixture
async def db(tmp_path):
    """Create a temporary database."""
    db = GenerationDB(tmp_path / "test.db")
    await db.init()
    yield db
    await db.close()


@pytest.mark.asyncio
async def test_save_and_load(db):
    gen_id = await db.save_generation(
        prompt="Make a box",
        code="result = Box(10,10,10)",
        result_json='{"file_id":"ai-123","objects":[],"object_count":0}',
        model_used="google/gemini-2.5-flash-lite",
        status="success",
    )
    assert gen_id

    row = await db.get_generation(gen_id)
    assert row is not None
    assert row["prompt"] == "Make a box"
    assert row["code"] == "result = Box(10,10,10)"
    assert row["status"] == "success"
    assert row["model_used"] == "google/gemini-2.5-flash-lite"


@pytest.mark.asyncio
async def test_list_generations(db):
    await db.save_generation(
        prompt="box1", code="c1", result_json="{}", model_used="m1", status="success",
    )
    await db.save_generation(
        prompt="box2", code="c2", result_json="{}", model_used="m1", status="success",
    )

    items = await db.list_generations()
    assert len(items) == 2
    # Most recent first
    assert items[0]["prompt"] == "box2"


@pytest.mark.asyncio
async def test_list_generations_search(db):
    await db.save_generation(
        prompt="wooden shelf", code="c1", result_json="{}", model_used="m1", status="success",
    )
    await db.save_generation(
        prompt="metal bracket", code="c2", result_json="{}", model_used="m1", status="success",
    )

    items = await db.list_generations(search="shelf")
    assert len(items) == 1
    assert items[0]["prompt"] == "wooden shelf"


@pytest.mark.asyncio
async def test_delete_generation(db):
    gen_id = await db.save_generation(
        prompt="tmp", code="c", result_json="{}", model_used="m1", status="success",
    )
    await db.delete_generation(gen_id)
    assert await db.get_generation(gen_id) is None


@pytest.mark.asyncio
async def test_save_with_error(db):
    gen_id = await db.save_generation(
        prompt="bad code", code="invalid", result_json=None,
        model_used="m1", status="error", error_message="SyntaxError",
    )
    row = await db.get_generation(gen_id)
    assert row["status"] == "error"
    assert row["error_message"] == "SyntaxError"
