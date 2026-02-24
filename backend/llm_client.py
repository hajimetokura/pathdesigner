"""OpenRouter LLM client for AI CAD code generation.

Uses the OpenAI-compatible API via the `openai` SDK.
Supports multiple models switchable at runtime.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

from openai import AsyncOpenAI

from nodes.ai_cad import execute_build123d_code, CodeExecutionError
from schemas import BrepObject

AVAILABLE_MODELS: dict[str, dict] = {
    "google/gemini-2.5-flash-lite": {
        "name": "Gemini 2.5 Flash Lite",
        "supports_vision": True,
        "large_context": True,
    },
    "deepseek/deepseek-r1": {
        "name": "DeepSeek R1",
        "supports_vision": False,
        "large_context": False,
    },
    "qwen/qwen3-coder-next": {
        "name": "Qwen3 Coder Next",
        "supports_vision": False,
        "large_context": False,
    },
}

_BASE_PROMPT = """\
You are a build123d expert generating Python code for CNC-machinable parts.

RULES:
- Assign final shape to variable `result` (Solid, Part, or Compound)
- Units: millimeters (mm)
- `from build123d import *` is pre-loaded — do NOT write import statements
- No print(), file I/O, or side effects
- Use Builder API (BuildPart) as default — it handles patterns, fillets, and holes cleanly
- Use Algebra API only for trivially simple shapes (e.g. single box, one boolean)
- Output ONLY code, no explanations
"""

_GENERAL_CHEATSHEET = """\

═══ build123d CHEATSHEET ═══

3D PRIMITIVES (center-aligned by default):
  Box(length, width, height)
  Cylinder(radius, height)
  Cone(bottom_radius, top_radius, height)
  Sphere(radius)
  Torus(major_radius, minor_radius)

2D SKETCH SHAPES (use inside BuildSketch):
  Rectangle(width, height)
  RectangleRounded(width, height, radius)
  Circle(radius)
  Ellipse(x_radius, y_radius)
  RegularPolygon(radius, side_count)
  Polygon(*pts)              # Polygon((0,0), (10,0), (10,5), (0,5))
  SlotOverall(width, height) # stadium/oblong slot
  Text("string", font_size)  # text shape (auto-Face in BuildSketch)

1D LINES (use inside BuildSketch > BuildLine, then call make_face()):
  Line(pt1, pt2)
  Polyline(*pts)             # connected line segments
  Spline(*pts)               # smooth curve through points
  CenterArc(center, radius, start_angle, arc_size)
  RadiusArc(pt1, pt2, radius)

OPERATIONS:
  extrude(amount=d)              # sketch → solid (inside BuildPart)
  extrude(sk.sketch, amount=d)   # sketch → solid (Algebra)
  revolve(axis=Axis.Z)           # rotate profile around axis
  loft()                         # connect multiple sections
  sweep()                        # sweep sketch along path
  fillet(edges, radius)          # round edges (BuildPart only)
  chamfer(edges, length)         # bevel edges (BuildPart only)
  offset(amount=-t, openings=f)  # shell (hollow out)
  mirror(about=Plane.YZ)
  make_face()                    # BuildLine edges → Face

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

PLANES:
  Plane.XY                  # default (Z normal)
  Plane.XZ                  # for revolve profiles
  Plane.XY.offset(20)       # parallel plane at Z=20
  path.line ^ 0             # plane at path start (for sweep)

SELECTORS:
  bp.faces().sort_by(Axis.Z)[-1]           # top face
  bp.faces().sort_by(Axis.Z)[0]            # bottom face
  bp.edges().group_by(Axis.Z)[-1]          # top edge group (list)
  bp.edges().filter_by(Axis.Z)             # vertical edges
  bp.edges().filter_by(GeomType.CIRCLE)    # circular edges
  bp.faces().filter_by(GeomType.CYLINDER)  # cylindrical faces

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

6. BuildLine MUST form closed loop — start point must equal end point
   Last Line(...) must connect back to first point

7. sort_by()[-1] returns ONE element; group_by()[-1] returns a LIST
   For fillet: fillet(bp.edges().group_by(Axis.Z)[-1], radius=2)

8. Builder mode result: bp.part (NOT bp or part)

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

