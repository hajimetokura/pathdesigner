# Phase 9: 複数オブジェクトSBP生成 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 複数オブジェクトの加工を1つのSBPファイルに統合出力する。オブジェクト間の加工順序制御、Safe Z退避、ツール設定の最適化を含む。

**Architecture:** `SbpWriter` を per-operation settings 対応にリファクタ。`Toolpath` スキーマに `settings` を追加し、各 toolpath が自身の加工設定を持つ構造にする。SBP生成時にオブジェクト間でツール/速度設定が変わる場合のみ再設定コマンドを挿入。

**Tech Stack:** Python (FastAPI, Pydantic), TypeScript (React)

---

## 現状の問題点

1. `SbpWriter.__init__` が単一 `MachiningSettings` → 全 toolpath に同一設定を適用
2. `generate_sbp_endpoint` が `req.operations[0].settings` のみ使用
3. toolpath 間の Safe Z 退避は実装済みだが、ツール変更・速度変更のロジックなし
4. 加工順序のソート（左下→右上）は toolpath_gen 側に未実装

---

### Task 1: Toolpath スキーマに settings を追加

**Files:**
- Modify: `backend/schemas.py:214` (Toolpath class)
- Test: `backend/tests/test_toolpath_schemas.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_toolpath_schemas.py に追加
def test_toolpath_with_settings():
    """Toolpath should carry its own MachiningSettings."""
    from schemas import Toolpath, ToolpathPass, MachiningSettings, Tool, FeedRate, TabSettings
    settings = MachiningSettings(
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
    tp = Toolpath(
        operation_id="op_001",
        passes=[ToolpathPass(pass_number=1, z_depth=12.0, path=[[0, 0], [10, 0]], tabs=[])],
        settings=settings,
    )
    assert tp.settings is not None
    assert tp.settings.spindle_speed == 18000


def test_toolpath_settings_optional():
    """Toolpath.settings should be optional for backward compat."""
    from schemas import Toolpath, ToolpathPass
    tp = Toolpath(
        operation_id="op_001",
        passes=[ToolpathPass(pass_number=1, z_depth=12.0, path=[[0, 0], [10, 0]], tabs=[])],
    )
    assert tp.settings is None
```

**Step 2: Run test to verify it fails**

Run: `cd backend && uv run python -m pytest tests/test_toolpath_schemas.py::test_toolpath_with_settings -v`
Expected: FAIL — `settings` field does not exist on Toolpath

**Step 3: Implement — add `settings` field to Toolpath**

```python
# backend/schemas.py — Toolpath class
class Toolpath(BaseModel):
    operation_id: str
    passes: list[ToolpathPass]
    settings: MachiningSettings | None = None  # ← 追加
```

**Step 4: Run tests to verify they pass**

Run: `cd backend && uv run python -m pytest tests/test_toolpath_schemas.py -v`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add backend/schemas.py backend/tests/test_toolpath_schemas.py
git commit -m "Phase 9: Add settings field to Toolpath schema (#9)"
```

---

### Task 2: toolpath_gen で settings を Toolpath に埋め込む

**Files:**
- Modify: `backend/nodes/toolpath_gen.py:137` (Toolpath 生成部分)
- Test: `backend/tests/test_toolpath_gen.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_toolpath_gen.py に追加
def test_generate_toolpath_includes_settings():
    """Each Toolpath should carry its operation's MachiningSettings."""
    from nodes.toolpath_gen import generate_toolpath_from_operations
    from schemas import (
        OperationAssignment, OperationDetectResult, DetectedOperation,
        OperationGeometry, Contour, OffsetApplied, MachiningSettings,
        Tool, FeedRate, TabSettings, StockSettings, StockMaterial,
    )

    settings = MachiningSettings(
        operation_type="contour",
        tool=Tool(diameter=6.35, type="endmill", flutes=2),
        feed_rate=FeedRate(xy=75.0, z=25.0),
        jog_speed=200.0, spindle_speed=18000,
        depth_per_pass=6.0, total_depth=18.0,
        direction="climb", offset_side="outside",
        tabs=TabSettings(enabled=False, height=3.0, width=5.0, count=4),
    )
    contour = Contour(id="c1", type="exterior", coords=[[0,0],[100,0],[100,50],[0,50],[0,0]], closed=True)
    detected = OperationDetectResult(operations=[
        DetectedOperation(
            operation_id="op_001", object_id="obj_001",
            operation_type="contour",
            geometry=OperationGeometry(contours=[contour], offset_applied=OffsetApplied(distance=3.175, side="outside"), depth=18.0),
            suggested_settings=settings,
        )
    ])
    assignments = [
        OperationAssignment(operation_id="op_001", material_id="mtl_1", settings=settings, order=1),
    ]
    stock = StockSettings(materials=[StockMaterial(material_id="mtl_1", thickness=18.0)])

    result = generate_toolpath_from_operations(assignments, detected, stock)

    for tp in result.toolpaths:
        assert tp.settings is not None
        assert tp.settings.spindle_speed == 18000
