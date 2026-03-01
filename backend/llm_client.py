"""OpenRouter LLM client for AI CAD code generation.

Uses the OpenAI-compatible API via the `openai` SDK.
Supports multiple models switchable at runtime.
"""

from __future__ import annotations

import os
import re
from collections.abc import Awaitable, Callable
from pathlib import Path

from openai import AsyncOpenAI

from nodes.ai_cad import execute_build123d_code, CodeExecutionError
from schemas import BrepObject

PIPELINE_MODELS = {
    "designer": "google/gemini-2.5-flash-lite",
    "coder": "qwen/qwen3-coder-next",
}

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
        "large_context": True,
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

═══ QUICK REFERENCE ═══

3D: Box(l,w,h) | Cylinder(r,h) | Cone(r1,r2,h) | Sphere(r) | Torus(R,r)
2D: Rectangle(w,h) | RectangleRounded(w,h,r) | Circle(r) | Polygon(*pts) | Text("s",font_size)
1D: Line(p1,p2) | Polyline(*pts) | Spline(*pts) | CenterArc(c,r,start,arc) | RadiusArc(p1,p2,r)
Ops: extrude(amount=d) | revolve(axis=) | loft() | sweep() | fillet(edges,r) | chamfer(edges,l)
     offset(amount=-t, openings=f) | mirror(about=Plane.YZ) | make_face()
Bool: A - B (subtract) | A + B (union) | A & B (intersect)
Place: Pos(x,y,z) * shape | Rot(0,0,45) * shape
Pattern: Locations(pts) | GridLocations(xs,ys,xn,yn) | PolarLocations(r,n)
Plane: Plane.XY | Plane.XZ | Plane.XY.offset(20) | path.line ^ 0
Select: .sort_by(Axis.Z)[-1] (top) | .group_by(Axis.Z)[-1] (top group)
        .filter_by(Axis.Z) (vertical) | .filter_by(GeomType.CIRCLE) (circular)

═══ PITFALLS — READ CAREFULLY ═══

1. DEFAULT ALIGNMENT IS CENTER — Box(100,50,10) spans -50..50, -25..25, -5..5
   Use align=(Align.MIN, Align.MIN, Align.MIN) to place at origin corner

2. FILLET/CHAMFER — ONLY inside BuildPart, NOT on Algebra shapes
   WRONG: box.fillet(...)  RIGHT: fillet(bp.edges(), radius=3)

3. SKETCH NEEDS EXTRUDE — BuildSketch result is not a solid
   WRONG: result = sk.sketch  RIGHT: result = extrude(sk.sketch, amount=6)

4. Cylinder height = Box height for clean boolean

5. Holes in Algebra: plate = Box(100,50,10) - Pos(20,0,0) * Cylinder(5, 10)

6. BuildLine MUST form closed loop — last Line connects back to first point

7. sort_by()[-1] = ONE element; group_by()[-1] = LIST
   fillet(bp.edges().group_by(Axis.Z)[-1], radius=2)

8. Builder result: bp.part (NOT bp or part)

═══ PATTERNS ═══

# Simple plate with holes (Algebra):
plate = Box(200, 100, 6)
for x, y in [(30, 20), (170, 20), (30, 80), (170, 80)]:
    plate = plate - Pos(x - 100, y - 50, 0) * Cylinder(4, 6)
result = plate

# Plate with hole pattern (Builder):
with BuildPart() as bp:
    Box(200, 100, 6)
    with GridLocations(50, 30, 3, 2):
        Hole(4, 6)
result = bp.part

# Rounded rectangle plate:
with BuildSketch() as sk:
    RectangleRounded(200, 100, radius=10)
    with Locations((50, 0)):
        Circle(15, mode=Mode.SUBTRACT)
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