_FURNITURE_CHEATSHEET = """\

═══ FURNITURE / SHEET MATERIAL PROFILE ═══

CORE CONCEPT: CNC sheet material parts. Constant thickness, machined from top.

KEY SETUP:
  thickness = 18  # material thickness (mm)
  # Use MIN alignment for origin at corner — easier coordinate math
  align=(Align.MIN, Align.MIN, Align.MIN)

PRIMITIVES & OPERATIONS:
  Box(width, depth, thickness)              # base plate
  Hole(radius, depth)                       # through-hole (dowel, bolt)
  GridLocations(x_sp, y_sp, x_n, y_n)      # hole patterns
  PolarLocations(radius, count)             # circular patterns
  SlotOverall(length, width)                # oblong slot
  RectangleRounded(w, h, r)                 # rounded cutout
  Rectangle(w, h)                           # square cutout

BOOLEAN:
  Mode.SUBTRACT                             # holes, pockets
  extrude(amount=-depth, mode=Mode.SUBTRACT) # pocket from top face

SELECTORS:
  bp.faces().sort_by(Axis.Z)[-1]           # top face (for sketching on)
  bp.faces().sort_by(Axis.Z)[0]            # bottom face

═══ PITFALLS ═══

1. HOLE DEPTH = MATERIAL THICKNESS for through-holes
   Hole(4, thickness) not Hole(4, 10) — use the variable
2. USE Align.MIN for sheet parts — origin at corner makes dimensions intuitive
   Box(300, 200, thickness, align=(Align.MIN, Align.MIN, Align.MIN))
3. DOWEL HOLES: standard φ8mm → radius=4, φ10mm → radius=5
4. SLOT WIDTH = tool diameter + clearance (typically tool_d + 0.2mm)
5. DEFAULT ALIGNMENT IS CENTER — without Align.MIN, Box(100,50,18) spans -50..50

═══ PATTERNS ═══

# Shelf panel with 4 dowel holes at corners:
thickness = 18
with BuildPart() as bp:
    Box(400, 250, thickness, align=(Align.MIN, Align.MIN, Align.MIN))
    top = bp.faces().sort_by(Axis.Z)[-1]
    with BuildSketch(top):
        with Locations((30, 30), (370, 30), (30, 220), (370, 220)):
            Circle(4)  # φ8 dowel holes
    extrude(amount=-thickness, mode=Mode.SUBTRACT)
result = bp.part

# Tab-and-slot joint panel (tab side):
thickness = 18
tab_w, tab_h = 30, thickness
with BuildPart() as bp:
    Box(300, 200, thickness, align=(Align.MIN, Align.MIN, Align.MIN))
    top = bp.faces().sort_by(Axis.Z)[-1]
    with BuildSketch(top):
        with Locations((75, 200), (150, 200), (225, 200)):
            Rectangle(tab_w, tab_h, align=(Align.CENTER, Align.MIN))
    extrude(amount=thickness)  # tabs grow upward
result = bp.part

# Grid-hole top plate (4x3 pattern):
thickness = 12
with BuildPart() as bp:
    Box(240, 180, thickness, align=(Align.MIN, Align.MIN, Align.MIN))
    with BuildSketch(bp.faces().sort_by(Axis.Z)[-1]):
        with GridLocations(50, 40, 4, 3):
            Circle(5)  # φ10 holes
    extrude(amount=-thickness, mode=Mode.SUBTRACT)
    fillet(bp.edges().group_by(Axis.Z)[-1], radius=3)
result = bp.part
"""

_FLAT_CHEATSHEET = """\

═══ FLAT / ENGRAVING PROFILE ═══

CORE CONCEPT: 2D outlines, pockets, and text engraving on flat stock.

TEXT OPERATIONS:
  Text("string", font_size=20)              # text shape (auto-Face)
  Text("string", font_size=20, font="Arial") # with font
  Text() is used inside BuildSketch — no make_face() needed

SKETCH SHAPES:
  Rectangle(w, h)
  RectangleRounded(w, h, radius)
  Circle(radius)
  Polygon(*pts)                             # arbitrary polygon
  RegularPolygon(radius, side_count)
  Ellipse(x_radius, y_radius)

LINES (for complex outlines, use inside BuildSketch > BuildLine):
  Line(pt1, pt2)
  Polyline(*pts)
  Spline(*pts)                              # smooth curve
  CenterArc(center, radius, start_angle, arc_size)
  RadiusArc(pt1, pt2, radius)
  make_face()                               # REQUIRED after BuildLine

OPERATIONS:
  extrude(sk.sketch, amount=thickness)      # sketch → solid
  extrude(amount=-depth, mode=Mode.SUBTRACT) # pocket from top
  offset(amount=d)                          # expand/shrink 2D outline

═══ PITFALLS ═══

1. Text() inside BuildSketch auto-creates Face — do NOT call make_face()
2. BuildLine shapes MUST form a closed loop (start point = end point)
3. POCKET DEPTH is negative + Mode.SUBTRACT: extrude(amount=-3, mode=Mode.SUBTRACT)
4. Spline/Line must connect end-to-end: Spline ends at pt, next Line starts at pt
5. For text on a plate, subtract the text shape with SUBTRACT mode
6. Complex outlines: BuildLine → make_face() → extrude

═══ PATTERNS ═══

# Text engraving on a nameplate:
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

# Complex outline sign (Spline border):
thickness = 6
with BuildPart() as bp:
    with BuildSketch():
        with BuildLine():
            Spline((0, 0), (40, 20), (80, 10), (120, 25), (160, 0))
            Line((160, 0), (160, -60))
            Line((160, -60), (0, -60))
            Line((0, -60), (0, 0))
        make_face()
    extrude(amount=thickness)
result = bp.part

# Bracket with polar hole pattern:
thickness = 8
with BuildPart() as bp:
    with BuildSketch():
        Circle(50)
        Circle(10, mode=Mode.SUBTRACT)  # center hole
    extrude(amount=thickness)
    top = bp.faces().sort_by(Axis.Z)[-1]
    with BuildSketch(top):
        with PolarLocations(30, 6):
            Circle(4)  # 6 bolt holes
    extrude(amount=-thickness, mode=Mode.SUBTRACT)
result = bp.part
"""