```

**Step 2: Run test to verify it fails**

Run: `cd backend && uv run python -m pytest tests/test_toolpath_gen.py::test_generate_toolpath_includes_settings -v`
Expected: FAIL — `tp.settings` is None

**Step 3: Implement — pass settings when creating Toolpath**

In `backend/nodes/toolpath_gen.py`, change the Toolpath creation in `generate_toolpath_from_operations`:

```python
# 既存コード（L137付近）:
            toolpaths.append(
                Toolpath(
                    operation_id=assignment.operation_id,
                    passes=passes,
                    settings=assignment.settings,  # ← 追加
                )
            )
```

**Step 4: Run tests**

Run: `cd backend && uv run python -m pytest tests/test_toolpath_gen.py -v`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add backend/nodes/toolpath_gen.py backend/tests/test_toolpath_gen.py
git commit -m "Phase 9: Embed MachiningSettings in each Toolpath (#9)"
```

---

### Task 3: SbpWriter を per-toolpath settings 対応にリファクタ

**Files:**
- Modify: `backend/sbp_writer.py`
- Test: `backend/tests/test_sbp_writer.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_sbp_writer.py に追加

def _make_settings(spindle_speed=18000, tool_diameter=6.35, xy_feed=75.0, z_feed=25.0):
    """Helper to create MachiningSettings."""
    return MachiningSettings(
        operation_type="contour",
        tool=Tool(diameter=tool_diameter, type="endmill", flutes=2),
        feed_rate=FeedRate(xy=xy_feed, z=z_feed),
        jog_speed=200.0, spindle_speed=spindle_speed,
        depth_per_pass=6.0, total_depth=18.0,
        direction="climb", offset_side="outside",
        tabs=TabSettings(enabled=False, height=3.0, width=5.0, count=4),
    )


def test_sbp_multi_object_different_speeds():
    """SBP should re-emit MS command when feed rate changes between objects."""
    tp1 = Toolpath(
        operation_id="op_001",
        passes=[ToolpathPass(pass_number=1, z_depth=-0.3, path=[[10,10],[50,10],[50,30],[10,30],[10,10]], tabs=[])],
        settings=_make_settings(xy_feed=75.0),
    )
    tp2 = Toolpath(
        operation_id="op_002",
        passes=[ToolpathPass(pass_number=1, z_depth=-0.3, path=[[200,10],[250,10],[250,30],[200,30],[200,10]], tabs=[])],
        settings=_make_settings(xy_feed=50.0),
    )
    writer = SbpWriter(PP_SETTINGS, MACHINING, STOCK)
    code = writer.generate([tp1, tp2])

    # Both speed settings should appear
    assert "MS,75.0,25.0" in code
    assert "MS,50.0,25.0" in code


def test_sbp_multi_object_same_settings_no_duplicate():
    """SBP should NOT re-emit tool/speed when settings are identical."""
    settings = _make_settings()
    tp1 = Toolpath(
        operation_id="op_001",
        passes=[ToolpathPass(pass_number=1, z_depth=-0.3, path=[[10,10],[50,10],[50,30],[10,10]], tabs=[])],
        settings=settings,
    )
    tp2 = Toolpath(
        operation_id="op_002",
        passes=[ToolpathPass(pass_number=1, z_depth=-0.3, path=[[200,10],[250,10],[250,30],[200,10]], tabs=[])],
        settings=settings,
    )
    writer = SbpWriter(PP_SETTINGS, MACHINING, STOCK)
    code = writer.generate([tp1, tp2])

    # MS should appear only once (header) + no duplicate
    assert code.count("MS,75.0,25.0") == 1


def test_sbp_safe_z_between_objects():
    """SBP should retract to safe_z and jog between different objects."""
    tp1 = Toolpath(
        operation_id="op_001",
        passes=[ToolpathPass(pass_number=1, z_depth=-0.3, path=[[10,10],[50,10],[50,30],[10,10]], tabs=[])],
        settings=_make_settings(),
    )
    tp2 = Toolpath(
        operation_id="op_002",
        passes=[ToolpathPass(pass_number=1, z_depth=-0.3, path=[[200,10],[250,10],[250,30],[200,10]], tabs=[])],
        settings=_make_settings(),
    )
    writer = SbpWriter(PP_SETTINGS, MACHINING, STOCK)
    code = writer.generate([tp1, tp2])
    lines = code.split("\n")

    # After tp1, should retract (JZ,38.0) then jog to tp2 start (J2,200,10)
    jz_indices = [i for i, l in enumerate(lines) if l.startswith("JZ,")]
    j2_indices = [i for i, l in enumerate(lines) if l.startswith("J2,200")]

    # There should be a JZ retract followed by a J2 to tp2's start
    assert len(j2_indices) >= 1, "Should jog to second object start"
```

