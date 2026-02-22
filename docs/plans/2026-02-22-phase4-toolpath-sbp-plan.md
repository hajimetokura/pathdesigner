# Phase 4: パス生成 + SBP出力 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 輪郭座標 + 加工設定からツールパス（多段Zステップダウン + タブ）を生成し、EMARF CAM 準拠の SBP ファイルを出力する。

**Architecture:** 分離型 — `POST /api/generate-toolpath` でパス座標を計算し、`POST /api/generate-sbp` で SBP コード文字列を生成する。フロントエンドでは PostProcessorNode と ToolpathGenNode の2つの React Flow カスタムノードを追加。

**Tech Stack:** FastAPI, Pydantic, shapely (周長計算), React Flow, TypeScript

---

### Task 1: Pydantic スキーマ追加

**Files:**
- Modify: `backend/schemas.py:124` (末尾に追加)

**Step 1: Write the failing test**

Create: `backend/tests/test_toolpath_schemas.py`

```python
"""Tests for Phase 4 Pydantic schemas."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from schemas import (
    TabSegment,
    ToolpathPass,
    Toolpath,
    ToolpathGenRequest,
    ToolpathGenResult,
    SpindleWarmup,
    MaterialSettings,
    PostProcessorSettings,
    SbpGenRequest,
    SbpGenResult,
    ContourExtractResult,
    MachiningSettings,
    Contour,
    OffsetApplied,
    Tool,
    FeedRate,
    TabSettings,
)


def test_toolpath_pass_serialization():
    """ToolpathPass should serialize pass data with tabs."""
    tp = ToolpathPass(
        pass_number=1,
        z_depth=12.0,
        path=[[0.0, 0.0], [100.0, 0.0], [100.0, 50.0], [0.0, 50.0], [0.0, 0.0]],
        tabs=[],
    )
    d = tp.model_dump()
    assert d["pass_number"] == 1
    assert d["z_depth"] == 12.0
    assert len(d["path"]) == 5


def test_toolpath_pass_with_tabs():
    """ToolpathPass with tabs should include tab segments."""
    tp = ToolpathPass(
        pass_number=3,
        z_depth=-0.3,
        path=[[0.0, 0.0], [100.0, 0.0], [100.0, 50.0], [0.0, 50.0], [0.0, 0.0]],
        tabs=[TabSegment(start_index=1, end_index=2, z_tab=10.0)],
    )
    assert len(tp.tabs) == 1
    assert tp.tabs[0].z_tab == 10.0


def test_toolpath_gen_result():
    """ToolpathGenResult should wrap toolpaths."""
    result = ToolpathGenResult(
        toolpaths=[
            Toolpath(
                operation_id="op_001",
                passes=[
                    ToolpathPass(
                        pass_number=1,
                        z_depth=12.0,
                        path=[[0.0, 0.0], [100.0, 0.0]],
                        tabs=[],
                    )
                ],
            )
        ]
    )
    assert len(result.toolpaths) == 1
    assert result.toolpaths[0].operation_id == "op_001"


def test_post_processor_settings_defaults():
    """PostProcessorSettings should have sensible defaults."""
    pp = PostProcessorSettings()
    assert pp.machine == "shopbot"
    assert pp.safe_z == 38.0
    assert pp.unit == "mm"
    assert pp.tool_number == 3
    assert pp.spindle_warmup.initial_rpm == 5000
    assert pp.material.thickness == 18


def test_sbp_gen_result():
    """SbpGenResult should contain code and filename."""
    r = SbpGenResult(sbp_code="SA\nEND", filename="part.sbp")
    assert "SA" in r.sbp_code
    assert r.filename.endswith(".sbp")
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run pytest tests/test_toolpath_schemas.py -v`
Expected: FAIL with `ImportError: cannot import name 'TabSegment'`

**Step 3: Write minimal implementation**

Add to end of `backend/schemas.py`:

```python
# --- Node 5: Post Processor Settings ---


class SpindleWarmup(BaseModel):
    initial_rpm: int = 5000
    wait_seconds: int = 2


class MaterialSettings(BaseModel):
    width: float = 600
    depth: float = 400
    thickness: float = 18
    x_offset: float = 0
    y_offset: float = 0


class PostProcessorSettings(BaseModel):
    machine: str = "shopbot"
    output_format: str = "sbp"
    unit: str = "mm"
    safe_z: float = 38.0
    home_position: list[float] = [0.0, 0.0]
    tool_number: int = 3
    spindle_warmup: SpindleWarmup = SpindleWarmup()
    material: MaterialSettings = MaterialSettings()


# --- Node 6: Toolpath Generation ---


class TabSegment(BaseModel):
    start_index: int  # index in path coords where tab starts
    end_index: int  # index where tab ends
    z_tab: float  # Z height at tab top


class ToolpathPass(BaseModel):
    pass_number: int  # 1-based
    z_depth: float  # Z coordinate for this pass
    path: list[list[float]]  # [[x, y], ...]
    tabs: list[TabSegment]  # tabs (only on final pass)


class Toolpath(BaseModel):
    operation_id: str
    passes: list[ToolpathPass]


class ToolpathGenRequest(BaseModel):
    contour_result: ContourExtractResult
    machining_settings: MachiningSettings


class ToolpathGenResult(BaseModel):
    toolpaths: list[Toolpath]


class SbpGenRequest(BaseModel):
    toolpath_result: ToolpathGenResult
    machining_settings: MachiningSettings
    post_processor: PostProcessorSettings


class SbpGenResult(BaseModel):
    sbp_code: str
    filename: str
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run pytest tests/test_toolpath_schemas.py -v`
Expected: All 5 tests PASS

