"""Tests for OpenRouter LLM client."""

import os
from unittest.mock import AsyncMock, patch, MagicMock

import pytest

# Ensure backend path
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from llm_client import LLMClient, AVAILABLE_MODELS


def test_build_system_prompt_default():
    """_build_system_prompt returns base + general cheatsheet."""
    from llm_client import _build_system_prompt, _BASE_PROMPT, _PROFILES
    prompt = _build_system_prompt()
    assert prompt.startswith(_BASE_PROMPT)
    assert "CHEATSHEET" in prompt
    assert _PROFILES["general"]["cheatsheet"] in prompt


def test_build_system_prompt_unknown_falls_back():
    """Unknown profile falls back to general."""
    from llm_client import _build_system_prompt
    prompt = _build_system_prompt("nonexistent")
    general = _build_system_prompt("general")
    assert prompt == general


def test_available_models_has_entries():
    assert len(AVAILABLE_MODELS) >= 3


def test_default_model_exists():
    client = LLMClient(api_key="test-key")
    assert client.default_model in AVAILABLE_MODELS


@pytest.mark.asyncio
async def test_generate_calls_openai_client():
    """Verify generate() calls the OpenAI-compatible API correctly."""
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = 'result = Box(100, 50, 10)'

    mock_client = MagicMock()
    mock_client.chat = MagicMock()
    mock_client.chat.completions = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

    client = LLMClient(api_key="test-key")
    client._client = mock_client

    code = await client.generate("Make a box 100x50x10mm")

    assert "Box(100, 50, 10)" in code
    mock_client.chat.completions.create.assert_called_once()
    call_kwargs = mock_client.chat.completions.create.call_args[1]
    assert call_kwargs["model"] is not None
    assert any("build123d" in str(m) for m in call_kwargs["messages"])


@pytest.mark.asyncio
async def test_generate_with_model_override():
    """Verify model parameter is passed through."""
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = 'result = Cylinder(5, 10)'

    mock_client = MagicMock()
    mock_client.chat = MagicMock()
    mock_client.chat.completions = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

    client = LLMClient(api_key="test-key")
    client._client = mock_client

    await client.generate("Make a cylinder", model="deepseek/deepseek-r1")

    call_kwargs = mock_client.chat.completions.create.call_args[1]
    assert call_kwargs["model"] == "deepseek/deepseek-r1"


@pytest.mark.asyncio
async def test_generate_strips_markdown_fences():
    """If LLM wraps code in ```python ... ```, strip it."""
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = '```python\nresult = Box(10, 10, 10)\n```'

    mock_client = MagicMock()
    mock_client.chat = MagicMock()
    mock_client.chat.completions = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

    client = LLMClient(api_key="test-key")
    client._client = mock_client

    code = await client.generate("box")
    assert "```" not in code
    assert "result = Box(10, 10, 10)" in code


from nodes.ai_cad import CodeExecutionError


@pytest.mark.asyncio
async def test_generate_and_execute_success_first_try():
    """generate_and_execute returns on first successful execution."""
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = "result = Box(100, 50, 10)"

    mock_client = MagicMock()
    mock_client.chat = MagicMock()
    mock_client.chat.completions = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

    client = LLMClient(api_key="test-key")
    client._client = mock_client

    code, objects, step_bytes = await client.generate_and_execute("Make a box")

    assert "Box(100, 50, 10)" in code
    assert len(objects) >= 1
    assert step_bytes is not None
    # LLM should only be called once (no retry needed)
    assert mock_client.chat.completions.create.call_count == 1


@pytest.mark.asyncio
async def test_generate_and_execute_retries_on_failure():
    """generate_and_execute retries when execution fails, then succeeds."""
    bad_response = MagicMock()
    bad_response.choices = [MagicMock()]
    bad_response.choices[0].message.content = "x = Box(10, 10, 10)"  # missing result

    good_response = MagicMock()
    good_response.choices = [MagicMock()]
    good_response.choices[0].message.content = "result = Box(10, 10, 10)"

    mock_client = MagicMock()
    mock_client.chat = MagicMock()
    mock_client.chat.completions = MagicMock()
    mock_client.chat.completions.create = AsyncMock(
        side_effect=[bad_response, good_response]
    )

    client = LLMClient(api_key="test-key")
    client._client = mock_client

    code, objects, step_bytes = await client.generate_and_execute("Make a box")

    assert "result = Box(10, 10, 10)" in code
    assert len(objects) >= 1
    # LLM called twice: initial + 1 retry
    assert mock_client.chat.completions.create.call_count == 2