**Step 2: Run tests to verify they fail**

Run: `cd backend && uv run python -m pytest tests/test_sbp_writer.py::test_sbp_multi_object_different_speeds tests/test_sbp_writer.py::test_sbp_multi_object_same_settings_no_duplicate tests/test_sbp_writer.py::test_sbp_safe_z_between_objects -v`
Expected: FAIL

**Step 3: Implement — refactor SbpWriter.generate()**

Replace `backend/sbp_writer.py`:

```python
"""SBP (ShopBot) code generator — EMARF CAM compatible format."""

from schemas import (
    MachiningSettings,
    PostProcessorSettings,
    StockSettings,
    Toolpath,
    ToolpathPass,
)


class SbpWriter:
    """Generates OpenSBP code from toolpath data."""

    def __init__(
        self,
        settings: PostProcessorSettings,
        machining: MachiningSettings,
        stock: StockSettings | None = None,
    ):
        self.s = settings
        self.m = machining  # default/fallback settings
        self.stock = stock

    def generate(self, toolpaths: list[Toolpath]) -> str:
        """Generate complete SBP file content.

        If individual toolpaths carry their own settings, per-toolpath
        tool/speed commands are emitted only when they differ from the
        previous toolpath.
        """
        lines: list[str] = []
        lines += self._header()
        lines += self._tool_spindle()
        lines += self._material_metadata()
        lines += self._speed_settings()
        lines += self._initial_position()

        # Track current active settings to avoid duplicate commands
        active = self.m

        for tp in toolpaths:
            tp_settings = tp.settings or self.m

            # Emit setting changes if different from active
            if tp.settings and tp_settings != active:
                lines += self._settings_change(active, tp_settings)
                active = tp_settings

            lines += self._cutting_passes(tp)

        lines += self._footer()
        return "\n".join(lines)

    # --- Header / Footer ---

    def _header(self) -> list[str]:
        return [
            "'SHOPBOT ROUTER FILE IN MM",
            f"'GENERATED BY PathDesigner ({self.s.machine_name})",
            "IF %(25)=0 THEN GOTO UNIT_ERROR",
            "SA",
            "CN,90",
            "'",
        ]

    def _tool_spindle(self) -> list[str]:
        return [
            f"&Tool = {self.s.tool_number}",
            "C9",
            f"TR,{self.m.spindle_speed}",
            "C6",
            f"PAUSE {self.s.warmup_pause}",
            "'",
        ]

    def _material_metadata(self) -> list[str]:
        lines: list[str] = []
        if self.stock:
            for mat in self.stock.materials:
                lines.extend([
                    f"'MATERIAL_ID:{mat.material_id}",
                    f"'MATERIAL_WIDTH:{mat.width:g}",
                    f"'MATERIAL_DEPTH:{mat.depth:g}",
                    f"'MATERIAL_THICKNESS:{mat.thickness:g}",
                ])
        lines.append(f"'MILL_SIZE:{self.m.tool.diameter:g}")
        lines.append("'")
        return lines

    def _speed_settings(self) -> list[str]:
        return [
            f"MS,{self.m.feed_rate.xy},{self.m.feed_rate.z}",
            f"JS,{self.m.jog_speed}",
            "'",
        ]

    def _initial_position(self) -> list[str]:
        home = self.s.home_position
        return [
            f"JZ,{self.s.safe_z}",
            f"J2,{home[0]},{home[1]}",
        ]

    def _footer(self) -> list[str]:
        home = self.s.home_position
        return [
            f"JZ,{self.s.safe_z}",
            f"J2,{home[0]},{home[1]}",
            "C7",
            "END",
            "'",
            "UNIT_ERROR:",
            "CN, 91",
            "END",
        ]

    # --- Per-toolpath settings changes ---

    def _settings_change(
        self, prev: MachiningSettings, curr: MachiningSettings
    ) -> list[str]:
        """Emit only the SBP commands needed for changed settings."""
        lines: list[str] = []
        lines.append("'")

        # Spindle speed change
        if curr.spindle_speed != prev.spindle_speed:
            lines.append(f"TR,{curr.spindle_speed}")
            lines.append(f"PAUSE {self.s.warmup_pause}")

        # Feed rate change
        if curr.feed_rate != prev.feed_rate:
            lines.append(f"MS,{curr.feed_rate.xy},{curr.feed_rate.z}")

        # Jog speed change
        if curr.jog_speed != prev.jog_speed:
            lines.append(f"JS,{curr.jog_speed}")

        return lines

    # --- Cutting ---

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

        return lines

    def _single_pass(self, tp_pass: ToolpathPass) -> list[str]:
        """Generate M3 commands for a single cutting pass."""
        lines: list[str] = []
        path = tp_pass.path
        if not path:
            return lines

        # Descend to pass depth at start point
        lines += self._descend(path[0], tp_pass.z_depth)

        # Build index-to-tab-z lookup
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
        """Descend to cutting depth at the given point."""
        x, y = point
        return [f"M3,{x},{y},{z_depth}"]
```