_3D_CHEATSHEET = """\

═══ 3D MODELING PROFILE ═══

CORE CONCEPT: Freeform 3D shapes using revolve, loft, sweep, shell.

3D OPERATIONS:
  revolve(axis=Axis.Z, revolution_arc=360)  # rotate profile
  loft()                                     # connect sections
  sweep()                                    # sweep along path
  offset(amount=-t, openings=face)           # shell (hollow out)
  fillet(edges, radius)                      # round edges
  chamfer(edges, length)                     # bevel edges
  split(bisect_by=Plane.XZ)                 # cut in half

PLANES & PATHS:
  Plane.XY                  # default (Z normal)
  Plane.XZ                  # for revolve profiles (Y normal)
  Plane.XY.offset(20)       # parallel plane at Z=20
  path.line ^ 0             # plane at path start (for sweep)
  path.line ^ 0.5           # plane at path midpoint

SELECTORS:
  bp.edges().group_by(Axis.Z)[-1]           # top edges (for fillet)
  bp.edges().filter_by(Axis.Z)              # vertical edges
  bp.faces().sort_by(Axis.Z)[-1]            # top face (for shell opening)
  bp.faces().filter_by(GeomType.CYLINDER)   # cylindrical faces
  bp.edges().filter_by(GeomType.CIRCLE)     # circular edges

═══ PITFALLS ═══

1. REVOLVE PROFILE must be on ONE SIDE of axis (X≥0 for Axis.Z on XZ plane)
2. SWEEP: sketch plane = path.line ^ 0 (plane at path start)
3. LOFT: BuildSketch sections from bottom to top (Z order matters)
4. SHELL: must specify openings= face, or it creates fully enclosed void
5. FILLET/CHAMFER only inside BuildPart — not on Algebra objects
6. FILLET RADIUS must be less than smallest adjacent edge length

═══ PATTERNS ═══

# Vase (revolve + shell):
with BuildPart() as bp:
    with BuildSketch(Plane.XZ):
        with BuildLine():
            Polyline((0, 0), (30, 0), (25, 40), (15, 70), (20, 100))
            Line((20, 100), (0, 100))
            Line((0, 100), (0, 0))
        make_face()
    revolve(axis=Axis.Z)
    offset(amount=-3, openings=bp.faces().sort_by(Axis.Z)[-1])
result = bp.part

# Tray (rounded box + shell):
with BuildPart() as bp:
    Box(150, 100, 40)
    fillet(bp.edges().filter_by(Axis.Z), radius=10)
    top = bp.faces().sort_by(Axis.Z)[-1]
    offset(amount=-3, openings=top)
result = bp.part

# Pipe connector (sweep + boolean):
with BuildPart() as bp:
    with BuildLine() as path:
        Spline((0, 0, 0), (30, 0, 20), (60, 0, 20), (90, 0, 0))
    with BuildSketch(path.line ^ 0):
        Circle(8)
    sweep()
    with BuildSketch(path.line ^ 0):
        Circle(6)
    sweep(mode=Mode.SUBTRACT)
result = bp.part
"""

