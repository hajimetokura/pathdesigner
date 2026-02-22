# Architecture Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor PathDesigner's node architecture from processing-step-based to operation-centric, separating stock material from post-processor and enabling per-operation machining settings.

**Architecture:** Auto-detect machining operations from BREP geometry, present as editable list. Stock (material) becomes independent node. PostProcessor loses material settings. Toolpath gen accepts operation assignments + stock. v1 scope: contour detection only, rectangular stock.

**Tech Stack:** FastAPI, Pydantic, build123d, shapely, React, React Flow, TypeScript

---

## Prerequisites

Phase 4 (`feature/phase-4-toolpath-sbp`) must be merged to main before starting. Create a new feature branch from the merged main.

```bash
# On main branch
git merge feature/phase-4-toolpath-sbp
git checkout -b feature/architecture-redesign
```

---

## Task 1: Add Stock schemas

**Files:**
- Modify: `backend/schemas.py`
- Test: `backend/tests/test_schemas.py` (create)

**Step 1: Write the failing test**

Create `backend/tests/test_schemas.py`:

```python
"""Tests for schema validation."""

import pytest
from schemas import StockMaterial, StockSettings


def test_stock_material_defaults():
    mat = StockMaterial(material_id="mtl_1")
    assert mat.width == 600
    assert mat.depth == 400
    assert mat.thickness == 18
    assert mat.x_position == 0
    assert mat.y_position == 0
    assert mat.label == ""


def test_stock_settings_single_material():
    settings = StockSettings(
        materials=[StockMaterial(material_id="mtl_1", thickness=24)]
    )
    assert len(settings.materials) == 1
    assert settings.materials[0].thickness == 24


def test_stock_settings_multiple_materials():
    settings = StockSettings(
        materials=[
            StockMaterial(material_id="mtl_1", thickness=15),
            StockMaterial(material_id="mtl_2", thickness=24),
        ]
    )
    assert len(settings.materials) == 2


def test_stock_settings_serialization():
    settings = StockSettings(
        materials=[StockMaterial(material_id="mtl_1", label="合板 18mm")]
    )
    data = settings.model_dump()
    restored = StockSettings(**data)
    assert restored.materials[0].label == "合板 18mm"
```

**Step 2: Run test to verify it fails**

Run: `cd backend && uv run python -m pytest tests/test_schemas.py -v`
Expected: ImportError (StockMaterial, StockSettings not defined)

**Step 3: Add schemas to schemas.py**

Add after the `ContourExtractResult` block (after line ~74):

```python
# --- Node 2: Stock Settings ---


class StockMaterial(BaseModel):
    material_id: str
    label: str = ""
    width: float = 600        # mm (X)
    depth: float = 400        # mm (Y)
    thickness: float = 18     # mm (Z)
    x_position: float = 0     # position on CNC bed
    y_position: float = 0


class StockSettings(BaseModel):
    materials: list[StockMaterial]
```

**Step 4: Run test to verify it passes**

Run: `cd backend && uv run python -m pytest tests/test_schemas.py -v`
Expected: 4 passed

**Step 5: Commit**

```bash
git add backend/schemas.py backend/tests/test_schemas.py
git commit -m "Add StockMaterial and StockSettings schemas"
```

---

## Task 2: Add Operation Detection schemas

**Files:**
- Modify: `backend/schemas.py`
- Modify: `backend/tests/test_schemas.py`

**Step 1: Write the failing test**

Append to `backend/tests/test_schemas.py`:

```python
from schemas import (
    Contour, OffsetApplied, MachiningSettings,
    OperationGeometry, DetectedOperation, OperationDetectResult,
)


def test_detected_operation_contour():
    geom = OperationGeometry(
        contours=[
            Contour(id="c_001", type="exterior", coords=[[0, 0], [10, 0], [10, 10], [0, 0]], closed=True)
        ],
        offset_applied=OffsetApplied(distance=3.175, side="outside"),
        depth=18.0,
    )
    op = DetectedOperation(
        operation_id="op_001",
        object_id="obj_001",
        operation_type="contour",
        geometry=geom,
        suggested_settings=MachiningSettings(
            operation_type="contour",
            tool={"diameter": 6.35, "type": "endmill", "flutes": 2},
            feed_rate={"xy": 75, "z": 25},
            jog_speed=200,
            spindle_speed=18000,
            depth_per_pass=6.0,
            total_depth=18.0,
            direction="climb",
            offset_side="outside",
            tabs={"enabled": True, "height": 8, "width": 5, "count": 4},
        ),
    )
    assert op.enabled is True
    assert op.operation_type == "contour"


def test_operation_detect_result():
    result = OperationDetectResult(operations=[])
    assert len(result.operations) == 0
```

**Step 2: Run test to verify it fails**

Run: `cd backend && uv run python -m pytest tests/test_schemas.py::test_detected_operation_contour -v`
Expected: ImportError

**Step 3: Add schemas**

Add after StockSettings in `backend/schemas.py`:

```python
# --- Node 3: Operation Detection ---


class OperationGeometry(BaseModel):
    contours: list[Contour]
    offset_applied: OffsetApplied
    depth: float  # cutting depth for this operation (mm)


class DetectedOperation(BaseModel):
    operation_id: str
    object_id: str
    operation_type: str  # "contour" | "pocket" | "drill" | "engrave"
    geometry: OperationGeometry
    suggested_settings: MachiningSettings
    enabled: bool = True


class OperationDetectResult(BaseModel):
    operations: list[DetectedOperation]
```