**Step 4: Run all SBP writer tests**

Run: `cd backend && uv run python -m pytest tests/test_sbp_writer.py -v`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add backend/sbp_writer.py backend/tests/test_sbp_writer.py
git commit -m "Phase 9: Refactor SbpWriter for per-toolpath settings (#9)"
```

---

### Task 4: generate_sbp_endpoint を複数設定対応に

**Files:**
- Modify: `backend/main.py:192-203`
- Test: `backend/tests/test_api_toolpath.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_api_toolpath.py に追加
def test_generate_sbp_uses_per_toolpath_settings(client):
    """SBP endpoint should use per-toolpath settings when available."""
    from schemas import (
        SbpGenRequest, ToolpathGenResult, Toolpath, ToolpathPass,
        OperationAssignment, MachiningSettings, Tool, FeedRate, TabSettings,
        StockSettings, StockMaterial, PostProcessorSettings,
    )

    settings_1 = MachiningSettings(
        operation_type="contour",
        tool=Tool(diameter=6.35, type="endmill", flutes=2),
        feed_rate=FeedRate(xy=75.0, z=25.0),
        jog_speed=200.0, spindle_speed=18000,
        depth_per_pass=6.0, total_depth=18.0,
        direction="climb", offset_side="outside",
        tabs=TabSettings(enabled=False, height=3.0, width=5.0, count=4),
    )
    settings_2 = settings_1.model_copy(update={
        "feed_rate": FeedRate(xy=50.0, z=20.0),
    })

    tp_result = ToolpathGenResult(toolpaths=[
        Toolpath(
            operation_id="op_001",
            passes=[ToolpathPass(pass_number=1, z_depth=-0.3, path=[[10,10],[50,10],[10,10]], tabs=[])],
            settings=settings_1,
        ),
        Toolpath(
            operation_id="op_002",
            passes=[ToolpathPass(pass_number=1, z_depth=-0.3, path=[[200,10],[250,10],[200,10]], tabs=[])],
            settings=settings_2,
        ),
    ])

    req = SbpGenRequest(
        toolpath_result=tp_result,
        operations=[
            OperationAssignment(operation_id="op_001", material_id="mtl_1", settings=settings_1, order=1),
            OperationAssignment(operation_id="op_002", material_id="mtl_1", settings=settings_2, order=2),
        ],
        stock=StockSettings(materials=[StockMaterial(material_id="mtl_1")]),
        post_processor=PostProcessorSettings(),
    )

    res = client.post("/api/generate-sbp", json=req.model_dump())
    assert res.status_code == 200
    code = res.json()["code"]
    assert "MS,75.0,25.0" in code
    assert "MS,50.0,20.0" in code
