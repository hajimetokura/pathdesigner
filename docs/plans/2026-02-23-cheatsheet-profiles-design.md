# AI CAD チートシート・プロファイル切り替え設計

> 日付: 2026-02-23
> ステータス: 承認済み

## 背景

AI CAD ノードの `_SYSTEM_PROMPT` に含まれるbuild123dチートシートを、ドメイン特化プロファイルに分割する。
家具、平面加工、3D造形など用途に応じた最適なチートシート＋パターン例をLLMに提供し、コード生成精度を向上させる。

## アーキテクチャ

### システムプロンプト構成

```
system_prompt = _BASE_PROMPT + _PROFILES[profile_id]["cheatsheet"]
```

- **`_BASE_PROMPT`**: 全プロファイル共通のルール（result変数、mm単位、import禁止等）
- **`_PROFILES`**: プロファイルID → {name, description, cheatsheet} の辞書

### プロファイル一覧

| ID | 名前 | 用途 | 主な操作 |
|----|------|------|----------|
| `general` | 汎用 | デフォルト。幅広い形状 | Box, Cylinder, Hole, sketch+extrude |
| `furniture` | 家具・板材 | CNC板材加工、家具パーツ | Box, Hole, GridLocations, Slot, Align.MIN |
| `flat` | 平面加工 | 切り抜き、ポケット、彫刻 | BuildSketch, Text, Polygon, Spline, offset |
| `3d` | 3D造形 | 回転体、ロフト、スイープ等 | revolve, loft, sweep, shell, fillet |

## バックエンド変更

### `llm_client.py`

```python
_BASE_PROMPT = """\
You are a build123d expert generating Python code for CNC-machinable parts.

RULES:
- Assign final shape to variable `result` (Solid, Part, or Compound)
- Units: millimeters (mm)
- `from build123d import *` is pre-loaded — do NOT write import statements
- No print(), file I/O, or side effects
- Use Builder API (BuildPart) as default — handles patterns, fillets, holes cleanly
- Use Algebra API only for trivially simple shapes (single box, one boolean)
- Output ONLY code, no explanations
"""

_PROFILES: dict[str, dict] = {
    "general":   {"name": "汎用",       "description": "幅広い形状に対応", "cheatsheet": _GENERAL_CHEATSHEET},
    "furniture": {"name": "家具・板材",  "description": "板材CNC加工パーツ", "cheatsheet": _FURNITURE_CHEATSHEET},
    "flat":      {"name": "平面加工",    "description": "切り抜き・ポケット・彫刻", "cheatsheet": _FLAT_CHEATSHEET},
    "3d":        {"name": "3D造形",      "description": "回転体・ロフト・スイープ", "cheatsheet": _3D_CHEATSHEET},
}

def _build_system_prompt(profile: str = "general") -> str:
    p = _PROFILES.get(profile)
    if p is None:
        p = _PROFILES["general"]
    return _BASE_PROMPT + p["cheatsheet"]
```

`generate()`, `generate_with_history()`, `generate_and_execute()` に `profile` パラメータ追加。

### `schemas.py`

`AiCadGenerateRequest` に `profile: str = "general"` フィールド追加。

### `main.py`

- `/ai-cad/generate` — `profile` をLLMClientに渡す
- `/ai-cad/profiles` — 新規エンドポイント。プロファイル一覧を返す

```python
@app.get("/ai-cad/profiles")
async def list_profiles():
    return [
        {"id": pid, "name": p["name"], "description": p["description"]}
        for pid, p in _PROFILES.items()
    ]
```

## プロファイル内容

### `general` チートシート

現在の `_SYSTEM_PROMPT` のCHEATSHEET + PITFALLS + PATTERNS 部分をベースに以下を改善:

**追加PITFALLS:**
- BuildLine は必ず閉じたループにする（始点=終点）
- Builder mode の結果取得: `bp.part` / extrude 後は `extrude(sk.sketch, amount=...)`
- `sort_by()[-1]` は1要素、`group_by()[-1]` はリスト（混同注意）

**パターン例（5つ維持）:**
1. 板 + 穴（Algebra）
2. GridLocations穴パターン（Builder）
3. 角丸プレート + 穴（Sketch + extrude）
4. 曲線アウトライン（Spline + extrude）
5. ポケット加工（partial-depth subtract）

### `furniture` チートシート

```
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
  SlotCenterToCenter(separation, width)     # slot by center distance
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
        # Tabs protruding from one edge
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
    # Round all top edges
    fillet(bp.edges().group_by(Axis.Z)[-1], radius=3)
result = bp.part
```

### `flat` チートシート

```
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
```

### `3d` チートシート

```
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
    fillet(bp.edges().filter_by(Axis.Z), radius=10)  # round vertical edges
    top = bp.faces().sort_by(Axis.Z)[-1]
    offset(amount=-3, openings=top)
    fillet(bp.edges().group_by(Axis.Z)[-1], radius=2)  # smooth inner rim
result = bp.part

# Pipe connector (sweep + boolean):
with BuildPart() as bp:
    with BuildLine() as path:
        Spline((0, 0, 0), (30, 0, 20), (60, 0, 20), (90, 0, 0))
    with BuildSketch(path.line ^ 0):
        Circle(8)
    sweep()
    # Hollow out
    with BuildSketch(path.line ^ 0):
        Circle(6)
    sweep(mode=Mode.SUBTRACT)
result = bp.part
```

## テスト方針

- 各プロファイルのパターン例コードが `execute_build123d_code()` で正常実行できることを確認
- `_build_system_prompt(profile)` が正しいプロンプトを返すことをテスト
- `/ai-cad/profiles` エンドポイントのレスポンス確認
- 不正なプロファイルID → `general` にフォールバック

## フロントエンド（Phase 2 で実装）

- AI CAD パネルにプロファイル選択ドロップダウンを追加
- `/ai-cad/profiles` からプロファイル一覧を取得
- generate リクエストに `profile` を含める