Note: `MachiningSettings` is defined earlier in the file so this works. However `OperationGeometry` references `Contour` and `OffsetApplied` which are also defined earlier. Verify the order.

**Step 4: Run test**

Run: `cd backend && uv run python -m pytest tests/test_schemas.py -v`
Expected: 6 passed

**Step 5: Commit**

```bash
git add backend/schemas.py backend/tests/test_schemas.py
git commit -m "Add Operation Detection schemas (OperationGeometry, DetectedOperation, OperationDetectResult)"
```

---

## Task 3: Add Operation Assignment schemas

**Files:**
- Modify: `backend/schemas.py`
- Modify: `backend/tests/test_schemas.py`

**Step 1: Write the failing test**

Append to `backend/tests/test_schemas.py`:

```python
from schemas import OperationAssignment, OperationEditResult


def test_operation_assignment():
    assignment = OperationAssignment(
        operation_id="op_001",
        material_id="mtl_1",
        settings=MachiningSettings(
            operation_type="contour",
            tool={"diameter": 6.35, "type": "endmill", "flutes": 2},
            feed_rate={"xy": 75, "z": 25},
            jog_speed=200,
            spindle_speed=18000,
            depth_per_pass=6.0,
            total_depth=18.0,
            direction="climb",
            offset_side="outside",
            tabs={"enabled": True, "height": 8, "width": 5, "count": 4},
        ),
        order=1,
    )
    assert assignment.enabled is True
    assert assignment.material_id == "mtl_1"


def test_operation_edit_result():
    result = OperationEditResult(assignments=[])
    assert len(result.assignments) == 0
```

**Step 2: Run test → fail**

Run: `cd backend && uv run python -m pytest tests/test_schemas.py::test_operation_assignment -v`

**Step 3: Add schemas**

Add after `OperationDetectResult` in `backend/schemas.py`:

```python
# --- Node 4: Operation Editing ---


class OperationAssignment(BaseModel):
    operation_id: str
    material_id: str
    enabled: bool = True
    settings: MachiningSettings
    order: int


class OperationEditResult(BaseModel):
    assignments: list[OperationAssignment]
```

**Step 4: Run test → pass**

Run: `cd backend && uv run python -m pytest tests/test_schemas.py -v`
Expected: 8 passed

**Step 5: Commit**

```bash
git add backend/schemas.py backend/tests/test_schemas.py
git commit -m "Add OperationAssignment and OperationEditResult schemas"
```

---

## Task 4: Remove material from PostProcessorSettings

**Files:**
- Modify: `backend/schemas.py`
- Modify: `backend/tests/test_schemas.py`

**Step 1: Write the failing test**

Append to `backend/tests/test_schemas.py`:

```python
from schemas import PostProcessorSettings


def test_post_processor_no_material():
    """PostProcessorSettings should not have a material field."""
    settings = PostProcessorSettings()
    assert not hasattr(settings, "material") or "material" not in settings.model_fields
    assert settings.machine_name == "ShopBot PRS-alpha 96-48"
    assert settings.safe_z == 38.0
```

**Step 2: Run test → fail**

The test will fail because `PostProcessorSettings` still has `material`.

**Step 3: Remove material from PostProcessorSettings**

In `backend/schemas.py`, modify `PostProcessorSettings`:

```python
class PostProcessorSettings(BaseModel):
    machine_name: str = "ShopBot PRS-alpha 96-48"
    output_format: str = "sbp"
    unit: str = "mm"
    bed_size: list[float] = [1220.0, 2440.0]  # [x, y] mm
    safe_z: float = 38.0
    home_position: list[float] = [0.0, 0.0]
    tool_number: int = 3
    warmup_pause: int = 2  # seconds
```

Remove `MaterialSettings` class and `material: MaterialSettings = MaterialSettings()` line.

**Step 4: Run test → pass**

Run: `cd backend && uv run python -m pytest tests/test_schemas.py -v`
Expected: 9 passed

**Step 5: Commit**

```bash
git add backend/schemas.py backend/tests/test_schemas.py
git commit -m "Remove MaterialSettings from PostProcessorSettings"
```

---

## Task 5: Update ToolpathGenRequest and SbpGenRequest

**Files:**
- Modify: `backend/schemas.py`
- Modify: `backend/tests/test_schemas.py`

**Step 1: Write the failing test**

Append to `backend/tests/test_schemas.py`:

```python
from schemas import ToolpathGenRequest, SbpGenRequest, ToolpathGenResult


def test_toolpath_gen_request_new_format():
    """ToolpathGenRequest should accept operations + detected_operations + stock."""
    req = ToolpathGenRequest(
        operations=[],
        detected_operations=OperationDetectResult(operations=[]),
        stock=StockSettings(materials=[StockMaterial(material_id="mtl_1")]),
    )
    assert len(req.operations) == 0


def test_sbp_gen_request_new_format():
    """SbpGenRequest should accept stock instead of material in post_processor."""
    req = SbpGenRequest(
        toolpath_result=ToolpathGenResult(toolpaths=[]),
        operations=[],
        stock=StockSettings(materials=[StockMaterial(material_id="mtl_1")]),
        post_processor=PostProcessorSettings(),
    )
    assert len(req.stock.materials) == 1
```

**Step 2: Run test → fail**

**Step 3: Update schemas**

Replace `ToolpathGenRequest` and `SbpGenRequest` in `backend/schemas.py`:

```python
class ToolpathGenRequest(BaseModel):
    operations: list[OperationAssignment]
    detected_operations: OperationDetectResult
    stock: StockSettings


class SbpGenRequest(BaseModel):
    toolpath_result: ToolpathGenResult
    operations: list[OperationAssignment]
    stock: StockSettings
    post_processor: PostProcessorSettings
```

**Step 4: Run test → pass**

Run: `cd backend && uv run python -m pytest tests/test_schemas.py -v`
Expected: 11 passed

**Step 5: Commit**

```bash
git add backend/schemas.py backend/tests/test_schemas.py
git commit -m "Update ToolpathGenRequest and SbpGenRequest for operation-centric architecture"
```

---

## Task 6: Create operation_detector.py

**Files:**
- Create: `backend/nodes/operation_detector.py`
- Create: `backend/tests/test_operation_detector.py`
- Keep: `backend/nodes/contour_extract.py` (still used internally)

**Step 1: Write the failing test**

Create `backend/tests/test_operation_detector.py`:

```python
"""Tests for operation detection node."""

from pathlib import Path

from nodes.operation_detector import detect_operations
from schemas import OperationDetectResult


def test_detect_operations_simple_box(simple_box_step: Path):
    """A 100x50x10 box should detect one contour operation."""
    result = detect_operations(
        step_path=simple_box_step,
        file_id="test_file",
        object_ids=["obj_001"],
        tool_diameter=6.35,
        offset_side="outside",
    )

    assert isinstance(result, OperationDetectResult)
    assert len(result.operations) == 1

    op = result.operations[0]
    assert op.operation_type == "contour"
    assert op.object_id == "obj_001"
    assert op.enabled is True
    assert len(op.geometry.contours) >= 1
    assert op.geometry.depth == 10.0  # box thickness
    assert op.suggested_settings.operation_type == "contour"


def test_detect_operations_multiple_objects(simple_box_step: Path):
    """Requesting multiple object IDs should detect one operation per object."""
    result = detect_operations(
        step_path=simple_box_step,
        file_id="test_file",
        object_ids=["obj_001"],  # simple_box has only 1 solid
        tool_diameter=6.35,
        offset_side="outside",
    )

    assert len(result.operations) == 1
    assert result.operations[0].operation_id.startswith("op_")


def test_detect_operations_no_offset(simple_box_step: Path):
    """With offset_side='none', offset should be 0."""
    result = detect_operations(
        step_path=simple_box_step,
        file_id="test_file",
        object_ids=["obj_001"],
        tool_diameter=6.35,
        offset_side="none",
    )

    op = result.operations[0]
    assert op.geometry.offset_applied.distance == 0.0
```

**Step 2: Run test → fail**

Run: `cd backend && uv run python -m pytest tests/test_operation_detector.py -v`
Expected: ModuleNotFoundError

**Step 3: Create operation_detector.py**

Create `backend/nodes/operation_detector.py`:

```python
"""Operation Detector — analyze BREP and detect required machining operations."""

from pathlib import Path

from nodes.contour_extract import extract_contours
from schemas import (
    DetectedOperation,
    MachiningSettings,
    OperationDetectResult,
    OperationGeometry,
    Tool,
    FeedRate,
    TabSettings,
)


# Default suggested settings for contour operations
_DEFAULT_CONTOUR_SETTINGS = dict(
    operation_type="contour",
    tool=Tool(diameter=6.35, type="endmill", flutes=2),
    feed_rate=FeedRate(xy=75, z=25),
    jog_speed=200,
    spindle_speed=18000,
    depth_per_pass=6.0,
    total_depth=18.0,  # will be overridden by actual thickness
    direction="climb",
    offset_side="outside",
    tabs=TabSettings(enabled=True, height=8, width=5, count=4),
)


def detect_operations(
    step_path: str | Path,
    file_id: str,
    object_ids: list[str],
    tool_diameter: float = 6.35,
    offset_side: str = "outside",
) -> OperationDetectResult:
    """Detect machining operations from BREP geometry.

    v1: Detects contour (exterior outline) operations only.
    Future: pocket, drill, engrave detection.
    """
    operations: list[DetectedOperation] = []

    for i, object_id in enumerate(object_ids):
        contour_result = extract_contours(
            step_path=step_path,
            object_id=object_id,
            tool_diameter=tool_diameter,
            offset_side=offset_side,
        )

        # Build suggested settings with actual object thickness
        suggested = MachiningSettings(
            **{**_DEFAULT_CONTOUR_SETTINGS, "total_depth": contour_result.thickness}
        )
        if tool_diameter != 6.35:
            suggested = suggested.model_copy(
                update={"tool": Tool(diameter=tool_diameter, type="endmill", flutes=2)}
            )

        operations.append(
            DetectedOperation(
                operation_id=f"op_{i + 1:03d}",
                object_id=object_id,
                operation_type="contour",
                geometry=OperationGeometry(
                    contours=contour_result.contours,
                    offset_applied=contour_result.offset_applied,
                    depth=contour_result.thickness,
                ),
                suggested_settings=suggested,
            )
        )

    return OperationDetectResult(operations=operations)
```

**Step 4: Run test → pass**

Run: `cd backend && uv run python -m pytest tests/test_operation_detector.py -v`
Expected: 3 passed

**Step 5: Commit**

```bash
git add backend/nodes/operation_detector.py backend/tests/test_operation_detector.py
git commit -m "Add operation_detector.py — detects contour operations from BREP"
```