**Step 5: Commit**

```bash
git add backend/schemas.py backend/tests/test_toolpath_schemas.py
git commit -m "Phase 4: Add Pydantic schemas for toolpath gen and post processor (#4)"
```

---

### Task 2: ツールパス計算ロジック (`toolpath_gen.py`)

**Files:**
- Create: `backend/nodes/toolpath_gen.py`
- Test: `backend/tests/test_toolpath_gen.py`

**Step 1: Write the failing test**

Create: `backend/tests/test_toolpath_gen.py`

```python
"""Tests for toolpath generation logic."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from nodes.toolpath_gen import generate_toolpath
from schemas import (
    ContourExtractResult,
    Contour,
    OffsetApplied,
    MachiningSettings,
    Tool,
    FeedRate,
    TabSettings,
    ToolpathGenResult,
)

# --- Fixtures ---

SQUARE_CONTOUR = ContourExtractResult(
    object_id="obj_001",
    slice_z=0.0,
    contours=[
        Contour(
            id="contour_001",
            type="exterior",
            coords=[
                [0.0, 0.0],
                [100.0, 0.0],
                [100.0, 50.0],
                [0.0, 50.0],
                [0.0, 0.0],
            ],
            closed=True,
        )
    ],
    offset_applied=OffsetApplied(distance=3.175, side="outside"),
)

SETTINGS_NO_TABS = MachiningSettings(
    operation_type="contour",
    tool=Tool(diameter=6.35, type="endmill", flutes=2),
    feed_rate=FeedRate(xy=75.0, z=25.0),
    jog_speed=200.0,
    spindle_speed=18000,
    depth_per_pass=6.0,
    total_depth=18.0,
    direction="climb",
    offset_side="outside",
    tabs=TabSettings(enabled=False, height=3.0, width=5.0, count=4),
)

SETTINGS_WITH_TABS = MachiningSettings(
    operation_type="contour",
    tool=Tool(diameter=6.35, type="endmill", flutes=2),
    feed_rate=FeedRate(xy=75.0, z=25.0),
    jog_speed=200.0,
    spindle_speed=18000,
    depth_per_pass=6.0,
    total_depth=18.0,
    direction="climb",
    offset_side="outside",
    tabs=TabSettings(enabled=True, height=8.0, width=5.0, count=4),
)


def test_generate_toolpath_basic():
    """Should generate correct number of passes for 18mm depth at 6mm/pass."""
    result = generate_toolpath(SQUARE_CONTOUR, SETTINGS_NO_TABS)
    assert isinstance(result, ToolpathGenResult)
    assert len(result.toolpaths) == 1

    tp = result.toolpaths[0]
    assert tp.operation_id == "obj_001"
    # 18mm / 6mm = 3 passes
    assert len(tp.passes) == 3


def test_z_depths_step_down():
    """Z depths should step down from surface to penetration."""
    result = generate_toolpath(SQUARE_CONTOUR, SETTINGS_NO_TABS)
    passes = result.toolpaths[0].passes
    z_values = [p.z_depth for p in passes]

    # Each pass should be deeper than the previous
    for i in range(1, len(z_values)):
        assert z_values[i] < z_values[i - 1], f"Pass {i+1} not deeper: {z_values}"

    # Final pass should be negative (penetration)
    assert z_values[-1] < 0


def test_pass_paths_match_contour():
    """Each pass should follow the contour coordinates."""
    result = generate_toolpath(SQUARE_CONTOUR, SETTINGS_NO_TABS)
    for p in result.toolpaths[0].passes:
        assert len(p.path) == len(SQUARE_CONTOUR.contours[0].coords)


def test_no_tabs_on_non_final_passes():
    """Tabs should only appear on the final pass."""
    result = generate_toolpath(SQUARE_CONTOUR, SETTINGS_WITH_TABS)
    passes = result.toolpaths[0].passes
    for p in passes[:-1]:
        assert len(p.tabs) == 0, f"Pass {p.pass_number} should have no tabs"


def test_tabs_on_final_pass():
    """Final pass should have tabs when enabled."""
    result = generate_toolpath(SQUARE_CONTOUR, SETTINGS_WITH_TABS)
    final_pass = result.toolpaths[0].passes[-1]
    assert len(final_pass.tabs) == 4  # count=4


def test_tab_z_height():
    """Tab z_tab should be above final cutting depth."""
    result = generate_toolpath(SQUARE_CONTOUR, SETTINGS_WITH_TABS)
    final_pass = result.toolpaths[0].passes[-1]
    for tab in final_pass.tabs:
        assert tab.z_tab > final_pass.z_depth


def test_tabs_disabled():
    """When tabs disabled, no tabs on any pass."""
    result = generate_toolpath(SQUARE_CONTOUR, SETTINGS_NO_TABS)
    for p in result.toolpaths[0].passes:
        assert len(p.tabs) == 0


def test_uneven_depth_division():
    """When total_depth not evenly divisible, last pass goes to penetration."""
    settings = SETTINGS_NO_TABS.model_copy(
        update={"depth_per_pass": 7.0, "total_depth": 18.0}
    )
    result = generate_toolpath(SQUARE_CONTOUR, settings)
    passes = result.toolpaths[0].passes
    # ceil(18/7) = 3 passes
    assert len(passes) == 3
    assert passes[-1].z_depth < 0  # penetration
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run pytest tests/test_toolpath_gen.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'nodes.toolpath_gen'`