```

**Step 2: Run test to verify it fails**

Run: `cd backend && uv run python -m pytest tests/test_api_toolpath.py::test_generate_sbp_uses_per_toolpath_settings -v`
Expected: FAIL (or PASS if SbpWriter already handles it — but endpoint still uses [0].settings only)

**Step 3: Implement — update endpoint**

In `backend/main.py`, update `generate_sbp_endpoint`:

```python
@app.post("/api/generate-sbp", response_model=OutputResult)
def generate_sbp_endpoint(req: SbpGenRequest):
    """Generate SBP code from toolpath data + post processor settings."""
    try:
        machining = req.operations[0].settings if req.operations else None
        if not machining:
            raise ValueError("No operations provided")
        writer = SbpWriter(req.post_processor, machining, req.stock)
        sbp_code = writer.generate(req.toolpath_result.toolpaths)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SBP generation failed: {e}")
    return OutputResult(code=sbp_code, filename="output.sbp", format="sbp")
```

Note: The endpoint logic itself may not need changes since `SbpWriter.generate()` now reads per-toolpath settings. But ensure the default `machining` passed to constructor matches the first operation.

**Step 4: Run tests**

Run: `cd backend && uv run python -m pytest tests/test_api_toolpath.py -v`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add backend/main.py backend/tests/test_api_toolpath.py
git commit -m "Phase 9: Update SBP endpoint for per-toolpath settings (#9)"
```

---

### Task 5: 加工順序ソート（配置位置 y→x）

**Files:**
- Modify: `backend/nodes/toolpath_gen.py`
- Test: `backend/tests/test_toolpath_gen.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_toolpath_gen.py に追加
def test_toolpath_ordering_by_placement():
    """Toolpaths should be ordered by placement: y_offset asc, then x_offset asc."""
    from nodes.toolpath_gen import generate_toolpath_from_operations
    from schemas import (
        OperationAssignment, OperationDetectResult, DetectedOperation,
        OperationGeometry, Contour, OffsetApplied, MachiningSettings,
        Tool, FeedRate, TabSettings, StockSettings, StockMaterial, PlacementItem,
    )

    settings = MachiningSettings(
        operation_type="contour",
        tool=Tool(diameter=6.35, type="endmill", flutes=2),
        feed_rate=FeedRate(xy=75.0, z=25.0),
        jog_speed=200.0, spindle_speed=18000,
        depth_per_pass=6.0, total_depth=18.0,
        direction="climb", offset_side="outside",
        tabs=TabSettings(enabled=False, height=3.0, width=5.0, count=4),
    )
    contour = Contour(id="c1", type="exterior", coords=[[0,0],[100,0],[100,50],[0,50],[0,0]], closed=True)

    def make_op(op_id, obj_id):
        return DetectedOperation(
            operation_id=op_id, object_id=obj_id,
            operation_type="contour",
            geometry=OperationGeometry(contours=[contour], offset_applied=OffsetApplied(distance=3.175, side="outside"), depth=18.0),
            suggested_settings=settings,
        )

    detected = OperationDetectResult(operations=[
        make_op("op_A", "obj_A"),
        make_op("op_B", "obj_B"),
        make_op("op_C", "obj_C"),
    ])

    # obj_C at top-right, obj_A at bottom-left, obj_B at bottom-right
    placements = [
        PlacementItem(object_id="obj_C", material_id="mtl_1", x_offset=200, y_offset=200),
        PlacementItem(object_id="obj_A", material_id="mtl_1", x_offset=10, y_offset=10),
        PlacementItem(object_id="obj_B", material_id="mtl_1", x_offset=200, y_offset=10),
    ]

    assignments = [
        OperationAssignment(operation_id="op_A", material_id="mtl_1", settings=settings, order=1),
        OperationAssignment(operation_id="op_B", material_id="mtl_1", settings=settings, order=2),
        OperationAssignment(operation_id="op_C", material_id="mtl_1", settings=settings, order=3),
    ]
    stock = StockSettings(materials=[StockMaterial(material_id="mtl_1", thickness=18.0)])

    result = generate_toolpath_from_operations(assignments, detected, stock, placements)

    # Expected order: obj_A (y=10,x=10), obj_B (y=10,x=200), obj_C (y=200,x=200)
    op_ids = [tp.operation_id for tp in result.toolpaths]
    # Interior contours come before exterior for same object, but
    # between objects order should be A → B → C
    assert op_ids[0] == "op_A"
    assert op_ids[1] == "op_B"
    assert op_ids[2] == "op_C"
```