_2D_CHEATSHEET = """\

═══ 2D / SHEET MATERIAL PROFILE ═══

CORE CONCEPT: 2D outlines, sheet material CNC parts, pockets, text engraving.
Constant thickness, machined from top.

KEY SETUP:
  thickness = 18  # material thickness (mm)
  align=(Align.MIN, Align.MIN, Align.MIN)  # origin at corner

═══ QUICK REFERENCE ═══

2D: Rectangle(w,h) | RectangleRounded(w,h,r) | Circle(r) | Polygon(*pts)
    SlotOverall(w,h) | Text("s", font_size) | Ellipse(rx,ry) | RegularPolygon(r,n)
1D: Line(p1,p2) | Polyline(*pts) | Spline(*pts) | CenterArc(c,r,start,arc)
    make_face() — REQUIRED after BuildLine
Ops: extrude(amount=d) | extrude(amount=-d, mode=Mode.SUBTRACT) | offset(amount=d)
Place: Pos(x,y,z) * shape | Rot(0,0,45) * shape
Pattern: Locations(pts) | GridLocations(xs,ys,xn,yn) | PolarLocations(r,n)
Select: .sort_by(Axis.Z)[-1] (top face) | .sort_by(Axis.Z)[0] (bottom)

═══ PITFALLS — READ CAREFULLY ═══

1. Text() inside BuildSketch auto-creates Face — do NOT call make_face()
2. BuildLine MUST form closed loop (start point = end point)
3. POCKET DEPTH is negative + Mode.SUBTRACT: extrude(amount=-3, mode=Mode.SUBTRACT)
4. Spline/Line must connect end-to-end: Spline ends at pt, next Line starts at pt
5. HOLE DEPTH = MATERIAL THICKNESS for through-holes: Hole(4, thickness)
6. USE Align.MIN for sheet parts — origin at corner makes dimensions intuitive
   Box(300, 200, thickness, align=(Align.MIN, Align.MIN, Align.MIN))
7. DEFAULT ALIGNMENT IS CENTER — without Align.MIN, Box(100,50,18) spans -50..50
8. Builder result: bp.part (NOT bp or part)

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

# Shelf panel with dowel holes:
thickness = 18
with BuildPart() as bp:
    Box(400, 250, thickness, align=(Align.MIN, Align.MIN, Align.MIN))
    top = bp.faces().sort_by(Axis.Z)[-1]
    with BuildSketch(top):
        with Locations((30, 30), (370, 30), (30, 220), (370, 220)):
            Circle(4)  # φ8 dowel holes
    extrude(amount=-thickness, mode=Mode.SUBTRACT)
result = bp.part

# Curved outline sign (Spline border):
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

_SKETCH_CUTOUT_CHEATSHEET = """\

═══ SKETCH → 板材切削（2.5D）プロファイル ═══

CORE CONCEPT: ユーザーの手描きスケッチ画像から、CNC切削用の2.5D形状を生成する。
板材から切り出す形状（外形線・穴・ポケット）を忠実に再現する。

KEY RULES:
- スケッチの輪郭を忠実にトレースし、build123dの2Dプリミティブで再現
- 厚み（Z方向）は extrude のみ使用（2.5D加工）
- 丸みを帯びた角は RectangleRounded や fillet で表現
- フリーフォーム形状は Spline + BuildLine + make_face() で構築
- align=(Align.MIN, Align.MIN, Align.MIN) を使用してXY原点を左下に配置

═══ QUICK REFERENCE ═══

2D: Rectangle(w,h) | RectangleRounded(w,h,r) | Circle(r) | Polygon(*pts)
    SlotOverall(w,h) | Ellipse(rx,ry) | RegularPolygon(r,n)
1D: Line(p1,p2) | Polyline(*pts) | Spline(*pts) | CenterArc(c,r,start,arc)
    RadiusArc(p1,p2,r) | make_face() — REQUIRED after BuildLine
Ops: extrude(amount=d) | extrude(amount=-d, mode=Mode.SUBTRACT)
     offset(amount=d) | mirror(about=Plane.YZ)