**Step 3: Write minimal implementation**

Create: `backend/nodes/toolpath_gen.py`

```python
"""Toolpath generation: contour coords + machining settings → multi-pass Z step-down."""

import math

from schemas import (
    ContourExtractResult,
    MachiningSettings,
    TabSegment,
    Toolpath,
    ToolpathGenResult,
    ToolpathPass,
)

# Penetration below material bottom (mm)
PENETRATION_MARGIN = 0.3


def generate_toolpath(
    contour_result: ContourExtractResult,
    settings: MachiningSettings,
) -> ToolpathGenResult:
    """Generate multi-pass toolpaths from contour + settings."""
    toolpaths = []

    for contour in contour_result.contours:
        if contour.type != "exterior":
            continue

        passes = _compute_passes(
            coords=contour.coords,
            depth_per_pass=settings.depth_per_pass,
            total_depth=settings.total_depth,
            tabs_settings=settings.tabs,
        )

        toolpaths.append(
            Toolpath(
                operation_id=contour_result.object_id,
                passes=passes,
            )
        )

    return ToolpathGenResult(toolpaths=toolpaths)


def _compute_passes(
    coords: list[list[float]],
    depth_per_pass: float,
    total_depth: float,
    tabs_settings,
) -> list[ToolpathPass]:
    """Compute Z step-down passes with optional tabs on final pass."""
    num_passes = math.ceil(total_depth / depth_per_pass)
    passes: list[ToolpathPass] = []

    for i in range(num_passes):
        pass_number = i + 1
        is_final = pass_number == num_passes

        if is_final:
            z_depth = -PENETRATION_MARGIN
        else:
            z_depth = total_depth - (pass_number * depth_per_pass)

        tabs: list[TabSegment] = []
        if is_final and tabs_settings.enabled:
            tabs = _compute_tabs(coords, tabs_settings, z_depth)

        passes.append(
            ToolpathPass(
                pass_number=pass_number,
                z_depth=z_depth,
                path=coords,
                tabs=tabs,
            )
        )

    return passes


def _compute_tabs(
    coords: list[list[float]],
    tabs_settings,
    z_depth: float,
) -> list[TabSegment]:
    """Place tabs at equal intervals along the contour perimeter."""
    n_points = len(coords)
    if n_points < 2 or tabs_settings.count <= 0:
        return []

    # Compute cumulative distances along the path
    distances = [0.0]
    for i in range(1, n_points):
        dx = coords[i][0] - coords[i - 1][0]
        dy = coords[i][1] - coords[i - 1][1]
        distances.append(distances[-1] + math.hypot(dx, dy))

    total_length = distances[-1]
    if total_length <= 0:
        return []

    tab_spacing = total_length / tabs_settings.count
    tab_half_width = tabs_settings.width / 2.0
    z_tab = total_depth_to_tab_z(tabs_settings.height, z_depth)

    tabs: list[TabSegment] = []
    for t in range(tabs_settings.count):
        center_dist = tab_spacing * (t + 0.5)
        start_dist = center_dist - tab_half_width
        end_dist = center_dist + tab_half_width

        start_idx = _distance_to_index(distances, max(0.0, start_dist))
        end_idx = _distance_to_index(distances, min(total_length, end_dist))

        if end_idx <= start_idx:
            end_idx = min(start_idx + 1, n_points - 1)

        tabs.append(TabSegment(start_index=start_idx, end_index=end_idx, z_tab=z_tab))

    return tabs


def total_depth_to_tab_z(tab_height: float, z_depth: float) -> float:
    """Calculate tab top Z position. Tab rises from cutting depth."""
    return z_depth + tab_height


def _distance_to_index(distances: list[float], target: float) -> int:
    """Find the path index closest to the target cumulative distance."""
    for i, d in enumerate(distances):
        if d >= target:
            return i
    return len(distances) - 1
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run pytest tests/test_toolpath_gen.py -v`
Expected: All 8 tests PASS

**Step 5: Commit**

```bash
git add backend/nodes/toolpath_gen.py backend/tests/test_toolpath_gen.py
git commit -m "Phase 4: Add toolpath generation with Z step-down and tab placement (#4)"
```

