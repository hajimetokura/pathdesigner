"""OpenRouter LLM client for AI CAD code generation.

Uses the OpenAI-compatible API via the `openai` SDK.
Supports multiple models switchable at runtime.
"""

from __future__ import annotations

import os
import re

from openai import AsyncOpenAI

AVAILABLE_MODELS: dict[str, dict] = {
    "google/gemini-2.5-flash-lite": {
        "name": "Gemini 2.5 Flash Lite",
        "supports_vision": True,
    },
    "deepseek/deepseek-r1": {
        "name": "DeepSeek R1",
        "supports_vision": False,
    },
    "qwen/qwen3-coder-next": {
        "name": "Qwen3 Coder Next",
        "supports_vision": False,
    },
}

_SYSTEM_PROMPT = """\
You are a build123d 3D modeling expert. Generate Python code using the build123d library.

Rules:
- Assign the final Solid/Part/Compound to a variable called `result`
- Units are millimeters (mm)
- `from build123d import *` is auto-inserted — do NOT write any import statements
- Do NOT write print(), file I/O, or any side effects
- Target: flat sheet parts for CNC cutting (primarily planar shapes)
- Output ONLY the code, no explanations

Example — simple box:
result = Box(100, 50, 10)

Example — box with hole:
box = Box(100, 50, 10)
hole = Pos(30, 0, 0) * Cylinder(10, 10)
result = box - hole

Example — L-shaped part:
with BuildPart() as p:
    with BuildSketch():
        with BuildLine():
            l1 = Line((0,0), (100,0))
            l2 = Line((100,0), (100,30))
            l3 = Line((100,30), (40,30))
            l4 = Line((40,30), (40,60))
            l5 = Line((40,60), (0,60))
            l6 = Line((0,60), (0,0))
        make_face()
    extrude(amount=10)
result = p.part
"""

_CODE_FENCE_RE = re.compile(r"```(?:python)?\s*\n?(.*?)\n?\s*```", re.DOTALL)


class LLMClient:
    """OpenRouter API client with model switching."""

    def __init__(
        self,
        api_key: str | None = None,
        default_model: str | None = None,
    ):
        key = api_key or os.environ.get("OPENROUTER_API_KEY", "")
        self.default_model = default_model or os.environ.get(
            "AI_CAD_DEFAULT_MODEL", "google/gemini-2.5-flash-lite"
        )
        self._client = AsyncOpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=key,
            default_headers={"HTTP-Referer": "https://pathdesigner.local"},
        )

    async def generate(
        self,
        prompt: str,
        image_base64: str | None = None,
        model: str | None = None,
    ) -> str:
        """Generate build123d code from a text prompt (+ optional image).

        Returns the raw Python code string (no fences).
        """
        use_model = model or self.default_model
        messages: list[dict] = [{"role": "system", "content": _SYSTEM_PROMPT}]

        # Build user message (text or multimodal)
        if image_base64 and _model_supports_vision(use_model):
            user_content: list[dict] = [
                {"type": "text", "text": prompt},
                {
                    "type": "image_url",
                    "image_url": {"url": image_base64},
                },
            ]
            messages.append({"role": "user", "content": user_content})
        else:
            messages.append({"role": "user", "content": prompt})

        response = await self._client.chat.completions.create(
            model=use_model,
            messages=messages,
        )

        raw = response.choices[0].message.content or ""
        return _strip_code_fences(raw)

    async def generate_with_history(
        self,
        messages: list[dict],
        model: str | None = None,
    ) -> str:
        """Generate code with full conversation history.

        messages should be list of {"role": "user"|"assistant", "content": str}
        System prompt is prepended automatically.
        """
        use_model = model or self.default_model
        full_messages = [{"role": "system", "content": _SYSTEM_PROMPT}] + messages

        response = await self._client.chat.completions.create(
            model=use_model,
            messages=full_messages,
        )

        raw = response.choices[0].message.content or ""
        return _strip_code_fences(raw)

    def list_models(self) -> list[dict]:
        """Return available models with metadata."""
        return [
            {
                "id": mid,
                "name": info["name"],
                "is_default": mid == self.default_model,
                "supports_vision": info["supports_vision"],
            }
            for mid, info in AVAILABLE_MODELS.items()
        ]


def _model_supports_vision(model_id: str) -> bool:
    info = AVAILABLE_MODELS.get(model_id)
    return bool(info and info.get("supports_vision"))


def _strip_code_fences(text: str) -> str:
    """Remove markdown code fences if present."""
    match = _CODE_FENCE_RE.search(text)
    if match:
        return match.group(1).strip()
    return text.strip()