Place: Pos(x,y,z) * shape | Rot(0,0,45) * shape
Pattern: Locations(pts) | GridLocations(xs,ys,xn,yn) | PolarLocations(r,n)

═══ PITFALLS ═══

1. スケッチの曲線は Spline で近似する（直線化しない）
2. BuildLine は閉じたループを形成すること（始点＝終点）
3. make_face() を忘れると extrude できない
4. 穴は Mode.SUBTRACT で別の extrude を行う
5. DEFAULT ALIGNMENT IS CENTER — align=(Align.MIN, Align.MIN, Align.MIN) 推奨
6. Builder result: bp.part (NOT bp or part)
7. thickness 変数を定義して extrude(amount=thickness) とする

═══ PATTERNS ═══

# スケッチから有機的な形状を切り出す:
thickness = 12
with BuildPart() as bp:
    with BuildSketch():
        with BuildLine():
            Spline((0, 0), (30, 40), (80, 50), (120, 30), (150, 0))
            Line((150, 0), (150, -80))
            Line((150, -80), (0, -80))
            Line((0, -80), (0, 0))
        make_face()
    extrude(amount=thickness)
result = bp.part

# 角丸の板に穴を開ける:
thickness = 18
with BuildPart() as bp:
    with BuildSketch():
        RectangleRounded(200, 120, radius=15)
        with Locations((50, 0), (-50, 0)):
            Circle(10, mode=Mode.SUBTRACT)
    extrude(amount=thickness)
result = bp.part
"""

_SKETCH_3D_CHEATSHEET = """\

═══ SKETCH → 立体物（3D）プロファイル ═══

CORE CONCEPT: ユーザーの手描きスケッチ画像から、3D立体形状を生成する。
押し出し（extrude）、回転体（revolve）、ロフト（loft）等を組み合わせて形状を構築する。
スケッチが示す形状の意図（器、ボトル、ハンドル等）を読み取り、適切な3D手法を選択する。

KEY RULES:
- スケッチの側面シルエットを断面プロファイルとして使用
- 回転対称な形状（カップ、ボトル、皿等）は revolve を使用
- 直線的な形状は extrude を使用
- 断面変化がある形状は loft を使用
- 曲面はフィレット（fillet）で表現

═══ QUICK REFERENCE ═══

3D: Box(l,w,h) | Cylinder(r,h) | Cone(r1,r2,h) | Sphere(r) | Torus(R,r)
2D: Rectangle(w,h) | RectangleRounded(w,h,r) | Circle(r) | Polygon(*pts)
1D: Line(p1,p2) | Polyline(*pts) | Spline(*pts) | CenterArc(c,r,start,arc)
    RadiusArc(p1,p2,r) | make_face()
Ops: extrude(amount=d) | revolve(axis=Axis.Y) | loft() | sweep()
     fillet(edges,r) | chamfer(edges,l) | offset(amount=-t, openings=f)
Bool: A - B (subtract) | A + B (union) | A & B (intersect)
Place: Pos(x,y,z) * shape | Rot(0,0,45) * shape
Plane: Plane.XY | Plane.XZ | Plane.XY.offset(20)
Select: .sort_by(Axis.Z)[-1] (top) | .group_by(Axis.Z)[-1] (top group)
        .filter_by(GeomType.CIRCLE) (circular)

═══ PITFALLS ═══

1. revolve の断面プロファイルは回転軸の片側のみに配置すること
2. loft に渡すスケッチは上から順番に配置（Plane.XY.offset(z)）
3. fillet/chamfer は BuildPart 内でのみ使用
4. Spline で滑らかな断面を作り、revolve で回転体にする
5. offset(openings=face) でシェル化（中空化）する
6. Builder result: bp.part (NOT bp or part)

═══ PATTERNS ═══