---

### Task 3: SBP コード生成 (`sbp_writer.py`)

**Files:**
- Create: `backend/sbp_writer.py`
- Test: `backend/tests/test_sbp_writer.py`

**Step 1: Write the failing test**

Create: `backend/tests/test_sbp_writer.py`

```python
"""Tests for SBP code generation."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sbp_writer import SbpWriter
from schemas import (
    PostProcessorSettings,
    MachiningSettings,
    Tool,
    FeedRate,
    TabSettings,
    Toolpath,
    ToolpathPass,
    TabSegment,
)

PP_SETTINGS = PostProcessorSettings()  # all defaults

MACHINING = MachiningSettings(
    operation_type="contour",
    tool=Tool(diameter=6.35, type="endmill", flutes=2),
    feed_rate=FeedRate(xy=75.0, z=25.0),
    jog_speed=200.0,
    spindle_speed=18000,
    depth_per_pass=6.0,
    total_depth=18.0,
    direction="climb",
    offset_side="outside",
    tabs=TabSettings(enabled=False, height=3.0, width=5.0, count=4),
)

SIMPLE_TOOLPATH = Toolpath(
    operation_id="op_001",
    passes=[
        ToolpathPass(
            pass_number=1,
            z_depth=12.0,
            path=[[10.0, 20.0], [100.0, 20.0], [100.0, 50.0], [10.0, 50.0], [10.0, 20.0]],
            tabs=[],
        ),
        ToolpathPass(
            pass_number=2,
            z_depth=6.0,
            path=[[10.0, 20.0], [100.0, 20.0], [100.0, 50.0], [10.0, 50.0], [10.0, 20.0]],
            tabs=[],
        ),
        ToolpathPass(
            pass_number=3,
            z_depth=-0.3,
            path=[[10.0, 20.0], [100.0, 20.0], [100.0, 50.0], [10.0, 50.0], [10.0, 20.0]],
            tabs=[],
        ),
    ],
)


def test_sbp_header():
    """SBP output should start with header comments and unit check."""
    writer = SbpWriter(PP_SETTINGS, MACHINING)
    code = writer.generate([SIMPLE_TOOLPATH])
    lines = code.split("\n")

    assert any("SHOPBOT ROUTER FILE IN MM" in l for l in lines)
    assert any("PathDesigner" in l for l in lines)
    assert any("IF %(25)=0 THEN GOTO UNIT_ERROR" in l for l in lines)
    assert "SA" in lines


def test_sbp_tool_spindle():
    """SBP should include tool and spindle commands."""
    writer = SbpWriter(PP_SETTINGS, MACHINING)
    code = writer.generate([SIMPLE_TOOLPATH])

    assert "&Tool = 3" in code
    assert "C9" in code
    assert "TR,5000" in code  # warmup RPM
    assert "C6" in code
    assert "PAUSE 2" in code


def test_sbp_speed_settings():
    """SBP should set MS and JS speeds."""
    writer = SbpWriter(PP_SETTINGS, MACHINING)
    code = writer.generate([SIMPLE_TOOLPATH])

    assert "MS,75.0,25.0" in code
    assert "JS,200.0" in code


def test_sbp_material_metadata():
    """SBP should include material info as comments."""
    writer = SbpWriter(PP_SETTINGS, MACHINING)
    code = writer.generate([SIMPLE_TOOLPATH])

    assert "'MATERIAL_THICKNESS:18" in code
    assert "'MILL_SIZE:6.35" in code


def test_sbp_uses_j_for_jog_and_m_for_cut():
    """Non-cutting moves use J2/J3, cutting moves use M3."""
    writer = SbpWriter(PP_SETTINGS, MACHINING)
    code = writer.generate([SIMPLE_TOOLPATH])

    # Initial positioning should use J2
    assert "J2," in code
    # Cutting should use M3
    assert "M3," in code
    # Safety Z retract should use JZ
    assert "JZ," in code


def test_sbp_footer():
    """SBP should end with spindle off, END, and unit error label."""
    writer = SbpWriter(PP_SETTINGS, MACHINING)
    code = writer.generate([SIMPLE_TOOLPATH])
    lines = code.strip().split("\n")

    # Should contain C7 (spindle off) and END
    assert any("C7" in l for l in lines)
    assert any(l.strip() == "END" for l in lines)
    assert any("UNIT_ERROR:" in l for l in lines)


def test_sbp_multi_pass_z_sequence():
    """Cutting moves should step down through each pass depth."""
    writer = SbpWriter(PP_SETTINGS, MACHINING)
    code = writer.generate([SIMPLE_TOOLPATH])

    # All three Z depths should appear in M3 commands
    assert "M3,10.0,20.0,12.0" in code
    assert "M3,10.0,20.0,6.0" in code
    assert "M3,10.0,20.0,-0.3" in code


def test_sbp_with_tabs():
    """Tab segments should lift Z during final pass."""
    tp_with_tabs = Toolpath(
        operation_id="op_001",
        passes=[
            ToolpathPass(
                pass_number=1,
                z_depth=-0.3,
                path=[[0.0, 0.0], [50.0, 0.0], [100.0, 0.0], [100.0, 50.0], [0.0, 0.0]],
                tabs=[TabSegment(start_index=1, end_index=2, z_tab=10.0)],
            ),
        ],
    )
    writer = SbpWriter(PP_SETTINGS, MACHINING)
    code = writer.generate([tp_with_tabs])

    # The tab section should have z_tab=10.0 instead of -0.3
    assert "M3,50.0,0.0,10.0" in code
    assert "M3,100.0,0.0,10.0" in code
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run pytest tests/test_sbp_writer.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'sbp_writer'`

