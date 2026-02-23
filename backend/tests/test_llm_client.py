"""Tests for OpenRouter LLM client."""

import os
from unittest.mock import AsyncMock, patch, MagicMock

import pytest

# Ensure backend path
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from llm_client import LLMClient, AVAILABLE_MODELS


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
