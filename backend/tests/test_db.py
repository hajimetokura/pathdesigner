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


@pytest.mark.asyncio
async def test_save_and_get_conversation_history(db):
    """Save a generation with conversation_history and retrieve it."""
    history = '[{"role":"user","content":"make a box"},{"role":"assistant","content":"done"}]'
    gen_id = await db.save_generation(
        prompt="test", code="result = Box(10,10,10)",
        result_json=None, model_used="test", status="success",
        conversation_history=history,
    )
    row = await db.get_generation(gen_id)
    assert row is not None
    assert row["conversation_history"] == history


@pytest.mark.asyncio
async def test_update_conversation_history(db):
    """Update conversation_history on existing generation."""
    gen_id = await db.save_generation(
        prompt="test", code="result = Box(10,10,10)",
        result_json=None, model_used="test", status="success",
    )
    new_history = '[{"role":"user","content":"round the edges"}]'
    await db.update_generation(gen_id, conversation_history=new_history)
    row = await db.get_generation(gen_id)
    assert row["conversation_history"] == new_history


@pytest.mark.asyncio
async def test_update_generation_code_and_result(db):
    """Update code and result_json on existing generation."""
    gen_id = await db.save_generation(
        prompt="test", code="old code",
        result_json='{"old": true}', model_used="test", status="success",
    )
    await db.update_generation(gen_id, code="new code", result_json='{"new": true}')
    row = await db.get_generation(gen_id)
    assert row["code"] == "new code"
    assert row["result_json"] == '{"new": true}'