**Step 3: Write minimal implementation**

Create: `backend/sbp_writer.py`

```python
"""SBP (ShopBot) code generator — EMARF CAM compatible format."""

from schemas import (
    MachiningSettings,
    PostProcessorSettings,
    Toolpath,
    ToolpathPass,
)


class SbpWriter:
    """Generates OpenSBP code from toolpath data."""

    def __init__(
        self,
        settings: PostProcessorSettings,
        machining: MachiningSettings,
    ):
        self.s = settings
        self.m = machining

    def generate(self, toolpaths: list[Toolpath]) -> str:
        """Generate complete SBP file content."""
        lines: list[str] = []
        lines += self._header()
        lines += self._tool_spindle()
        lines += self._material_metadata()
        lines += self._speed_settings()
        lines += self._initial_position()
        for tp in toolpaths:
            lines += self._cutting_passes(tp)
        lines += self._footer()
        return "\n".join(lines)

    def _header(self) -> list[str]:
        return [
            "'SHOPBOT ROUTER FILE IN MM",
            "'GENERATED BY PathDesigner",
            "IF %(25)=0 THEN GOTO UNIT_ERROR",
            "SA",
            "CN,90",
            "",
        ]

    def _tool_spindle(self) -> list[str]:
        sw = self.s.spindle_warmup
        return [
            f"&Tool = {self.s.tool_number}",
            "C9",
            f"TR,{sw.initial_rpm}",
            "C6",
            f"PAUSE {sw.wait_seconds}",
            "",
        ]

    def _material_metadata(self) -> list[str]:
        mat = self.s.material
        return [
            f"'MATERIAL_WIDTH:{mat.width:g}",
            f"'MATERIAL_DEPTH:{mat.depth:g}",
            f"'MATERIAL_THICKNESS:{mat.thickness:g}",
            f"'MILL_SIZE:{self.m.tool.diameter:g}",
            "",
        ]

    def _speed_settings(self) -> list[str]:
        return [
            f"MS,{self.m.feed_rate.xy},{self.m.feed_rate.z}",
            f"JS,{self.m.jog_speed}",
            "",
        ]

    def _initial_position(self) -> list[str]:
        home = self.s.home_position
        return [
            f"JZ,{self.s.safe_z}",
            f"J2,{home[0]},{home[1]}",
            "",
        ]

    def _cutting_passes(self, toolpath: Toolpath) -> list[str]:
        """Generate cutting commands for all passes in a toolpath."""
        lines: list[str] = []
        passes = toolpath.passes
        if not passes:
            return lines

        first_path = passes[0].path
        if not first_path:
            return lines

        start_x, start_y = first_path[0]

        # Jog to start position
        lines.append(f"J2,{start_x},{start_y}")

        for p in passes:
            lines += self._single_pass(p)

        # Retract after all passes
        lines.append(f"JZ,{self.s.safe_z}")
        lines.append("")

        return lines

    def _single_pass(self, tp_pass: ToolpathPass) -> list[str]:
        """Generate M3 commands for a single cutting pass.

        The descent to cutting depth is a separate function to allow
        future replacement with ramp-in entry.
        """
        lines: list[str] = []
        path = tp_pass.path
        if not path:
            return lines

        # Descend to pass depth at start point (plunge — future: ramp-in)
        lines += self._descend(path[0], tp_pass.z_depth)

        # Build set of indices that are within tab regions
        tab_indices: set[int] = set()
        for tab in tp_pass.tabs:
            for idx in range(tab.start_index, tab.end_index + 1):
                tab_indices.add(idx)

        # Index-to-tab-z lookup
        tab_z_map: dict[int, float] = {}
        for tab in tp_pass.tabs:
            for idx in range(tab.start_index, tab.end_index + 1):
                tab_z_map[idx] = tab.z_tab

        # Cut along the contour (skip first point — already there from descend)
        for i in range(1, len(path)):
            x, y = path[i]
            z = tab_z_map.get(i, tp_pass.z_depth)
            lines.append(f"M3,{x},{y},{z}")

        return lines

    def _descend(self, point: list[float], z_depth: float) -> list[str]:
        """Descend to cutting depth at the given point.

        Currently a simple plunge. Override or replace this method
        to implement ramp-in entry in the future.
        """
        x, y = point
        return [f"M3,{x},{y},{z_depth}"]

    def _footer(self) -> list[str]:
        home = self.s.home_position
        return [
            f"JZ,{self.s.safe_z}",
            f"J2,{home[0]},{home[1]}",
            "C7",
            "END",
            "",
            "UNIT_ERROR:",
            "CN, 91",
            "END",
        ]
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run pytest tests/test_sbp_writer.py -v`
Expected: All 8 tests PASS

