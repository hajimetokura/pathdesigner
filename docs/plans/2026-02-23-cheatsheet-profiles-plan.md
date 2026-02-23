# チートシート・プロファイル切り替え 実装計画

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** AI CAD ノードのシステムプロンプトをドメイン特化プロファイル (general, furniture, flat, 3d) に分割し、API/UIで切り替え可能にする

**Architecture:** `_SYSTEM_PROMPT` を `_BASE_PROMPT` + プロファイル別チートシートに分割。`_PROFILES` 辞書でプロファイルを管理し、`generate()` 等に `profile` パラメータを追加。

**Tech Stack:** Python (FastAPI, Pydantic), build123d

---

### Task 1: `_SYSTEM_PROMPT` を `_BASE_PROMPT` + `_GENERAL_CHEATSHEET` に分割

**Files:**
- Modify: `backend/llm_client.py`
- Test: `backend/tests/test_llm_client.py`

**Step 1: Write the failing test**

`backend/tests/test_llm_client.py` の末尾に追加:

```python
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
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner && uv run python -m pytest backend/tests/test_llm_client.py::test_build_system_prompt_default backend/tests/test_llm_client.py::test_build_system_prompt_unknown_falls_back -v`
Expected: ImportError — `_build_system_prompt` does not exist yet

**Step 3: Refactor `_SYSTEM_PROMPT` into `_BASE_PROMPT` + `_PROFILES`**

In `backend/llm_client.py`, replace the single `_SYSTEM_PROMPT` with:

```python
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

_PROFILES: dict[str, dict] = {
    "general": {
        "name": "汎用",
        "description": "幅広い形状に対応",
        "cheatsheet": _GENERAL_CHEATSHEET,
    },
}


def _build_system_prompt(profile: str = "general") -> str:
    """Build system prompt from base + profile-specific cheatsheet."""
    p = _PROFILES.get(profile)
    if p is None:
        p = _PROFILES["general"]
    return _BASE_PROMPT + p["cheatsheet"]
```

Update all usages of `_SYSTEM_PROMPT` → `_build_system_prompt(...)`:
- `generate()`: `messages = [{"role": "system", "content": _build_system_prompt()}]`
- `generate_with_history()`: same

**Step 4: Run test to verify it passes**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner && uv run python -m pytest backend/tests/test_llm_client.py -v`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add backend/llm_client.py backend/tests/test_llm_client.py
git commit -m "Refactor _SYSTEM_PROMPT into _BASE_PROMPT + _PROFILES with _build_system_prompt()"
```

---

### Task 2: `generate()` 系メソッドに `profile` パラメータ追加

**Files:**
- Modify: `backend/llm_client.py`
- Test: `backend/tests/test_llm_client.py`

**Step 1: Write the failing test**