**Step 2: Run test to verify it fails**

Run: `cd backend && uv run python -m pytest tests/test_toolpath_gen.py::test_toolpath_ordering_by_placement -v`
Expected: FAIL — order follows `assignment.order`, not placement position

**Step 3: Implement — sort assignments by placement position**

In `backend/nodes/toolpath_gen.py`, at the start of `generate_toolpath_from_operations`, add placement-based sorting:

```python
    # Sort assignments by placement position: y_offset asc → x_offset asc
    if placements:
        plc_lookup = {p.object_id: p for p in placements}
        # Build op_id → object_id lookup
        op_to_obj = {op.operation_id: op.object_id for op in detected.operations}

        def sort_key(a: OperationAssignment):
            obj_id = op_to_obj.get(a.operation_id, "")
            plc = plc_lookup.get(obj_id)
            if plc:
                return (plc.y_offset, plc.x_offset, a.order)
            return (float("inf"), float("inf"), a.order)

        sorted_assignments = sorted(assignments, key=sort_key)
    else:
        sorted_assignments = sorted(assignments, key=lambda a: a.order)
```

Then use `sorted_assignments` instead of `sorted(assignments, key=lambda a: a.order)`.

**Step 4: Run tests**

Run: `cd backend && uv run python -m pytest tests/test_toolpath_gen.py -v`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add backend/nodes/toolpath_gen.py backend/tests/test_toolpath_gen.py
git commit -m "Phase 9: Sort toolpath order by placement position y→x (#9)"
```

---

### Task 6: フロントエンド — ToolpathGenNode の型更新

**Files:**
- Modify: `frontend/src/types.ts` (Toolpath に settings を追加)

**Step 1: Update TypeScript types**

```typescript
// frontend/src/types.ts — Toolpath interface に追加
export interface Toolpath {
  operation_id: string;
  passes: ToolpathPass[];
  settings?: MachiningSettings;  // ← 追加
}
```

**Step 2: Verify build passes**

Run: `cd frontend && npm run build`
Expected: BUILD SUCCESS (settings is optional, no breaking changes)

**Step 3: Commit**

```bash
git add frontend/src/types.ts
git commit -m "Phase 9: Add optional settings to Toolpath type (#9)"
```

---

### Task 7: 全テスト + 動作確認

**Step 1: Run all backend tests**

Run: `cd backend && uv run python -m pytest tests/ -v`
Expected: ALL PASS

**Step 2: Run frontend build**

Run: `cd frontend && npm run build`
Expected: BUILD SUCCESS

**Step 3: Manual smoke test**

Run: `make dev`
1. Upload a STEP file with 2+ objects
2. Configure placements
3. Run toolpath generation
4. Verify SBP code shows correct per-object settings
5. Export and inspect SBP file

**Step 4: Final commit (if any fixes needed)**

---

## Summary of Changes

| File | Change |
|------|--------|
| `backend/schemas.py` | `Toolpath.settings: MachiningSettings \| None` 追加 |
| `backend/nodes/toolpath_gen.py` | settings 埋め込み + 配置位置ソート |
| `backend/sbp_writer.py` | per-toolpath settings 対応、差分のみコマンド出力 |
| `backend/main.py` | エンドポイント微修正（必要に応じて） |
| `frontend/src/types.ts` | `Toolpath.settings?` 追加 |
| `backend/tests/test_toolpath_schemas.py` | settings フィールドのテスト |
| `backend/tests/test_toolpath_gen.py` | settings 埋め込み + 順序テスト |
| `backend/tests/test_sbp_writer.py` | 複数オブジェクト SBP テスト |
| `backend/tests/test_api_toolpath.py` | エンドポイント統合テスト |