**Step 5: Commit**

```bash
git add backend/sbp_writer.py backend/tests/test_sbp_writer.py
git commit -m "Phase 4: Add SBP code generator with EMARF CAM format (#4)"
```

---

### Task 4: API エンドポイント追加

**Files:**
- Modify: `backend/main.py`
- Test: `backend/tests/test_api_toolpath.py`

**Step 1: Write the failing test**

Create: `backend/tests/test_api_toolpath.py`

```python
"""Tests for toolpath generation and SBP generation API endpoints."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

CONTOUR_RESULT = {
    "object_id": "obj_001",
    "slice_z": 0.0,
    "contours": [
        {
            "id": "contour_001",
            "type": "exterior",
            "coords": [[0, 0], [100, 0], [100, 50], [0, 50], [0, 0]],
            "closed": True,
        }
    ],
    "offset_applied": {"distance": 3.175, "side": "outside"},
}

MACHINING_SETTINGS = {
    "operation_type": "contour",
    "tool": {"diameter": 6.35, "type": "endmill", "flutes": 2},
    "feed_rate": {"xy": 75.0, "z": 25.0},
    "jog_speed": 200.0,
    "spindle_speed": 18000,
    "depth_per_pass": 6.0,
    "total_depth": 18.0,
    "direction": "climb",
    "offset_side": "outside",
    "tabs": {"enabled": True, "height": 8.0, "width": 5.0, "count": 4},
}


def test_generate_toolpath_endpoint():
    """POST /api/generate-toolpath should return toolpaths."""
    resp = client.post(
        "/api/generate-toolpath",
        json={
            "contour_result": CONTOUR_RESULT,
            "machining_settings": MACHINING_SETTINGS,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "toolpaths" in data
    assert len(data["toolpaths"]) == 1
    assert len(data["toolpaths"][0]["passes"]) == 3


def test_generate_sbp_endpoint():
    """POST /api/generate-sbp should return SBP code."""
    # First generate toolpaths
    tp_resp = client.post(
        "/api/generate-toolpath",
        json={
            "contour_result": CONTOUR_RESULT,
            "machining_settings": MACHINING_SETTINGS,
        },
    )
    toolpath_result = tp_resp.json()

    # Then generate SBP
    resp = client.post(
        "/api/generate-sbp",
        json={
            "toolpath_result": toolpath_result,
            "machining_settings": MACHINING_SETTINGS,
            "post_processor": {},  # use defaults
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "sbp_code" in data
    assert "filename" in data
    assert "SHOPBOT ROUTER FILE" in data["sbp_code"]
    assert data["filename"].endswith(".sbp")
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run pytest tests/test_api_toolpath.py -v`
Expected: FAIL with `404` or `405` (route not found)

**Step 3: Write minimal implementation**

Add to `backend/main.py` — add imports at top and endpoints at bottom:

Imports to add (merge with existing import block):
```python
from nodes.toolpath_gen import generate_toolpath
from sbp_writer import SbpWriter
from schemas import (
    # ... existing imports ...
    ToolpathGenRequest, ToolpathGenResult,
    SbpGenRequest, SbpGenResult,
    PostProcessorSettings,
)
```

Endpoints to add at end of file:
```python
@app.post("/api/generate-toolpath", response_model=ToolpathGenResult)
def generate_toolpath_endpoint(req: ToolpathGenRequest):
    """Generate toolpath passes from contours + machining settings."""
    try:
        result = generate_toolpath(req.contour_result, req.machining_settings)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Toolpath generation failed: {e}")
    return result


@app.post("/api/generate-sbp", response_model=SbpGenResult)
def generate_sbp_endpoint(req: SbpGenRequest):
    """Generate SBP code from toolpath data + post processor settings."""
    try:
        writer = SbpWriter(req.post_processor, req.machining_settings)
        sbp_code = writer.generate(req.toolpath_result.toolpaths)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SBP generation failed: {e}")
    return SbpGenResult(sbp_code=sbp_code, filename="output.sbp")
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run pytest tests/test_api_toolpath.py -v`
Expected: Both tests PASS

**Step 5: Run all tests**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run pytest tests/ -v`
Expected: All tests PASS (existing + new)

**Step 6: Commit**

```bash
git add backend/main.py backend/tests/test_api_toolpath.py
git commit -m "Phase 4: Add generate-toolpath and generate-sbp API endpoints (#4)"
```

---

### Task 5: フロントエンド型定義 + API 関数

**Files:**
- Modify: `frontend/src/types.ts:105` (末尾に追加)
- Modify: `frontend/src/api.ts:69` (末尾に追加)

**Step 1: Add TypeScript types**

Add to end of `frontend/src/types.ts`:

```typescript
/** Node 5: Post Processor Settings types */