---

## Task 7: Update toolpath_gen.py

**Files:**
- Modify: `backend/nodes/toolpath_gen.py`
- Create: `backend/tests/test_toolpath_gen.py`

**Step 1: Write the failing test**

Create `backend/tests/test_toolpath_gen.py`:

```python
"""Tests for toolpath generation with operation-centric input."""

from nodes.toolpath_gen import generate_toolpath_from_operations
from schemas import (
    Contour, OffsetApplied,
    OperationAssignment, OperationGeometry, DetectedOperation, OperationDetectResult,
    MachiningSettings, Tool, FeedRate, TabSettings,
    StockMaterial, StockSettings,
    ToolpathGenResult,
)


def _make_square_contour():
    """Create a simple 100x50 square contour."""
    return Contour(
        id="c_001",
        type="exterior",
        coords=[[0, 0], [100, 0], [100, 50], [0, 50], [0, 0]],
        closed=True,
    )


def _make_settings(total_depth: float = 18.0):
    return MachiningSettings(
        operation_type="contour",
        tool=Tool(diameter=6.35, type="endmill", flutes=2),
        feed_rate=FeedRate(xy=75, z=25),
        jog_speed=200,
        spindle_speed=18000,
        depth_per_pass=6.0,
        total_depth=total_depth,
        direction="climb",
        offset_side="outside",
        tabs=TabSettings(enabled=True, height=8, width=5, count=4),
    )


def test_generate_from_operations_single():
    """Single contour operation should produce toolpath with correct Z depths."""
    contour = _make_square_contour()
    detected = OperationDetectResult(
        operations=[
            DetectedOperation(
                operation_id="op_001",
                object_id="obj_001",
                operation_type="contour",
                geometry=OperationGeometry(
                    contours=[contour],
                    offset_applied=OffsetApplied(distance=3.175, side="outside"),
                    depth=10.0,
                ),
                suggested_settings=_make_settings(10.0),
            )
        ]
    )
    assignments = [
        OperationAssignment(
            operation_id="op_001",
            material_id="mtl_1",
            settings=_make_settings(10.0),
            order=1,
        )
    ]
    stock = StockSettings(
        materials=[StockMaterial(material_id="mtl_1", thickness=12)]
    )

    result = generate_toolpath_from_operations(assignments, detected, stock)

    assert isinstance(result, ToolpathGenResult)
    assert len(result.toolpaths) == 1
    # Stock is 12mm, depth_per_pass=6 → 2 passes
    tp = result.toolpaths[0]
    assert len(tp.passes) == 2
    # Final pass should penetrate below stock bottom
    assert tp.passes[-1].z_depth < 0


def test_generate_from_operations_disabled():
    """Disabled operations should be skipped."""
    contour = _make_square_contour()
    detected = OperationDetectResult(
        operations=[
            DetectedOperation(
                operation_id="op_001",
                object_id="obj_001",
                operation_type="contour",
                geometry=OperationGeometry(
                    contours=[contour],
                    offset_applied=OffsetApplied(distance=3.175, side="outside"),
                    depth=10.0,
                ),
                suggested_settings=_make_settings(10.0),
            )
        ]
    )
    assignments = [
        OperationAssignment(
            operation_id="op_001",
            material_id="mtl_1",
            enabled=False,
            settings=_make_settings(10.0),
            order=1,
        )
    ]
    stock = StockSettings(
        materials=[StockMaterial(material_id="mtl_1", thickness=12)]
    )

    result = generate_toolpath_from_operations(assignments, detected, stock)
    assert len(result.toolpaths) == 0
```

**Step 2: Run test → fail**

Run: `cd backend && uv run python -m pytest tests/test_toolpath_gen.py -v`
Expected: ImportError (generate_toolpath_from_operations not found)

**Step 3: Add new function to toolpath_gen.py**

Add to `backend/nodes/toolpath_gen.py` (keep existing `generate_toolpath` for backward compat):

```python
from schemas import (
    ContourExtractResult,
    MachiningSettings,
    OperationAssignment,
    OperationDetectResult,
    StockSettings,
    TabSegment,
    Toolpath,
    ToolpathGenResult,
    ToolpathPass,
)


def generate_toolpath_from_operations(
    assignments: list[OperationAssignment],
    detected: OperationDetectResult,
    stock: StockSettings,
) -> ToolpathGenResult:
    """Generate toolpaths from operation assignments.

    For contour operations, uses the assigned stock material's thickness
    as the cutting depth (to cut through the entire stock).
    """
    # Build lookup: operation_id → DetectedOperation
    op_lookup = {op.operation_id: op for op in detected.operations}
    # Build lookup: material_id → StockMaterial
    mat_lookup = {m.material_id: m for m in stock.materials}

    toolpaths: list[Toolpath] = []

    for assignment in sorted(assignments, key=lambda a: a.order):
        if not assignment.enabled:
            continue

        detected_op = op_lookup.get(assignment.operation_id)
        if not detected_op:
            continue

        material = mat_lookup.get(assignment.material_id)
        if not material:
            continue

        # For contour operations, cut through entire stock
        if detected_op.operation_type == "contour":
            total_depth = material.thickness
        else:
            total_depth = detected_op.geometry.depth

        for contour in detected_op.geometry.contours:
            if contour.type != "exterior":
                continue

            passes = _compute_passes(
                coords=contour.coords,
                depth_per_pass=assignment.settings.depth_per_pass,
                total_depth=total_depth,
                tabs_settings=assignment.settings.tabs,
            )

            toolpaths.append(
                Toolpath(
                    operation_id=assignment.operation_id,
                    passes=passes,
                )
            )

    return ToolpathGenResult(toolpaths=toolpaths)
```

