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
    assert "QUICK REFERENCE" in prompt
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

    await client.generate("Make a box", profile="2d")

    call_kwargs = mock_client.chat.completions.create.call_args[1]
    system_msg = call_kwargs["messages"][0]["content"]
    assert "2D" in system_msg


def test_2d_profile_has_patterns():
    """2D profile includes text, sheet material, and outline keywords."""
    from llm_client import _build_system_prompt
    prompt = _build_system_prompt("2d")
    assert "2D" in prompt
    assert "Text" in prompt
    assert "make_face" in prompt
    assert "Align.MIN" in prompt
    assert "thickness" in prompt
    assert "SUBTRACT" in prompt


def test_2d_pattern_shelf_executes():
    """2D pattern example (shelf with dowel holes) actually runs."""
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


def test_2d_pattern_nameplate_executes():
    """2D pattern example (nameplate with text engraving) actually runs."""
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
    assert "QUICK REFERENCE" in prompt


def test_available_models_have_large_context():
    """Each model has large_context flag."""
    for mid, info in AVAILABLE_MODELS.items():
        assert "large_context" in info, f"{mid} missing large_context"


def test_flash_lite_is_large_context():
    """Gemini Flash Lite has large_context=True."""
    assert AVAILABLE_MODELS["google/gemini-2.5-flash-lite"]["large_context"] is True


def test_list_models_includes_large_context():
    """list_models() output includes large_context field."""
    client = LLMClient(api_key="test-key")
    models = client.list_models()
    for m in models:
        assert "large_context" in m


def test_model_has_large_context_helper():
    """_model_has_large_context returns correct values."""
    from llm_client import _model_has_large_context
    assert _model_has_large_context("google/gemini-2.5-flash-lite") is True
    assert _model_has_large_context("deepseek/deepseek-r1") is False
    assert _model_has_large_context("unknown/model") is False


@pytest.mark.asyncio
async def test_generate_includes_reference_for_large_context_model(tmp_path):
    """generate() includes reference for large_context models."""
    from llm_client import _REFERENCE_CACHE, _REF_PATHS
    _REFERENCE_CACHE.clear()
    # Create temp reference files
    api_ref = tmp_path / "build123d_api_reference.md"
    api_ref.write_text("UNIQUE_API_MARKER_12345")
    examples = tmp_path / "build123d_examples.md"
    examples.write_text("UNIQUE_EXAMPLES_MARKER_67890")
    original_paths = _REF_PATHS.copy()
    _REF_PATHS["api_reference"] = str(api_ref)
    _REF_PATHS["examples"] = str(examples)

    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = "result = Box(10, 10, 10)"

    mock_client = MagicMock()
    mock_client.chat = MagicMock()
    mock_client.chat.completions = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

    client = LLMClient(api_key="test-key")
    client._client = mock_client

    try:
        # Flash Lite is large_context=True
        await client.generate("box", model="google/gemini-2.5-flash-lite")
        call_kwargs = mock_client.chat.completions.create.call_args[1]
        system_msg = call_kwargs["messages"][0]["content"]
        assert "UNIQUE_API_MARKER_12345" in system_msg
        assert "UNIQUE_EXAMPLES_MARKER_67890" in system_msg
    finally:
        _REF_PATHS.update(original_paths)
        _REFERENCE_CACHE.clear()


@pytest.mark.asyncio
async def test_generate_excludes_reference_for_small_context_model(tmp_path):
    """generate() excludes reference for non-large_context models."""
    from llm_client import _REFERENCE_CACHE, _REF_PATHS
    _REFERENCE_CACHE.clear()
    api_ref = tmp_path / "build123d_api_reference.md"
    api_ref.write_text("UNIQUE_API_MARKER_12345")
    examples = tmp_path / "build123d_examples.md"
    examples.write_text("UNIQUE_EXAMPLES_MARKER_67890")
    original_paths = _REF_PATHS.copy()
    _REF_PATHS["api_reference"] = str(api_ref)
    _REF_PATHS["examples"] = str(examples)

    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = "result = Box(10, 10, 10)"

    mock_client = MagicMock()
    mock_client.chat = MagicMock()
    mock_client.chat.completions = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

    client = LLMClient(api_key="test-key")
    client._client = mock_client

    try:
        # DeepSeek R1 is large_context=False
        await client.generate("box", model="deepseek/deepseek-r1")
        call_kwargs = mock_client.chat.completions.create.call_args[1]
        system_msg = call_kwargs["messages"][0]["content"]
        assert "UNIQUE_API_MARKER_12345" not in system_msg
        assert "UNIQUE_EXAMPLES_MARKER_67890" not in system_msg
    finally:
        _REF_PATHS.update(original_paths)
        _REFERENCE_CACHE.clear()


@pytest.mark.asyncio
async def test_design_with_context_calls_designer_model():
    """_design_with_context calls Gemini with full reference."""
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = "DESIGN: box from 6 panels\nAPPROACH: Builder API"

    mock_client = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

    client = LLMClient(api_key="test-key")
    client._client = mock_client

    result = await client._design_with_context("300x300x300の箱を板で組んで", profile="general")

    assert "DESIGN" in result or "box" in result.lower()
    call_kwargs = mock_client.chat.completions.create.call_args[1]
    assert call_kwargs["model"] == "google/gemini-2.5-flash-lite"


@pytest.mark.asyncio
async def test_generate_code_calls_coder_model():
    """_generate_code calls Qwen3 Coder with design context."""
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = "result = Box(100, 50, 10)"

    mock_client = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

    client = LLMClient(api_key="test-key")
    client._client = mock_client

    design = "DESIGN: single box 100x100x100\nAPPROACH: Algebra API"
    code = await client._generate_code("100mmの立方体", design, profile="general")

    assert "Box" in code
    call_kwargs = mock_client.chat.completions.create.call_args[1]
    assert call_kwargs["model"] == "qwen/qwen3-coder"


def test_list_profiles_info():
    """list_profiles_info() returns all available profiles."""
    client = LLMClient(api_key="test-key")
    profiles = client.list_profiles_info()
    assert len(profiles) == 2
    ids = [p["id"] for p in profiles]
    assert "general" in ids
    assert "2d" in ids
    assert all("name" in p and "description" in p for p in profiles)