export interface SpindleWarmup {
  initial_rpm: number;
  wait_seconds: number;
}

export interface MaterialSettings {
  width: number;
  depth: number;
  thickness: number;
  x_offset: number;
  y_offset: number;
}

export interface PostProcessorSettings {
  machine: string;
  output_format: string;
  unit: string;
  safe_z: number;
  home_position: [number, number];
  tool_number: number;
  spindle_warmup: SpindleWarmup;
  material: MaterialSettings;
}

/** Node 6: Toolpath Generation types */

export interface TabSegment {
  start_index: number;
  end_index: number;
  z_tab: number;
}

export interface ToolpathPass {
  pass_number: number;
  z_depth: number;
  path: [number, number][];
  tabs: TabSegment[];
}

export interface ToolpathResult {
  operation_id: string;
  passes: ToolpathPass[];
}

export interface ToolpathGenResult {
  toolpaths: ToolpathResult[];
}

export interface SbpGenResult {
  sbp_code: string;
  filename: string;
}
```

**Step 2: Add API functions**

Add to end of `frontend/src/api.ts`:

```typescript
import type { ..., PostProcessorSettings, ToolpathGenResult, SbpGenResult } from "./types";

export async function generateToolpath(
  contourResult: ContourExtractResult,
  machiningSettings: MachiningSettings
): Promise<ToolpathGenResult> {
  const res = await fetch(`${API_URL}/api/generate-toolpath`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contour_result: contourResult,
      machining_settings: machiningSettings,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Toolpath generation failed" }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function generateSbp(
  toolpathResult: ToolpathGenResult,
  machiningSettings: MachiningSettings,
  postProcessor: PostProcessorSettings
): Promise<SbpGenResult> {
  const res = await fetch(`${API_URL}/api/generate-sbp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      toolpath_result: toolpathResult,
      machining_settings: machiningSettings,
      post_processor: postProcessor,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "SBP generation failed" }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}
```

**Step 3: Verify frontend compiles**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/frontend && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add frontend/src/types.ts frontend/src/api.ts
git commit -m "Phase 4: Add frontend types and API for toolpath and SBP generation (#4)"
```

---

### Task 6: PostProcessorNode コンポーネント

**Files:**
- Create: `frontend/src/nodes/PostProcessorNode.tsx`

**Step 1: Create PostProcessorNode**

Create: `frontend/src/nodes/PostProcessorNode.tsx`

Follow the pattern from `MachiningSettingsNode.tsx`:
- Form fields for: safe_z, home_position (x, y), tool_number, material (width, depth, thickness), spindle_warmup (initial_rpm, wait_seconds)
- Sync to `node.data.postProcessorSettings` via `setNodes` useEffect
- Source handle at bottom: `{id}-out`, dataType `settings`
- Collapsible sections for Material and Machine settings
- Use the same style constants as MachiningSettingsNode

```tsx
import { useEffect, useState } from "react";
import { Position, type NodeProps, useReactFlow } from "@xyflow/react";
import type { PostProcessorSettings, SpindleWarmup, MaterialSettings } from "../types";
import LabeledHandle from "./LabeledHandle";

const DEFAULT_SETTINGS: PostProcessorSettings = {
  machine: "shopbot",
  output_format: "sbp",
  unit: "mm",
  safe_z: 38.0,
  home_position: [0.0, 0.0],
  tool_number: 3,
  spindle_warmup: { initial_rpm: 5000, wait_seconds: 2 },
  material: { width: 600, depth: 400, thickness: 18, x_offset: 0, y_offset: 0 },
};

export default function PostProcessorNode({ id }: NodeProps) {
  const { setNodes } = useReactFlow();
  const [settings, setSettings] = useState<PostProcessorSettings>(DEFAULT_SETTINGS);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    machine: true,
    material: true,
  });

  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, postProcessorSettings: settings } } : n
      )
    );
  }, [id, settings, setNodes]);

  // ... form rendering with NumberField, SectionHeader
  // Fields: safe_z, tool_number, home_position[0], home_position[1],
  //         spindle_warmup.initial_rpm, spindle_warmup.wait_seconds,
  //         material.width, material.depth, material.thickness

  return (
    <div style={nodeStyle}>
      <div style={headerStyle}>Post Processor</div>
      {/* Machine section: safe_z, tool_number, home, spindle warmup */}
      {/* Material section: width, depth, thickness */}
      <LabeledHandle
        type="source"
        position={Position.Bottom}
        id={`${id}-out`}
        label="settings"
        dataType="settings"
      />
    </div>
  );
}
```

Full implementation should use NumberField and SectionHeader sub-components matching the MachiningSettingsNode pattern.

**Step 2: Verify frontend compiles**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add frontend/src/nodes/PostProcessorNode.tsx
git commit -m "Phase 4: Add PostProcessorNode React Flow component (#4)"
```

---

### Task 7: ToolpathGenNode コンポーネント

**Files:**
- Create: `frontend/src/nodes/ToolpathGenNode.tsx`

**Step 1: Create ToolpathGenNode**