**Step 4: Run test → pass**

Run: `cd backend && uv run python -m pytest tests/test_toolpath_gen.py -v`
Expected: 2 passed

**Step 5: Commit**

```bash
git add backend/nodes/toolpath_gen.py backend/tests/test_toolpath_gen.py
git commit -m "Add generate_toolpath_from_operations for operation-centric architecture"
```

---

## Task 8: Update sbp_writer.py

**Files:**
- Modify: `backend/sbp_writer.py`
- Create: `backend/tests/test_sbp_writer.py`

**Step 1: Write the failing test**

Create `backend/tests/test_sbp_writer.py`:

```python
"""Tests for SBP code generation."""

from sbp_writer import SbpWriter
from schemas import (
    MachiningSettings, Tool, FeedRate, TabSettings,
    PostProcessorSettings,
    StockSettings, StockMaterial,
    Toolpath, ToolpathPass,
)


def _make_settings():
    return MachiningSettings(
        operation_type="contour",
        tool=Tool(diameter=6.35, type="endmill", flutes=2),
        feed_rate=FeedRate(xy=75, z=25),
        jog_speed=200,
        spindle_speed=18000,
        depth_per_pass=6.0,
        total_depth=18.0,
        direction="climb",
        offset_side="outside",
        tabs=TabSettings(enabled=False, height=8, width=5, count=0),
    )


def test_sbp_writer_with_stock():
    """SBP output should include stock material metadata."""
    post = PostProcessorSettings()
    stock = StockSettings(
        materials=[StockMaterial(material_id="mtl_1", width=600, depth=400, thickness=18)]
    )
    toolpaths = [
        Toolpath(
            operation_id="op_001",
            passes=[
                ToolpathPass(
                    pass_number=1,
                    z_depth=12.0,
                    path=[[0, 0], [100, 0], [100, 50], [0, 50], [0, 0]],
                    tabs=[],
                )
            ],
        )
    ]

    writer = SbpWriter(
        settings=post,
        machining=_make_settings(),
        stock=stock,
    )
    sbp = writer.generate(toolpaths)

    assert "'SHOPBOT ROUTER FILE IN MM" in sbp
    assert "mtl_1" in sbp
    assert "600" in sbp
    assert "TR,18000" in sbp


def test_sbp_writer_no_material_in_post_processor():
    """SBP writer should NOT reference material from PostProcessorSettings."""
    post = PostProcessorSettings()
    assert not hasattr(post, "material") or "material" not in post.model_fields
```

**Step 2: Run test → fail**

Run: `cd backend && uv run python -m pytest tests/test_sbp_writer.py -v`
Expected: TypeError (SbpWriter.__init__ doesn't accept stock)

**Step 3: Update SbpWriter**

Modify `backend/sbp_writer.py`:

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
        stock: StockSettings,
    ):
        self.s = settings
        self.m = machining
        self.stock = stock
```

Update `_material_metadata` to use `self.stock`:

```python
    def _material_metadata(self) -> list[str]:
        lines: list[str] = []
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
```

**Step 4: Run test → pass**

Run: `cd backend && uv run python -m pytest tests/test_sbp_writer.py -v`
Expected: 2 passed

**Step 5: Commit**

```bash
git add backend/sbp_writer.py backend/tests/test_sbp_writer.py
git commit -m "Update SbpWriter to accept StockSettings instead of material in PostProcessor"
```

---

## Task 9: Update API endpoints

**Files:**
- Modify: `backend/main.py`

**Step 1: Write the failing test**

Append to `backend/tests/test_schemas.py` (API integration):

```python
def test_api_imports():
    """Verify main.py can import all required schemas."""
    from main import app
    assert app.title == "PathDesigner"
```

This is a smoke test. Detailed API endpoint tests will be added after frontend integration (Task 14).

**Step 2: Update main.py**

Add new imports and endpoints. Modify the `generate-toolpath` and `generate-sbp` endpoints to accept the new request format:

In `backend/main.py`:

1. Add imports:
```python
from nodes.operation_detector import detect_operations
from schemas import (
    ...,
    StockSettings,
    OperationDetectResult,
    OperationAssignment,
)
```

2. Add `POST /api/detect-operations` endpoint:
```python
class DetectOperationsRequest(BaseModel):
    file_id: str
    object_ids: list[str]
    tool_diameter: float = 6.35
    offset_side: str = "outside"