```python
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
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner && uv run python -m pytest backend/tests/test_llm_client.py::test_generate_uses_profile -v`
Expected: FAIL — `generate()` does not accept `profile` param yet (or doesn't have furniture profile)

**Step 3: Add `profile` param to `generate()`, `generate_with_history()`, `generate_and_execute()`**

In `backend/llm_client.py`:

```python
async def generate(self, prompt, image_base64=None, model=None, profile="general"):
    ...
    messages = [{"role": "system", "content": _build_system_prompt(profile)}]
    ...

async def generate_with_history(self, messages, model=None, profile="general"):
    ...
    full_messages = [{"role": "system", "content": _build_system_prompt(profile)}] + messages
    ...

async def generate_and_execute(self, prompt, *, messages=None, image_base64=None,
                                model=None, max_retries=None, profile="general"):
    ...
    # Pass profile to generate / generate_with_history calls
    if messages:
        code = await self.generate_with_history(messages, model, profile=profile)
    else:
        code = await self.generate(prompt, image_base64, model, profile=profile)
    ...
    # Also pass profile to retry calls
    code = await self.generate_with_history(retry_messages, model, profile=profile)
```

Note: This test also needs the furniture profile to exist (Task 4), but we can add a minimal stub now:

```python
_PROFILES["furniture"] = {
    "name": "家具・板材",
    "description": "板材CNC加工パーツ",
    "cheatsheet": "\n═══ FURNITURE / SHEET MATERIAL PROFILE ═══\n(placeholder)\n",
}
```

**Step 4: Run tests**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner && uv run python -m pytest backend/tests/test_llm_client.py -v`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add backend/llm_client.py backend/tests/test_llm_client.py
git commit -m "Add profile parameter to generate/generate_with_history/generate_and_execute"
```

---

### Task 3: API エンドポイントに `profile` 対応追加

**Files:**
- Modify: `backend/schemas.py`
- Modify: `backend/main.py`
- Test: `backend/tests/test_api_ai_cad.py`

**Step 1: Write the failing tests**

`backend/tests/test_api_ai_cad.py` に追加:

```python
def test_get_profiles():
    """GET /ai-cad/profiles returns profile list."""
    resp = client.get("/ai-cad/profiles")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 1
    ids = [p["id"] for p in data]
    assert "general" in ids
    assert all("name" in p and "description" in p for p in data)
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner && uv run python -m pytest backend/tests/test_api_ai_cad.py::test_get_profiles -v`
Expected: 404 or routing error — endpoint doesn't exist

**Step 3: Implement changes**

In `backend/schemas.py`, add `profile` to `AiCadRequest`:

```python
class AiCadRequest(BaseModel):
    """Request to generate a 3D model from text/image prompt."""
    prompt: str
    image_base64: str | None = None
    model: str | None = None
    profile: str = "general"  # NEW
```

Add profile info schema:

```python
class ProfileInfo(BaseModel):
    """Available prompt profile info."""
    id: str
    name: str
    description: str
```

In `backend/main.py`:

Add import of `ProfileInfo` to the schemas import line.

Add profiles endpoint:

```python
@app.get("/ai-cad/profiles", response_model=list[ProfileInfo])
def get_ai_cad_profiles():
    """Return available prompt profiles."""
    from llm_client import _PROFILES
    return [
        ProfileInfo(id=pid, name=p["name"], description=p["description"])
        for pid, p in _PROFILES.items()
    ]
```

Update `ai_cad_generate` to pass `profile`:

```python
@app.post("/ai-cad/generate", response_model=AiCadResult)
async def ai_cad_generate(req: AiCadRequest):
    ...
    code, objects, step_bytes = await llm.generate_and_execute(
        req.prompt,
        image_base64=req.image_base64,
        model=req.model,
        profile=req.profile,  # NEW
    )
    ...
```

**Step 4: Run tests**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner && uv run python -m pytest backend/tests/test_api_ai_cad.py -v`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add backend/schemas.py backend/main.py backend/tests/test_api_ai_cad.py
git commit -m "Add /ai-cad/profiles endpoint and profile param to generate request"
```

---

### Task 4: furniture プロファイル（家具・板材特化チートシート）

**Files:**
- Modify: `backend/llm_client.py`
- Test: `backend/tests/test_llm_client.py`

**Step 1: Write the failing test**

```python
def test_furniture_profile_has_patterns():
    """Furniture profile includes relevant keywords and patterns."""
    from llm_client import _build_system_prompt
    prompt = _build_system_prompt("furniture")
    assert "FURNITURE" in prompt
    assert "thickness" in prompt
    assert "Hole" in prompt
    assert "Align.MIN" in prompt
    assert "dowel" in prompt.lower() or "ダボ" in prompt
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner && uv run python -m pytest backend/tests/test_llm_client.py::test_furniture_profile_has_patterns -v`
Expected: FAIL — furniture profile is placeholder

**Step 3: Write full furniture cheatsheet**

In `backend/llm_client.py`, replace the furniture placeholder with the full content from the design doc (see design doc section "furniture チートシート"). Key content includes:

- CORE CONCEPT: CNC板材パーツ。厚み一定、上面から加工
- KEY SETUP: thickness variable, Align.MIN
- ESSENTIAL OPERATIONS: Box, Hole, GridLocations, SlotOverall, RectangleRounded
- PITFALLS: 穴深さ=板厚、Align.MIN、ダボ穴径
- PATTERNS: 棚板ダボ穴、タブ&スロット、グリッド穴天板

**Step 4: Run test**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner && uv run python -m pytest backend/tests/test_llm_client.py -v`
Expected: ALL PASS

**Step 5: Verify pattern code executes**

Write a quick execution test:

```python
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
```

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner && uv run python -m pytest backend/tests/test_llm_client.py::test_furniture_pattern_shelf_executes -v`
Expected: PASS

**Step 6: Commit**

```bash
git add backend/llm_client.py backend/tests/test_llm_client.py
git commit -m "Add furniture profile with sheet material patterns and pitfalls"
```

---

### Task 5: flat プロファイル（平面加工・彫刻特化チートシート）

**Files:**
- Modify: `backend/llm_client.py`
- Test: `backend/tests/test_llm_client.py`

**Step 1: Write the failing test**

```python
def test_flat_profile_has_patterns():
    """Flat profile includes text, pocket, and outline keywords."""
    from llm_client import _build_system_prompt
    prompt = _build_system_prompt("flat")
    assert "FLAT" in prompt or "ENGRAVING" in prompt
    assert "Text" in prompt
    assert "make_face" in prompt
    assert "SUBTRACT" in prompt
```

**Step 2: Run test — Expected: FAIL**

**Step 3: Write full flat cheatsheet**

Add `_FLAT_CHEATSHEET` with:
- CORE CONCEPT: 平面切り抜き・ポケット・彫刻
- TEXT OPERATIONS: Text() usage
- SKETCH SHAPES: Rectangle, Polygon, Spline
- LINES: Line, Polyline, Spline, CenterArc + make_face()
- PITFALLS: Text不要make_face, ポケット負値, BuildLine閉ループ
- PATTERNS: テキスト彫刻プレート、複雑アウトライン、PolarLocationsブラケット

**Step 4: Run test — Expected: ALL PASS**

**Step 5: Verify pattern code executes**

```python
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
```

Run and verify PASS.

**Step 6: Commit**

```bash
git add backend/llm_client.py backend/tests/test_llm_client.py
git commit -m "Add flat profile with text engraving and outline patterns"
```

---

### Task 6: 3d プロファイル（3D造形特化チートシート）

**Files:**
- Modify: `backend/llm_client.py`
- Test: `backend/tests/test_llm_client.py`

**Step 1: Write the failing test**

```python
def test_3d_profile_has_patterns():
    """3D profile includes revolve, loft, sweep, shell keywords."""
    from llm_client import _build_system_prompt
    prompt = _build_system_prompt("3d")
    assert "3D" in prompt
    assert "revolve" in prompt
    assert "loft" in prompt
    assert "sweep" in prompt
    assert "offset" in prompt or "shell" in prompt.lower()
```

**Step 2: Run test — Expected: FAIL**

**Step 3: Write full 3d cheatsheet**

Add `_3D_CHEATSHEET` with:
- CORE CONCEPT: 回転体、ロフト、スイープ、シェル
- 3D OPERATIONS: revolve, loft, sweep, offset (shell), fillet, chamfer, split
- PLANES & PATHS: Plane.XZ, offset, path ^ 0
- SELECTORS: group_by, filter_by, sort_by
- PITFALLS: revolve片側、sweep平面、loft断面順序、shell openings
- PATTERNS: 花瓶(revolve+shell)、トレイ(Box+shell)、パイプ(sweep+boolean)

**Step 4: Run test — Expected: ALL PASS**

**Step 5: Verify pattern code executes**

```python
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
```

Run and verify PASS.

**Step 6: Commit**

```bash
git add backend/llm_client.py backend/tests/test_llm_client.py
git commit -m "Add 3d profile with revolve, loft, sweep, shell patterns"
```

---

### Task 7: `list_profiles()` メソッドを LLMClient に追加

**Files:**
- Modify: `backend/llm_client.py`
- Modify: `backend/main.py` (use LLMClient method instead of direct _PROFILES access)
- Test: `backend/tests/test_llm_client.py`

**Step 1: Write the failing test**

```python
def test_list_profiles():
    """list_profiles() returns all available profiles."""
    client = LLMClient(api_key="test-key")
    profiles = client.list_profiles_info()
    assert len(profiles) == 4
    ids = [p["id"] for p in profiles]
    assert "general" in ids
    assert "furniture" in ids
    assert "flat" in ids
    assert "3d" in ids
    assert all("name" in p and "description" in p for p in profiles)
```

**Step 2: Run test — Expected: FAIL**

**Step 3: Implement `list_profiles_info()` method**

```python
def list_profiles_info(self) -> list[dict]:
    """Return available prompt profiles with metadata."""
    return [
        {"id": pid, "name": p["name"], "description": p["description"]}
        for pid, p in _PROFILES.items()
    ]
```

Update `main.py` to use this instead of direct `_PROFILES` access:

```python
@app.get("/ai-cad/profiles", response_model=list[ProfileInfo])
def get_ai_cad_profiles():
    return _get_llm().list_profiles_info()
```

(Note: Return type needs to match — either return dicts and let FastAPI serialize, or convert to ProfileInfo.)

**Step 4: Run tests**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner && uv run python -m pytest backend/tests/ -v`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add backend/llm_client.py backend/main.py backend/tests/test_llm_client.py
git commit -m "Add list_profiles_info() to LLMClient and wire up /ai-cad/profiles"
```

---

### Task 8: 全テスト実行 + `build123d_cheatsheet.md` 更新

**Files:**
- Modify: `build123d_cheatsheet.md` (optional: sync with new profiles)

**Step 1: Run full test suite**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner && uv run python -m pytest backend/tests/ -v`
Expected: ALL PASS (既存テストが壊れていないこと)

**Step 2: Verify existing tests still pass correctly**

特に確認:
- `test_generate_calls_openai_client` — システムプロンプト参照が壊れていないか
- `test_generate_and_execute_*` — リトライロジックがprofile対応で壊れていないか
- `test_api_ai_cad.py` の全テスト

**Step 3: Update `build123d_cheatsheet.md`**

`build123d_cheatsheet.md` のセクション13（ベストプラクティス）の末尾に、プロファイル情報を追記:

```markdown
## 14. AI CAD プロファイル

システムプロンプトは用途別プロファイルに分かれている:
- `general` — 汎用
- `furniture` — 家具・板材 (CNC板加工)
- `flat` — 平面加工・彫刻
- `3d` — 3D造形 (revolve, loft, sweep)

詳細は `backend/llm_client.py` の `_PROFILES` を参照。
```

**Step 4: Final commit**

```bash
git add build123d_cheatsheet.md
git commit -m "Update cheatsheet doc with profile system reference"
```