Create: `frontend/src/nodes/ToolpathGenNode.tsx`

Follow the pattern from `ContourExtractNode.tsx`:
- 3 target handles: `{id}-contour` (geometry), `{id}-settings` (settings), `{id}-postprocessor` (settings)
- "Generate" button reads upstream node data via edges
- Calls `generateToolpath()` then `generateSbp()` sequentially
- Shows result summary (pass count, Z depths)
- "Download SBP" button triggers browser file download
- Stores `toolpathResult` and `sbpResult` in `node.data`

Key data flow in handleGenerate:
1. Find contour data from edge `{id}-contour` → upstream `node.data.contourResult`
2. Find machining settings from edge `{id}-settings` → upstream `node.data.machiningSettings`
3. Find post processor settings from edge `{id}-postprocessor` → upstream `node.data.postProcessorSettings`
4. Call `generateToolpath(contourResult[0], machiningSettings)` — use first contour result
5. Call `generateSbp(toolpathResult, machiningSettings, postProcessorSettings)`
6. Store results in node.data, show summary + download button

Download handler:
```typescript
const handleDownload = () => {
  if (!sbpResult) return;
  const blob = new Blob([sbpResult.sbp_code], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = sbpResult.filename;
  a.click();
  URL.revokeObjectURL(url);
};
```

**Step 2: Verify frontend compiles**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add frontend/src/nodes/ToolpathGenNode.tsx
git commit -m "Phase 4: Add ToolpathGenNode React Flow component (#4)"
```

---

### Task 8: App.tsx + Sidebar 統合

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/Sidebar.tsx`

**Step 1: Register new node types and update initial layout**

In `frontend/src/App.tsx`:

1. Import new nodes:
```typescript
import PostProcessorNode from "./nodes/PostProcessorNode";
import ToolpathGenNode from "./nodes/ToolpathGenNode";
```

2. Add to `nodeTypes`:
```typescript
const nodeTypes = {
  brepImport: BrepImportNode,
  contourExtract: ContourExtractNode,
  machiningSettings: MachiningSettingsNode,
  postProcessor: PostProcessorNode,
  toolpathGen: ToolpathGenNode,
  debug: DebugNode,
};
```

3. Update `initialNodes` — replace default placeholders for nodes 5 and 6:
```typescript
// Node 5: replace type:"default" with type:"postProcessor"
{
  id: "5",
  type: "postProcessor",
  position: { x: 500, y: 500 },
  data: {},
},
// Node 6: replace type:"default" with type:"toolpathGen"
{
  id: "6",
  type: "toolpathGen",
  position: { x: 350, y: 650 },
  data: {},
},
```

4. Update `initialEdges` — connect properly:
```typescript
// Remove: e2-4 (contour→merge), e4-6 (merge→toolpath)
// Add: contour→toolpathGen, machiningSettings→toolpathGen, postProcessor→toolpathGen
{ id: "e2-6", source: "2", sourceHandle: "2-out", target: "6", targetHandle: "6-contour" },
{ id: "e3-6", source: "3", sourceHandle: "3-out", target: "6", targetHandle: "6-settings" },
{ id: "e5-6", source: "5", sourceHandle: "5-out", target: "6", targetHandle: "6-postprocessor" },
{ id: "e6-7", source: "6", target: "7" },
```

Also remove the Merge default node (id: "4") from initialNodes since we're skipping it for Phase 4.

**Step 2: Add nodes to Sidebar**

In `frontend/src/Sidebar.tsx`, add to `nodeItems`:
```typescript
{ type: "postProcessor", label: "Post Processor", color: "#66bb6a" },
{ type: "toolpathGen", label: "Toolpath Gen", color: "#ff9800" },
```

**Step 3: Verify frontend compiles**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/frontend && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add frontend/src/App.tsx frontend/src/Sidebar.tsx
git commit -m "Phase 4: Integrate PostProcessorNode and ToolpathGenNode into canvas (#4)"
```

---

### Task 9: End-to-end 動作確認

**Step 1: Start dev servers**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner && make dev`

**Step 2: Manual test flow**

1. BREP Import ノードに STEP ファイルをドロップ
2. Contour Extract → "Extract Contours" をクリック
3. Machining Settings で値を確認
4. Post Processor で値を確認（デフォルトでOK）
5. Toolpath Gen → "Generate" をクリック
6. 結果サマリが表示されることを確認
7. "Download SBP" をクリック → .sbp ファイルがダウンロードされることを確認
8. ダウンロードした .sbp ファイルの内容を確認:
   - ヘッダー（SHOPBOT ROUTER FILE IN MM）
   - 単位チェック（IF %(25)=0...）
   - ツール・スピンドル設定
   - MS/JS 速度設定
   - J2 / M3 コマンドの使い分け
   - 多段パス（Z値が段階的に下がる）
   - C7 / END

**Step 3: Run all backend tests**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run pytest tests/ -v`
Expected: All tests PASS

**Step 4: Run frontend type check**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/frontend && npx tsc --noEmit`
Expected: No errors