@pytest.mark.asyncio
async def test_generate_and_execute_exhausts_retries():
    """generate_and_execute raises after exhausting retries."""
    bad_response = MagicMock()
    bad_response.choices = [MagicMock()]
    bad_response.choices[0].message.content = "x = 42"  # always bad

    mock_client = MagicMock()
    mock_client.chat = MagicMock()
    mock_client.chat.completions = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=bad_response)

    client = LLMClient(api_key="test-key")
    client._client = mock_client
    client.max_retries = 2

    with pytest.raises(CodeExecutionError):
        await client.generate_and_execute("Make a box")

    # initial + 2 retries = 3 calls
    assert mock_client.chat.completions.create.call_count == 3


@pytest.mark.asyncio
async def test_generate_and_execute_zero_retries():
    """With max_retries=0, no retry is attempted."""
    bad_response = MagicMock()
    bad_response.choices = [MagicMock()]
    bad_response.choices[0].message.content = "x = 42"

    mock_client = MagicMock()
    mock_client.chat = MagicMock()
    mock_client.chat.completions = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=bad_response)

    client = LLMClient(api_key="test-key")
    client._client = mock_client

    with pytest.raises(CodeExecutionError):
        await client.generate_and_execute("Make a box", max_retries=0)

    assert mock_client.chat.completions.create.call_count == 1


@pytest.mark.asyncio
async def test_generate_uses_profile():
    """generate() uses the specified profile's cheatsheet."""
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = "result = Box(10, 10, 10)"

    mock_client = MagicMock()
    mock_client.chat = MagicMock()
    mock_client.chat.completions = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

    client = LLMClient(api_key="test-key")
    client._client = mock_client

    await client.generate("Make a box", profile="furniture")

    call_kwargs = mock_client.chat.completions.create.call_args[1]
    system_msg = call_kwargs["messages"][0]["content"]
    assert "FURNITURE" in system_msg


def test_furniture_profile_has_patterns():
    """Furniture profile includes relevant keywords and patterns."""
    from llm_client import _build_system_prompt
    prompt = _build_system_prompt("furniture")
    assert "FURNITURE" in prompt
    assert "thickness" in prompt
    assert "Hole" in prompt
    assert "Align.MIN" in prompt
    assert "dowel" in prompt.lower() or "ダボ" in prompt


def test_furniture_pattern_shelf_executes():
    """Furniture pattern example (shelf with dowel holes) actually runs."""
    from nodes.ai_cad import execute_build123d_code
    code = """\
thickness = 18
with BuildPart() as bp:
    Box(400, 250, thickness, align=(Align.MIN, Align.MIN, Align.MIN))
    top = bp.faces().sort_by(Axis.Z)[-1]
    with BuildSketch(top):
        with Locations((30, 30), (370, 30), (30, 220), (370, 220)):
            Circle(4)
    extrude(amount=-thickness, mode=Mode.SUBTRACT)
result = bp.part
"""
    objects, step_bytes = execute_build123d_code(code)
    assert len(objects) >= 1
    assert step_bytes is not None


def test_flat_profile_has_patterns():
    """Flat profile includes text, pocket, and outline keywords."""
    from llm_client import _build_system_prompt
    prompt = _build_system_prompt("flat")
    assert "FLAT" in prompt or "ENGRAVING" in prompt
    assert "Text" in prompt
    assert "make_face" in prompt
    assert "SUBTRACT" in prompt


def test_flat_pattern_nameplate_executes():
    """Flat pattern example (nameplate with text engraving) actually runs."""
    from nodes.ai_cad import execute_build123d_code
    code = """\
thickness = 6
engrave_depth = 2
with BuildPart() as bp:
    with BuildSketch():
        RectangleRounded(120, 40, radius=5)
    extrude(amount=thickness)
    top = bp.faces().sort_by(Axis.Z)[-1]
    with BuildSketch(top):
        Text("HELLO", font_size=16)
    extrude(amount=-engrave_depth, mode=Mode.SUBTRACT)
result = bp.part
"""
    objects, step_bytes = execute_build123d_code(code)
    assert len(objects) >= 1