# スケッチの断面から回転体（カップ）を作る:
with BuildPart() as bp:
    with BuildSketch(Plane.XZ):
        with BuildLine():
            Polyline((30, 0), (35, 80), (40, 100))
            Line((40, 100), (0, 100))
            Line((0, 100), (0, 0))
            Line((0, 0), (30, 0))
        make_face()
    revolve(axis=Axis.Z)
    top = bp.faces().sort_by(Axis.Z)[-1]
    offset(amount=-3, openings=top)
result = bp.part

# スケッチから押し出し + フィレットで丸みのある立体:
with BuildPart() as bp:
    with BuildSketch():
        with BuildLine():
            Spline((0, 0), (20, 30), (50, 40), (80, 30), (100, 0))
            Line((100, 0), (0, 0))
        make_face()
    extrude(amount=50)
    fillet(bp.edges().filter_by(Axis.Z), radius=5)
result = bp.part

# 断面のロフト（ボトル状）:
with BuildPart() as bp:
    with BuildSketch(Plane.XY):
        Circle(30)
    with BuildSketch(Plane.XY.offset(60)):
        Circle(15)
    with BuildSketch(Plane.XY.offset(80)):
        Circle(10)
    loft()
result = bp.part
"""

_PROFILES: dict[str, dict] = {
    "general": {
        "name": "汎用",
        "description": "幅広い形状に対応（3D含む）",
        "cheatsheet": _GENERAL_CHEATSHEET,
    },
    "2d": {
        "name": "2D・板材加工",
        "description": "2D切り抜き・板材・ポケット・テキスト彫刻",
        "cheatsheet": _2D_CHEATSHEET,
    },
    "sketch_cutout": {
        "name": "スケッチ → 板材切削",
        "description": "手描きスケッチからCNC切削用の2.5D形状を生成",
        "cheatsheet": _SKETCH_CUTOUT_CHEATSHEET,
    },
    "sketch_3d": {
        "name": "スケッチ → 立体物",
        "description": "手描きスケッチから押し出しや回転体で3D形状を生成",
        "cheatsheet": _SKETCH_3D_CHEATSHEET,
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

    async def refine_code(
        self,
        current_code: str,
        message: str,
        history: list[dict],
        profile: str = "general",
    ) -> str:
        """Refine existing code based on user's modification instruction.

        Uses Qwen coder model directly (no design stage) for low latency.
        Returns modified Python code string.
        """
        coder_model = PIPELINE_MODELS["coder"]
        use_reference = _model_has_large_context(coder_model)
        system = _build_system_prompt(profile, include_reference=use_reference)

        messages = list(history)
        messages.append({
            "role": "user",
            "content": (
                f"現在のコード:\n```python\n{current_code}\n```\n\n"
                f"修正指示: {message}\n\n"
                "修正後のコードのみを出力してください。"
            ),
        })

        full_messages = [{"role": "system", "content": system}] + messages

        response = await self._client.chat.completions.create(
            model=coder_model,
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

    async def _design_with_context(
        self,
        prompt: str,
        profile: str = "general",
    ) -> str:
        """Stage 1: Use Gemini to analyze prompt and extract relevant API/examples."""
        designer_model = PIPELINE_MODELS["designer"]
        reference_content = _build_system_prompt(profile, include_reference=True)

        design_prompt = (
            "以下のユーザー要求を分析し、build123dで実装するための設計を出力してください。\n\n"
            f"ユーザー要求: {prompt}\n\n"
            "出力形式:\n"
            "1. DESIGN: 構造の分解（パーツ数、各サイズ、組み立て方法）\n"
            "2. APPROACH: Builder API か Algebra API か、主要な手法\n"
            "3. RELEVANT_API: この設計に必要なAPIと使い方\n"
            "4. RELEVANT_EXAMPLES: 参考になるコード例\n"
        )

        response = await self._client.chat.completions.create(
            model=designer_model,
            messages=[
                {"role": "system", "content": reference_content},
                {"role": "user", "content": design_prompt},
            ],
        )
        return response.choices[0].message.content or ""

    async def _generate_code(
        self,
        prompt: str,
        design: str,
        profile: str = "general",
    ) -> str:
        """Stage 2: Use Qwen3 Coder to generate build123d code from design."""
        coder_model = PIPELINE_MODELS["coder"]
        system = _build_system_prompt(profile, include_reference=False)

        user_content = (
            f"ユーザー要求: {prompt}\n\n"
            f"設計:\n{design}\n\n"
            "上記の設計に基づいてbuild123dコードを生成してください。"
        )

        response = await self._client.chat.completions.create(
            model=coder_model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_content},
            ],
        )
        raw = response.choices[0].message.content or ""
        return _strip_code_fences(raw)

    async def _self_review(
        self,
        prompt: str,
        code: str,
        profile: str = "general",
    ) -> str:
        """Stage 2.5: Self-review generated code before execution."""
        coder_model = PIPELINE_MODELS["coder"]
        use_reference = _model_has_large_context(coder_model)
        system = _build_system_prompt(profile, include_reference=use_reference)

        review_content = (
            "以下のコードをレビューしてください:\n"
            "- ユーザー要求と一致しているか\n"
            "- build123d APIの使い方は正しいか\n"
            "- バグはないか\n"
            "問題があれば修正版のコードのみを出力。問題なければそのまま出力。\n\n"
            f"ユーザー要求: {prompt}\n\n"
            f"コード:\n```python\n{code}\n```"
        )

        response = await self._client.chat.completions.create(
            model=coder_model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": review_content},
            ],
        )
        raw = response.choices[0].message.content or ""
        return _strip_code_fences(raw)

    async def generate_pipeline(
        self,
        prompt: str,
        *,
        image_base64: str | None = None,
        profile: str = "general",
        coder_model: str | None = None,
        on_stage: Callable[[str], Awaitable[None]] | None = None,
        on_detail: Callable[[str, str], Awaitable[None]] | None = None,
    ) -> tuple[str, list[BrepObject], bytes | None]:
        """Run 2-stage pipeline: Gemini design → Qwen code → review → execute → retry."""

        async def _notify(stage: str):
            if on_stage:
                await on_stage(stage)

        async def _detail(key: str, value: str):
            if on_detail:
                await on_detail(key, value)

        # Stage 1: Design with Gemini
        await _notify("designing")
        design = await self._design_with_context(prompt, profile=profile)
        await _detail("design", design)

        # Stage 2: Generate code with Qwen
        await _notify("coding")
        code = await self._generate_code(prompt, design, profile=profile)
        await _detail("code", code)

        # Stage 2.5: Self-review
        await _notify("reviewing")
        code = await self._self_review(prompt, code, profile=profile)
        await _detail("reviewed_code", code)

        # Execute
        await _notify("executing")
        first_error: CodeExecutionError | None = None
        try:
            objects, step_bytes = execute_build123d_code(code)
            return code, objects, step_bytes
        except CodeExecutionError as e:
            first_error = e
            await _detail("execution_error", str(e))

        # Retry: re-query Gemini with error info, then Qwen
        await _notify("retrying")
        retry_design = await self._design_with_context(
            f"{prompt}\n\n前回のコードでエラーが発生しました:\n{first_error}\n\n"
            f"失敗したコード:\n```python\n{code}\n```\n\n"
            "エラーを修正するために必要なAPIと正しい使い方を提示してください。",
            profile=profile,
        )
        await _detail("retry_design", retry_design)

        retry_code = await self._generate_code(
            f"{prompt}\n\n前回エラー: {first_error}",
            retry_design,
            profile=profile,
        )
        await _detail("retry_code", retry_code)

        await _notify("executing")
        objects, step_bytes = execute_build123d_code(retry_code)
        return retry_code, objects, step_bytes

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