@app.post("/api/detect-operations", response_model=OperationDetectResult)
def detect_operations_endpoint(req: DetectOperationsRequest):
    """Detect machining operations from uploaded STEP file."""
    matches = list(UPLOAD_DIR.glob(f"{req.file_id}.*"))
    if not matches:
        raise HTTPException(status_code=404, detail=f"File not found: {req.file_id}")

    try:
        result = detect_operations(
            step_path=matches[0],
            file_id=req.file_id,
            object_ids=req.object_ids,
            tool_diameter=req.tool_diameter,
            offset_side=req.offset_side,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Operation detection failed: {e}")

    return result
```

3. Update `POST /api/generate-toolpath`:
```python
@app.post("/api/generate-toolpath", response_model=ToolpathGenResult)
def generate_toolpath_endpoint(req: ToolpathGenRequest):
    """Generate toolpath passes from operation assignments."""
    try:
        result = generate_toolpath_from_operations(
            req.operations, req.detected_operations, req.stock
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Toolpath generation failed: {e}")
    return result
```

4. Update `POST /api/generate-sbp`:
```python
@app.post("/api/generate-sbp", response_model=SbpGenResult)
def generate_sbp_endpoint(req: SbpGenRequest):
    """Generate SBP code from toolpath data."""
    try:
        # Get first operation's machining settings for SBP header
        machining = req.operations[0].settings if req.operations else MachiningSettings(...)
        writer = SbpWriter(req.post_processor, machining, req.stock)
        sbp_code = writer.generate(req.toolpath_result.toolpaths)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SBP generation failed: {e}")
    return SbpGenResult(sbp_code=sbp_code, filename="output.sbp")
```

5. Keep existing `/api/extract-contours` endpoint for backward compat (can be removed later).

**Step 3: Run all tests**

Run: `cd backend && uv run python -m pytest -v`
Expected: All existing + new tests pass

**Step 4: Commit**

```bash
git add backend/main.py
git commit -m "Update API endpoints for operation-centric architecture"
```

---

## Task 10: Update frontend TypeScript types

**Files:**
- Modify: `frontend/src/types.ts`

**Step 1: Add new types**

Add to `frontend/src/types.ts`:

```typescript
/** Node 2: Stock Settings types */

export interface StockMaterial {
  material_id: string;
  label: string;
  width: number;
  depth: number;
  thickness: number;
  x_position: number;
  y_position: number;
}

export interface StockSettings {
  materials: StockMaterial[];
}

/** Node 3: Operation Detection types */

export interface OperationGeometry {
  contours: Contour[];
  offset_applied: OffsetApplied;
  depth: number;
}

export interface DetectedOperation {
  operation_id: string;
  object_id: string;
  operation_type: string;
  geometry: OperationGeometry;
  suggested_settings: MachiningSettings;
  enabled: boolean;
}

export interface OperationDetectResult {
  operations: DetectedOperation[];
}

/** Node 4: Operation Editing types */

export interface OperationAssignment {
  operation_id: string;
  material_id: string;
  enabled: boolean;
  settings: MachiningSettings;
  order: number;
}

export interface OperationEditResult {
  assignments: OperationAssignment[];
}
```

Remove `MaterialSettings` interface. Update `PostProcessorSettings` to remove `material` field.

**Step 2: Commit**

```bash
git add frontend/src/types.ts
git commit -m "Update TypeScript types for operation-centric architecture"
```

---

## Task 11: Update frontend api.ts

**Files:**
- Modify: `frontend/src/api.ts`

**Step 1: Add new API functions**

Add to `frontend/src/api.ts`:

```typescript
import type {
  ...,
  OperationDetectResult,
  OperationAssignment,
  StockSettings,
  ToolpathGenResult,
  SbpGenResult,
  PostProcessorSettings,
} from "./types";

export async function detectOperations(
  fileId: string,
  objectIds: string[],
  toolDiameter: number = 6.35,
  offsetSide: string = "outside"
): Promise<OperationDetectResult> {
  const res = await fetch(`${API_URL}/api/detect-operations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_id: fileId,
      object_ids: objectIds,
      tool_diameter: toolDiameter,
      offset_side: offsetSide,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Detection failed" }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function generateToolpath(
  operations: OperationAssignment[],
  detectedOperations: OperationDetectResult,
  stock: StockSettings
): Promise<ToolpathGenResult> {
  const res = await fetch(`${API_URL}/api/generate-toolpath`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operations,
      detected_operations: detectedOperations,
      stock,
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
  operations: OperationAssignment[],
  stock: StockSettings,
  postProcessor: PostProcessorSettings
): Promise<SbpGenResult> {
  const res = await fetch(`${API_URL}/api/generate-sbp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      toolpath_result: toolpathResult,
      operations,
      stock,
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

**Step 2: Commit**

```bash
git add frontend/src/api.ts
git commit -m "Update api.ts with operation-centric API functions"
```

---

## Task 12: Create StockNode

**Files:**
- Create: `frontend/src/nodes/StockNode.tsx`

**Step 1: Implement StockNode**

Create `frontend/src/nodes/StockNode.tsx`. Pattern: settings node (like MachiningSettingsNode) — no input handles, one output handle.

Features:
- List of stock materials with add/remove buttons
- Each material: material_id (auto), label (text), width/depth/thickness (number)
- Sync to `node.data.stockSettings` on change
- Output handle: `{id}-out` with label "stock"

Follow existing `PostProcessorNode.tsx` patterns for styling (nodeStyle, headerStyle, NumberField, etc.).

**Step 2: Commit**

```bash
git add frontend/src/nodes/StockNode.tsx
git commit -m "Add StockNode — stock material definition UI"
```

---

## Task 13: Create OperationNode (compact)

**Files:**
- Create: `frontend/src/nodes/OperationNode.tsx`

**Step 1: Implement OperationNode**

Create `frontend/src/nodes/OperationNode.tsx`. This replaces ContourExtractNode + MachiningSettingsNode + MergeNode.

Features:
- TWO input handles: `{id}-brep` (from STEP Import), `{id}-stock` (from StockNode)
- "Detect Operations" button → calls `detectOperations()` API
- Shows compact summary: "N operations detected / M enabled"
- Per-object summary line: "obj_1: contour ✓"
- "Edit Details..." button → opens side panel (Task 14)
- Stores in `node.data`:
  - `detectedOperations: OperationDetectResult`
  - `assignments: OperationAssignment[]`
- ONE output handle: `{id}-out` with label "operations"

Read upstream data:
- From brep handle: `node.data.brepResult` (file_id, objects array)
- From stock handle: `node.data.stockSettings` (materials array)

Auto-assign: When detecting, auto-assign each object to the first stock material and create default OperationAssignment per detected operation.

**Step 2: Commit**

```bash
git add frontend/src/nodes/OperationNode.tsx
git commit -m "Add OperationNode — compact operation detection and summary"
```

---

## Task 14: Create OperationDetailPanel (side panel)

**Files:**
- Create: `frontend/src/components/OperationDetailPanel.tsx`

**Step 1: Implement side panel**

Create `frontend/src/components/OperationDetailPanel.tsx`.

Features:
- Overlay panel that slides in from the right (or renders in fixed sidebar area)
- Shows when OperationNode's "Edit Details..." is clicked
- Close button to dismiss
- Per-object accordion:
  - Material assignment dropdown
  - List of operations with toggle (enabled/disabled)
  - Click operation → expand to show MachiningSettings fields
  - Preset selector per operation
- "Add Custom Operation" button (future, disabled in v1)
- Validation: warn if stock.thickness < object.thickness

State: receives `detectedOperations`, `assignments`, `stockSettings` as props. Calls `onAssignmentsChange` callback to update parent OperationNode.

**Step 2: Commit**

```bash
git add frontend/src/components/OperationDetailPanel.tsx
git commit -m "Add OperationDetailPanel — side panel for detailed operation editing"
```

---

## Task 15: Update PostProcessorNode

**Files:**
- Modify: `frontend/src/nodes/PostProcessorNode.tsx`

**Step 1: Remove Material section**

1. Remove `material` from `DEFAULT_SETTINGS`
2. Remove the "Material" SectionHeader and its content
3. Remove `openSections.material` state
4. Update `PostProcessorSettings` usage (no `material` field)

**Step 2: Verify it compiles**

Run: `cd frontend && npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add frontend/src/nodes/PostProcessorNode.tsx
git commit -m "Remove Material section from PostProcessorNode"
```

---

## Task 16: Update ToolpathGenNode

**Files:**
- Modify: `frontend/src/nodes/ToolpathGenNode.tsx`

**Step 1: Update input handles**

Change from 3 handles (contour, settings, postprocessor) to 3 handles (operations, stock, postprocessor):

- `{id}-operations` — from OperationNode (reads `detectedOperations` + `assignments`)
- `{id}-stock` — from StockNode (reads `stockSettings`)
- `{id}-postprocessor` — from PostProcessorNode (reads `postProcessorSettings`)

Update the generate flow:
1. Read `detectedOperations` and `assignments` from operations node
2. Read `stockSettings` from stock node
3. Read `postProcessorSettings` from postprocessor node
4. Call `generateToolpath(assignments, detectedOperations, stockSettings)`
5. Call `generateSbp(toolpathResult, assignments, stockSettings, postProcessorSettings)`

**Step 2: Commit**

```bash
git add frontend/src/nodes/ToolpathGenNode.tsx
git commit -m "Update ToolpathGenNode for operation-centric input"
```

---

## Task 17: Update App.tsx and Sidebar.tsx

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/Sidebar.tsx`

**Step 1: Update node registration**

In `App.tsx`:

```typescript
import StockNode from "./nodes/StockNode";
import OperationNode from "./nodes/OperationNode";
import PostProcessorNode from "./nodes/PostProcessorNode";
import ToolpathGenNode from "./nodes/ToolpathGenNode";

const nodeTypes = {
  brepImport: BrepImportNode,
  stock: StockNode,
  operation: OperationNode,
  postProcessor: PostProcessorNode,
  toolpathGen: ToolpathGenNode,
  debug: DebugNode,
};
```

**Step 2: Update initial nodes and edges**

```typescript
const initialNodes = [
  { id: "1", type: "brepImport", position: { x: 100, y: 100 }, data: {} },
  { id: "2", type: "stock", position: { x: 400, y: 100 }, data: {} },
  { id: "3", type: "operation", position: { x: 100, y: 350 }, data: {} },
  { id: "5", type: "postProcessor", position: { x: 400, y: 350 }, data: {} },
  { id: "6", type: "toolpathGen", position: { x: 250, y: 600 }, data: {} },
  { id: "7", type: "default", position: { x: 250, y: 800 }, data: { label: "Preview" } },
];

const initialEdges = [
  { id: "e1-3", source: "1", sourceHandle: "1-out", target: "3", targetHandle: "3-brep" },
  { id: "e2-3", source: "2", sourceHandle: "2-out", target: "3", targetHandle: "3-stock" },
  { id: "e3-6", source: "3", sourceHandle: "3-out", target: "6", targetHandle: "6-operations" },
  { id: "e2-6", source: "2", sourceHandle: "2-out", target: "6", targetHandle: "6-stock" },
  { id: "e5-6", source: "5", sourceHandle: "5-out", target: "6", targetHandle: "6-postprocessor" },
  { id: "e6-7", source: "6", sourceHandle: "6-out", target: "7" },
];
```

Remove old nodes: contourExtract, machiningSettings, merge (ids 2, 3, 4).

**Step 3: Update Sidebar**

In `Sidebar.tsx`:

```typescript
const nodeItems = [
  { type: "brepImport", label: "BREP Import", color: "#4a90d9" },
  { type: "stock", label: "Stock", color: "#ff9800" },
  { type: "operation", label: "Operation", color: "#7b61ff" },
  { type: "postProcessor", label: "Post Processor", color: "#66bb6a" },
  { type: "toolpathGen", label: "Toolpath Gen", color: "#ef5350" },
  { type: "debug", label: "Debug", color: "#4fc3f7" },
] as const;
```

**Step 4: Verify**

Run: `cd frontend && npm run build`
Expected: No errors

**Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/Sidebar.tsx
git commit -m "Update App.tsx and Sidebar for operation-centric node layout"
```

---

## Task 18: Remove obsolete files

**Files:**
- Remove: `frontend/src/nodes/ContourExtractNode.tsx`
- Remove: `frontend/src/nodes/MachiningSettingsNode.tsx`

**Step 1: Verify no imports reference these files**

Search for imports of `ContourExtractNode` and `MachiningSettingsNode` in all .tsx/.ts files. They should only be imported in App.tsx (now updated).

**Step 2: Delete files**

```bash
git rm frontend/src/nodes/ContourExtractNode.tsx
git rm frontend/src/nodes/MachiningSettingsNode.tsx
git commit -m "Remove obsolete ContourExtractNode and MachiningSettingsNode"
```

---

## Task 19: Integration test — full pipeline

**Files:**
- Modify: `backend/tests/test_operation_detector.py`

**Step 1: Add end-to-end test**

Append to `backend/tests/test_operation_detector.py`:

```python
from nodes.toolpath_gen import generate_toolpath_from_operations
from sbp_writer import SbpWriter
from schemas import (
    OperationAssignment, StockMaterial, StockSettings,
    PostProcessorSettings, ToolpathGenResult,
)


def test_full_pipeline_detect_to_sbp(simple_box_step: Path):
    """Full pipeline: STEP → detect operations → toolpath → SBP."""
    # 1. Detect operations
    detected = detect_operations(
        step_path=simple_box_step,
        file_id="test",
        object_ids=["obj_001"],
        tool_diameter=6.35,
        offset_side="outside",
    )
    assert len(detected.operations) == 1

    # 2. Create assignments
    op = detected.operations[0]
    stock = StockSettings(
        materials=[StockMaterial(material_id="mtl_1", thickness=12)]
    )
    assignments = [
        OperationAssignment(
            operation_id=op.operation_id,
            material_id="mtl_1",
            settings=op.suggested_settings,
            order=1,
        )
    ]

    # 3. Generate toolpath
    tp_result = generate_toolpath_from_operations(assignments, detected, stock)
    assert len(tp_result.toolpaths) >= 1

    # 4. Generate SBP
    post = PostProcessorSettings()
    writer = SbpWriter(
        settings=post,
        machining=assignments[0].settings,
        stock=stock,
    )
    sbp = writer.generate(tp_result.toolpaths)

    assert "'SHOPBOT ROUTER FILE IN MM" in sbp
    assert "M3," in sbp  # Has cutting moves
    assert "mtl_1" in sbp  # Has material metadata
    assert "END" in sbp
```

**Step 2: Run test**

Run: `cd backend && uv run python -m pytest tests/test_operation_detector.py::test_full_pipeline_detect_to_sbp -v`
Expected: PASS

**Step 3: Run all tests**

Run: `cd backend && uv run python -m pytest -v`
Expected: All pass

**Step 4: Commit**

```bash
git add backend/tests/test_operation_detector.py
git commit -m "Add full pipeline integration test (detect → toolpath → SBP)"
```

---

## Task 20: Manual verification

**Step 1: Start the app**

Run: `make dev` (from project root)

**Step 2: Verify canvas**

- STEP Import node present
- Stock node present (with material list UI)
- Operation node present (with "Detect Operations" button)
- Post Processor node present (no Material section)
- Toolpath Gen node present
- Edges connect correctly

**Step 3: Test the full flow**

1. Upload a STEP file via BREP Import node
2. Click "Detect Operations" on Operation node → should detect contour(s)
3. (Optional) Edit details via side panel
4. Click "Generate" on Toolpath Gen node → should produce SBP
5. Download SBP file

**Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "Fix integration issues from manual testing"
```

---

## Summary

| Task | Description | Est. Steps |
|------|-------------|-----------|
| 0 | Merge Phase 4, create branch | 3 |
| 1 | StockMaterial/StockSettings schemas | 5 |
| 2 | Operation Detection schemas | 5 |
| 3 | OperationAssignment schemas | 5 |
| 4 | Remove material from PostProcessor | 5 |
| 5 | Update ToolpathGenRequest/SbpGenRequest | 5 |
| 6 | Create operation_detector.py | 5 |
| 7 | Update toolpath_gen.py | 5 |
| 8 | Update sbp_writer.py | 5 |
| 9 | Update API endpoints | 4 |
| 10 | Frontend TypeScript types | 2 |
| 11 | Frontend api.ts | 2 |
| 12 | StockNode component | 2 |
| 13 | OperationNode (compact) | 2 |
| 14 | OperationDetailPanel (side panel) | 2 |
| 15 | Update PostProcessorNode | 3 |
| 16 | Update ToolpathGenNode | 2 |
| 17 | Update App.tsx + Sidebar.tsx | 5 |
| 18 | Remove obsolete files | 2 |
| 19 | Integration test | 4 |
| 20 | Manual verification | 4 |