def test_3d_profile_has_patterns():
    """3D profile includes revolve, loft, sweep, shell keywords."""
    from llm_client import _build_system_prompt
    prompt = _build_system_prompt("3d")
    assert "3D" in prompt
    assert "revolve" in prompt
    assert "loft" in prompt
    assert "sweep" in prompt
    assert "offset" in prompt or "shell" in prompt.lower()


def test_3d_pattern_tray_executes():
    """3D pattern example (tray with shell) actually runs."""
    from nodes.ai_cad import execute_build123d_code
    code = """\
with BuildPart() as bp:
    Box(150, 100, 40)
    fillet(bp.edges().filter_by(Axis.Z), radius=10)
    top = bp.faces().sort_by(Axis.Z)[-1]
    offset(amount=-3, openings=top)
result = bp.part
"""
    objects, step_bytes = execute_build123d_code(code)
    assert len(objects) >= 1


def test_load_reference_file_returns_content(tmp_path):
    """_load_reference_file reads content from file."""
    from llm_client import _load_reference_file, _REFERENCE_CACHE
    # Clear cache
    _REFERENCE_CACHE.clear()
    ref_file = tmp_path / "test_ref.md"
    ref_file.write_text("# Test Reference\nSome API content")
    content = _load_reference_file(str(ref_file))
    assert "Test Reference" in content
    assert "Some API content" in content
    _REFERENCE_CACHE.clear()


def test_load_reference_file_caches(tmp_path):
    """_load_reference_file caches content after first read."""
    from llm_client import _load_reference_file, _REFERENCE_CACHE
    _REFERENCE_CACHE.clear()
    ref_file = tmp_path / "cached_ref.md"
    ref_file.write_text("original content")
    content1 = _load_reference_file(str(ref_file))
    ref_file.write_text("modified content")
    content2 = _load_reference_file(str(ref_file))
    assert content1 == content2  # cached, not re-read
    _REFERENCE_CACHE.clear()


def test_load_reference_file_missing_returns_empty():
    """_load_reference_file returns empty string for missing file."""
    from llm_client import _load_reference_file, _REFERENCE_CACHE
    _REFERENCE_CACHE.clear()
    content = _load_reference_file("/nonexistent/path/missing.md")
    assert content == ""
    _REFERENCE_CACHE.clear()


def test_build_system_prompt_with_reference(tmp_path):
    """_build_system_prompt includes reference content when include_reference=True."""
    from llm_client import _build_system_prompt, _REFERENCE_CACHE, _REF_PATHS
    _REFERENCE_CACHE.clear()
    # Create temp reference files
    api_ref = tmp_path / "build123d_api_reference.md"
    api_ref.write_text("# API Reference\nBox(length, width, height)")
    examples = tmp_path / "build123d_examples.md"
    examples.write_text("# Examples\nresult = Box(10, 10, 10)")
    # Temporarily override reference paths
    original_paths = _REF_PATHS.copy()
    _REF_PATHS["api_reference"] = str(api_ref)
    _REF_PATHS["examples"] = str(examples)
    try:
        prompt = _build_system_prompt("general", include_reference=True)
        assert "API Reference" in prompt
        assert "Examples" in prompt
        assert "CODE EXAMPLES" in prompt
        assert "API REFERENCE" in prompt
    finally:
        _REF_PATHS.update(original_paths)
        _REFERENCE_CACHE.clear()


def test_build_system_prompt_without_reference():
    """_build_system_prompt excludes reference when include_reference=False."""
    from llm_client import _build_system_prompt
    prompt = _build_system_prompt("general", include_reference=False)
    assert "CODE EXAMPLES" not in prompt
    assert "API REFERENCE" not in prompt
    # But cheatsheet should still be there
    assert "CHEATSHEET" in prompt


def test_list_profiles_info():
    """list_profiles_info() returns all available profiles."""
    client = LLMClient(api_key="test-key")
    profiles = client.list_profiles_info()
    assert len(profiles) == 4
    ids = [p["id"] for p in profiles]
    assert "general" in ids
    assert "furniture" in ids
    assert "flat" in ids
    assert "3d" in ids
    assert all("name" in p and "description" in p for p in profiles)