_PROFILES: dict[str, dict] = {
    "general": {
        "name": "汎用",
        "description": "幅広い形状に対応",
        "cheatsheet": _GENERAL_CHEATSHEET,
    },
    "furniture": {
        "name": "家具・板材",
        "description": "板材CNC加工パーツ",
        "cheatsheet": _FURNITURE_CHEATSHEET,
    },
    "flat": {
        "name": "平面加工・彫刻",
        "description": "2D切り抜き・ポケット・テキスト彫刻",
        "cheatsheet": _FLAT_CHEATSHEET,
    },
    "3d": {
        "name": "3D造形",
        "description": "回転体・ロフト・スイープ・シェル",
        "cheatsheet": _3D_CHEATSHEET,
    },
}


_DATA_DIR = Path(__file__).parent / "data"

_REF_PATHS: dict[str, str] = {
    "api_reference": str(_DATA_DIR / "build123d_api_reference.md"),
    "examples": str(_DATA_DIR / "build123d_examples.md"),
}

_REFERENCE_CACHE: dict[str, str] = {}


def _load_reference_file(path: str) -> str:
    """Load a reference file with caching. Returns empty string if missing."""
    if path not in _REFERENCE_CACHE:
        p = Path(path)
        _REFERENCE_CACHE[path] = p.read_text() if p.exists() else ""
    return _REFERENCE_CACHE[path]


def _build_system_prompt(
    profile: str = "general",
    include_reference: bool = False,
) -> str:
    """Build system prompt from base + profile cheatsheet + optional full reference."""
    p = _PROFILES.get(profile)
    if p is None:
        p = _PROFILES["general"]
    prompt = _BASE_PROMPT + p["cheatsheet"]

    if include_reference:
        examples = _load_reference_file(_REF_PATHS["examples"])
        if examples:
            prompt += "\n\n═══ CODE EXAMPLES ═══\n" + examples
        api_ref = _load_reference_file(_REF_PATHS["api_reference"])
        if api_ref:
            prompt += "\n\n═══ API REFERENCE ═══\n" + api_ref

    return prompt

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
        profile: str = "general",
    ) -> str:
        """Generate build123d code from a text prompt (+ optional image).

        Returns the raw Python code string (no fences).
        """
        use_model = model or self.default_model
        use_reference = _model_has_large_context(use_model)
        messages: list[dict] = [
            {"role": "system", "content": _build_system_prompt(profile, include_reference=use_reference)}
        ]

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
            messages=messages,  # type: ignore[arg-type]
        )

        raw = response.choices[0].message.content or ""
        return _strip_code_fences(raw)

    async def generate_with_history(
        self,
        messages: list[dict],
        model: str | None = None,
        profile: str = "general",
    ) -> str:
        """Generate code with full conversation history.

        messages should be list of {"role": "user"|"assistant", "content": str}
        System prompt is prepended automatically.
        """
        use_model = model or self.default_model
        use_reference = _model_has_large_context(use_model)
        full_messages = [
            {"role": "system", "content": _build_system_prompt(profile, include_reference=use_reference)}
        ] + messages

        response = await self._client.chat.completions.create(
            model=use_model,
            messages=full_messages,  # type: ignore[arg-type]
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
        profile: str = "general",
    ) -> tuple[str, list[BrepObject], bytes | None]:
        """Generate code, execute it, retry on failure.

        Returns: (final_code, objects, step_bytes)
        Raises: CodeExecutionError after all retries exhausted
        """
        retries = max_retries if max_retries is not None else self.max_retries

        # Initial generation
        if messages:
            code = await self.generate_with_history(messages, model, profile=profile)
        else:
            code = await self.generate(prompt, image_base64, model, profile=profile)

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
                code = await self.generate_with_history(retry_messages, model, profile=profile)
                retry_messages.append({"role": "assistant", "content": code})

        raise last_error  # type: ignore[misc]

    def list_profiles_info(self) -> list[dict]:
        """Return available prompt profiles with metadata."""
        return [
            {"id": pid, "name": p["name"], "description": p["description"]}
            for pid, p in _PROFILES.items()
        ]

    def list_models(self) -> list[dict]:
        """Return available models with metadata."""
        return [
            {
                "id": mid,
                "name": info["name"],
                "is_default": mid == self.default_model,
                "supports_vision": info["supports_vision"],
                "large_context": info.get("large_context", False),
            }
            for mid, info in AVAILABLE_MODELS.items()
        ]


def _model_supports_vision(model_id: str) -> bool:
    info = AVAILABLE_MODELS.get(model_id)
    return bool(info and info.get("supports_vision"))


def _model_has_large_context(model_id: str) -> bool:
    info = AVAILABLE_MODELS.get(model_id)
    return bool(info and info.get("large_context"))


def _strip_code_fences(text: str) -> str:
    """Remove markdown code fences if present."""
    match = _CODE_FENCE_RE.search(text)
    if match:
        return match.group(1).strip()
    return text.strip()
