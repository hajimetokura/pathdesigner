"""OpenRouter LLM client for AI CAD code generation.

Uses the OpenAI-compatible API via the `openai` SDK.
Supports multiple models switchable at runtime.
"""

from __future__ import annotations

import os
import re

from openai import AsyncOpenAI

from nodes.ai_cad import execute_build123d_code, CodeExecutionError
from schemas import BrepObject

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
You are a build123d expert generating Python code for CNC sheet parts.

RULES:
- Assign final shape to variable `result` (Solid, Part, or Compound)
- Units: millimeters (mm)
- `from build123d import *` is pre-loaded — do NOT write import statements
- No print(), file I/O, or side effects
- Use Builder API (BuildPart) as default — it handles patterns, fillets, and holes cleanly
- Use Algebra API only for trivially simple shapes (e.g. single box, one boolean)
- Output ONLY code, no explanations

═══ build123d CHEATSHEET ═══

3D PRIMITIVES (center-aligned by default):
  Box(length, width, height)
  Cylinder(radius, height)
  Cone(bottom_radius, top_radius, height)

2D SKETCH SHAPES (use inside BuildSketch):
  Rectangle(width, height)
  RectangleRounded(width, height, radius)
  Circle(radius)
  Ellipse(x_radius, y_radius)
  RegularPolygon(radius, side_count)
  Polygon(*pts)              # Polygon((0,0), (10,0), (10,5), (0,5))
  SlotOverall(width, height) # stadium/oblong slot
  Spline(*pts)               # smooth curve through points

OPERATIONS:
  extrude(to_extrude, amount)     # sketch → solid
  fillet(objects, radius)          # ONLY inside BuildPart
  chamfer(objects, length)         # ONLY inside BuildPart
  mirror(about=Plane.YZ)

BOOLEAN (Algebra API):
  plate - hole      # subtract
  part1 + part2     # union
  a & b             # intersect

PLACEMENT:
  Pos(x, y, z) * shape     # translate
  Rot(0, 0, 45) * shape    # rotate (degrees)
  Pos(...) * Rot(...) * shape

PATTERNS (inside BuildPart/BuildSketch):
  Locations((x1,y1), (x2,y2), ...)
  GridLocations(x_spacing, y_spacing, x_count, y_count)
  PolarLocations(radius, count)

BUILDER API:
  with BuildPart() as bp:
      Box(200, 100, 6)
      with GridLocations(50, 30, 3, 2):
          Hole(radius, depth)   # auto-subtract
      result = bp.part

═══ PITFALLS — READ CAREFULLY ═══

1. DEFAULT ALIGNMENT IS CENTER — Box(100, 50, 10) spans -50..50, -25..25, -5..5
   Use align=(Align.MIN, Align.MIN, Align.MIN) to place at origin corner

2. FILLET/CHAMFER — ONLY work inside BuildPart context, NOT on Algebra shapes
   WRONG: box.fillet(...)
   RIGHT: with BuildPart() as bp: Box(...); fillet(bp.edges(), radius=3)

3. SKETCH NEEDS EXTRUDE — BuildSketch result is not a solid
   WRONG: result = sk.sketch
   RIGHT: result = extrude(sk.sketch, amount=6)

4. Cylinder height = Box height for clean boolean — if Box height=10, use Cylinder(r, 10)

5. For holes in Algebra API, use Cylinder subtract:
   plate = Box(100, 50, 10) - Pos(20, 0, 0) * Cylinder(5, 10)

═══ PATTERNS ═══

# Simple plate with holes (Algebra — preferred for simple parts):
plate = Box(200, 100, 6)
for x, y in [(30, 20), (170, 20), (30, 80), (170, 80)]:
    plate = plate - Pos(x - 100, y - 50, 0) * Cylinder(4, 6)
result = plate

# Plate with hole pattern (Builder — for repeated patterns):
with BuildPart() as bp:
    Box(200, 100, 6)
    with GridLocations(50, 30, 3, 2):
        Hole(4, 6)
result = bp.part

# Rounded rectangle plate (Sketch + extrude):
with BuildSketch() as sk:
    RectangleRounded(200, 100, radius=10)
    with Locations((50, 0)):
        Circle(15, mode=Mode.SUBTRACT)
result = extrude(sk.sketch, amount=6)

# Curved outline (Spline + extrude):
with BuildSketch() as sk:
    with BuildLine():
        Spline((0, 0), (50, 30), (100, 20), (150, 40), (200, 0))
        Line((200, 0), (200, -50))
        Line((200, -50), (0, -50))
        Line((0, -50), (0, 0))
    make_face()
result = extrude(sk.sketch, amount=6)

# Pocket (partial-depth cut):
with BuildPart() as bp:
    Box(200, 100, 12)
    top = bp.faces().sort_by(Axis.Z)[-1]
    with BuildSketch(top):
        with Locations((0, 0)):
            RectangleRounded(80, 40, radius=5)
    extrude(amount=-4, mode=Mode.SUBTRACT)
result = bp.part
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
        self.max_retries = int(os.environ.get("AI_CAD_MAX_RETRIES", "2"))
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

    async def generate_and_execute(
        self,
        prompt: str,
        *,
        messages: list[dict] | None = None,
        image_base64: str | None = None,
        model: str | None = None,
        max_retries: int | None = None,
    ) -> tuple[str, list[BrepObject], bytes | None]:
        """Generate code, execute it, retry on failure.

        Returns: (final_code, objects, step_bytes)
        Raises: CodeExecutionError after all retries exhausted
        """
        retries = max_retries if max_retries is not None else self.max_retries

        # Initial generation
        if messages:
            code = await self.generate_with_history(messages, model)
        else:
            code = await self.generate(prompt, image_base64, model)

        # Try execute + retry loop
        last_error: CodeExecutionError | None = None
        retry_messages = list(messages or [])
        if not retry_messages:
            retry_messages.append({"role": "user", "content": prompt})
        retry_messages.append({"role": "assistant", "content": code})

        for attempt in range(1 + retries):
            try:
                objects, step_bytes = execute_build123d_code(code)
                return code, objects, step_bytes
            except CodeExecutionError as e:
                last_error = e
                if attempt >= retries:
                    break
                # Build retry feedback
                retry_messages.append({
                    "role": "user",
                    "content": (
                        f"Your code produced an error:\n{e}\n\n"
                        f"Failed code:\n```python\n{code}\n```\n\n"
                        f"Fix the code and output only the corrected version."
                    ),
                })
                code = await self.generate_with_history(retry_messages, model)
                retry_messages.append({"role": "assistant", "content": code})

        raise last_error  # type: ignore[misc]

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
