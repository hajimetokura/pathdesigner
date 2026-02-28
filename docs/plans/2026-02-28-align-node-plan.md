# AlignNode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 組み立て状態の Compound 内の各 Solid を、最大面が底面になるよう自動回転し、CNC 加工用に再解析する AlignNode を追加する。

**Architecture:** バックエンドに `nodes/align.py`（回転ロジック）+ `/api/align-parts` エンドポイントを追加。フロントエンドに `AlignNode.tsx`（自動実行パススルー）を追加。出力は既存の `BrepImportResult` 形式で、PreviewNode/PlacementNode がそのまま使える。

**Tech Stack:** build123d (Solid回転), FastAPI, React Flow, TypeScript

---

### Task 1: バックエンド — align.py の回転ロジック

**Files:**
- Create: `backend/nodes/align.py`
- Test: `backend/tests/test_align.py`

**Step 1: Write the failing test**

Create `backend/tests/test_align.py`:

```python
"""Tests for align node — flatten assembled solids for CNC."""

import pytest
from build123d import Box, Pos, Compound, Solid

from nodes.align import align_solids


def test_flat_box_unchanged():
    """A flat box (X > Z) should stay roughly the same orientation."""
    flat = Box(100, 50, 10)
    results = align_solids([flat])
    assert len(results) == 1
    bb = results[0].bounding_box()
    # Thickness (smallest dim) should be Z
    assert bb.size.Z == pytest.approx(10, abs=0.5)
    assert bb.size.X == pytest.approx(100, abs=0.5)
    # Bottom should sit at Z=0
    assert bb.min.Z == pytest.approx(0, abs=0.1)


def test_standing_panel_gets_laid_flat():
    """A vertical panel (thin in X) should be rotated so thin dim becomes Z."""
    # 18mm thick, 300 deep, 600 tall → standing panel
    standing = Box(18, 300, 600)
    results = align_solids([standing])
    assert len(results) == 1
    bb = results[0].bounding_box()
    # After alignment, Z should be the thinnest dimension (18mm)
    assert bb.size.Z == pytest.approx(18, abs=0.5)
    assert bb.min.Z == pytest.approx(0, abs=0.1)


def test_multiple_solids():
    """Multiple solids should all be aligned independently."""
    flat = Box(100, 50, 10)
    standing = Box(18, 300, 600)
    results = align_solids([flat, standing])
    assert len(results) == 2
    for r in results:
        bb = r.bounding_box()
        assert bb.min.Z == pytest.approx(0, abs=0.1)


def test_compound_solids_from_furniture():
    """Simulate a simple shelf: side panels + shelves in assembled position."""
    t = 18
    shelf = Box(400, 300, t)
    side = Box(t, 300, 600)

    top = Pos(200 + t/2, 0, 600 - t/2) * shelf
    bottom = Pos(200 + t/2, 0, t/2) * shelf
    left = Pos(0, 0, 300) * side
    right = Pos(400 + t, 0, 300) * side

    compound = Compound(children=[left, right, top, bottom])
    solids = list(compound.solids())
    results = align_solids(solids)

    assert len(results) == 4
    for r in results:
        bb = r.bounding_box()
        # All pieces should have Z = 18 (board thickness)
        assert bb.size.Z == pytest.approx(18, abs=1.0)
        # All should sit at Z=0
        assert bb.min.Z == pytest.approx(0, abs=0.1)
```

**Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_align.py -v`
Expected: FAIL with "ModuleNotFoundError: No module named 'nodes.align'"

**Step 3: Write minimal implementation**

Create `backend/nodes/align.py`:

```python
"""Align Node — rotate assembled solids so largest face becomes bottom for CNC."""

from __future__ import annotations

import math

from build123d import Axis, GeomType, Solid, Vector, Location


def align_solids(solids: list[Solid]) -> list[Solid]:
    """Rotate each solid so its largest face is the bottom, then place at Z=0."""
    return [_align_single(s) for s in solids]


def _align_single(solid: Solid) -> Solid:
    """Align a single solid: largest face → bottom (Z-), sit on Z=0."""
    normal = _find_largest_face_normal(solid)

    # Target: normal should point -Z (largest face on bottom)
    target = Vector(0, 0, -1)

    rotated = _rotate_solid_to_target(solid, normal, target)

    # Translate so bottom sits at Z=0
    bb = rotated.bounding_box()
    shifted = rotated.move(Location((0, 0, -bb.min.Z)))

    return shifted


def _find_largest_face_normal(solid: Solid) -> Vector:
    """Return the outward normal of the face with the largest area."""
    faces = solid.faces()
    if not faces:
        return Vector(0, 0, -1)

    largest = max(faces, key=lambda f: f.area)
    return Vector(largest.normal_at().to_tuple())


def _rotate_solid_to_target(solid: Solid, current: Vector, target: Vector) -> Solid:
    """Rotate solid so that `current` direction aligns with `target`."""
    # Normalize
    c = current.normalized()
    t = target.normalized()

    dot = c.dot(t)

    # Already aligned
    if dot > 0.9999:
        return solid

    # Opposite direction — rotate 180° around any perpendicular axis
    if dot < -0.9999:
        # Pick X or Y axis, whichever is more perpendicular
        if abs(c.X) < 0.9:
            axis = Axis.X
        else:
            axis = Axis.Y
        return solid.rotate(Axis.X if abs(c.X) < 0.9 else Axis.Y, 180)

    # General case: rotate around cross product axis
    cross = c.cross(t)
    angle = math.degrees(math.acos(max(-1, min(1, dot))))

    # Create rotation axis through origin
    rotation_axis = Axis((0, 0, 0), (cross.X, cross.Y, cross.Z))
    return solid.rotate(rotation_axis, angle)
```

**Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_align.py -v`
Expected: All 4 tests PASS

**Step 5: Commit**

```bash
git add backend/nodes/align.py backend/tests/test_align.py
git commit -m "feat: add align_solids logic to rotate parts flat for CNC"
```

---

### Task 2: バックエンド — /api/align-parts エンドポイント

**Files:**
- Modify: `backend/main.py` (エンドポイント追加)
- Modify: `backend/schemas.py` (リクエストスキーマ追加)
- Test: `backend/tests/test_align.py` (API テスト追加)

**Step 1: Write the failing test**

Append to `backend/tests/test_align.py`:

```python
import tempfile
from pathlib import Path
from build123d import export_step
from fastapi.testclient import TestClient
from main import app


@pytest.fixture
def client():
    return TestClient(app)


def _upload_furniture_step(client) -> str:
    """Helper: create a furniture compound STEP, upload it, return file_id."""
    t = 18
    shelf = Box(400, 300, t)
    side = Box(t, 300, 600)
    top = Pos(200 + t/2, 0, 600 - t/2) * shelf
    left = Pos(0, 0, 300) * side
    compound = Compound(children=[left, top])

    with tempfile.NamedTemporaryFile(suffix=".step", delete=False) as f:
        export_step(compound, f.name)
        step_bytes = Path(f.name).read_bytes()

    resp = client.post(
        "/api/upload-step",
        files={"file": ("test.step", step_bytes, "application/octet-stream")},
    )
    assert resp.status_code == 200
    return resp.json()["file_id"]


def test_align_parts_endpoint(client):
    """POST /api/align-parts should return re-analyzed flat parts."""
    file_id = _upload_furniture_step(client)

    resp = client.post("/api/align-parts", json={"file_id": file_id})
    assert resp.status_code == 200

    data = resp.json()
    assert "file_id" in data
    assert data["file_id"] != file_id  # New file_id for aligned STEP
    assert len(data["objects"]) == 2

    for obj in data["objects"]:
        # All parts should have thickness ≈ 18mm (Z after alignment)
        assert obj["bounding_box"]["z"] == pytest.approx(18, abs=1.0)


def test_align_parts_file_not_found(client):
    """Should return 404 for unknown file_id."""
    resp = client.post("/api/align-parts", json={"file_id": "nonexistent"})
    assert resp.status_code == 404
```

**Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_align.py::test_align_parts_endpoint -v`
Expected: FAIL with 404 (endpoint doesn't exist yet)

**Step 3: Add schema and endpoint**

Add to `backend/schemas.py` (near other request schemas):

```python
class AlignPartsRequest(BaseModel):
    file_id: str
```

Add to `backend/main.py`:

Import at top:
```python
from nodes.align import align_solids
```

Add to schemas import:
```python
AlignPartsRequest,
```

Add endpoint (after `/api/upload-step`):
```python
@app.post("/api/align-parts", response_model=BrepImportResult)
def align_parts_endpoint(req: AlignPartsRequest):
    """Rotate assembled parts flat for CNC and re-analyze."""
    step_path = _get_uploaded_step_path(req.file_id)

    try:
        compound = import_step(str(step_path))
        solids = list(compound.solids())
        if not solids:
            raise HTTPException(status_code=422, detail="No solids found")

        aligned = align_solids(solids)

        # Export aligned solids as new STEP
        new_compound = Compound(children=aligned)
        new_file_id = uuid.uuid4().hex[:12]
        new_path = UPLOAD_DIR / f"{new_file_id}.step"
        export_step(new_compound, str(new_path))

        # Re-analyze each aligned solid
        from nodes.brep_import import _analyze_solid
        objects = [
            _analyze_solid(s, index=i, file_name="aligned.step")
            for i, s in enumerate(aligned)
        ]

        return BrepImportResult(
            file_id=new_file_id,
            objects=objects,
            object_count=len(objects),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Align failed: {e}")
```

Add import to main.py top:
```python
from build123d import import_step, Compound, export_step as bd_export_step
```

Note: `import_step` と `export_step` は brep_import.py 経由ではなく直接 import する。既存の `from nodes.brep_import import analyze_step_file` はそのまま。

**Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_align.py -v`
Expected: All 6 tests PASS

**Step 5: Commit**

```bash
git add backend/main.py backend/schemas.py backend/tests/test_align.py
git commit -m "feat: add /api/align-parts endpoint"
```

---

### Task 3: フロントエンド — API 関数追加

**Files:**
- Modify: `frontend/src/api.ts`

**Step 1: Add alignParts function**

Add to `frontend/src/api.ts`:

```typescript
export async function alignParts(fileId: string): Promise<BrepImportResult> {
  return requestJson<BrepImportResult>(
    `${API_BASE_URL}/api/align-parts`,
    jsonPost({ file_id: fileId }),
    "Align failed",
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/api.ts
git commit -m "feat: add alignParts API function"
```

---

### Task 4: フロントエンド — AlignNode コンポーネント

**Files:**
- Create: `frontend/src/nodes/AlignNode.tsx`
- Modify: `frontend/src/nodeRegistry.ts` (登録)

**Step 1: Create AlignNode.tsx**

```typescript
import { memo, useState, useEffect } from "react";
import { type NodeProps, useReactFlow } from "@xyflow/react";
import LabeledHandle from "./LabeledHandle";
import NodeShell from "../components/NodeShell";
import { useUpstreamData } from "../hooks/useUpstreamData";
import { alignParts } from "../api";
import type { BrepImportResult } from "../types";

function AlignNodeInner({ id, selected }: NodeProps) {
  const { setNodes } = useReactFlow();

  const brepResult = useUpstreamData<BrepImportResult>(
    id,
    `${id}-brep`,
    (d) => d.brepResult as BrepImportResult | undefined,
  );

  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [partCount, setPartCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!brepResult?.file_id) {
      setStatus("idle");
      setPartCount(0);
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, brepResult: null } } : n,
        ),
      );
      return;
    }

    let cancelled = false;
    setStatus("processing");
    setErrorMsg(null);

    alignParts(brepResult.file_id)
      .then((result) => {
        if (cancelled) return;
        setStatus("done");
        setPartCount(result.object_count);
        setNodes((nds) =>
          nds.map((n) =>
            n.id === id ? { ...n, data: { ...n.data, brepResult: result } } : n,
          ),
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : "Align failed");
      });

    return () => { cancelled = true; };
  }, [id, brepResult, setNodes]);

  return (
    <NodeShell category="cam" selected={selected}>
      <LabeledHandle type="target" id={`${id}-brep`} label="brep" dataType="geometry" />

      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, color: "var(--text-primary)" }}>
        Align
      </div>

      <div style={{ fontSize: 11, color: "var(--text-secondary)", minHeight: 20 }}>
        {status === "idle" && "Connect upstream node"}
        {status === "processing" && "Aligning parts..."}
        {status === "done" && `${partCount} parts aligned`}
        {status === "error" && (
          <span style={{ color: "var(--color-error)" }}>{errorMsg}</span>
        )}
      </div>

      <LabeledHandle type="source" id={`${id}-out`} label="out" dataType="geometry" />
    </NodeShell>
  );
}

const AlignNode = memo(AlignNodeInner);
export default AlignNode;
```

**Step 2: Register in nodeRegistry.ts**

Add import:
```typescript
import AlignNode from "./nodes/AlignNode";
```

Add to `NODE_REGISTRY`:
```typescript
align: { component: AlignNode, label: "Align", category: "cam" },
```

**Step 3: Commit**

```bash
git add frontend/src/nodes/AlignNode.tsx frontend/src/nodeRegistry.ts
git commit -m "feat: add AlignNode frontend component"
```

---

### Task 5: 結合テスト — make dev で動作確認

**Step 1: Start dev servers**

Run: `make dev`

**Step 2: Manual test**

1. サイドバーから CodeNode をキャンバスに追加
2. 棚のコード（設計書のサンプル）を実行
3. サイドバーから AlignNode を追加
4. CodeNode → AlignNode をエッジで接続
5. 自動的に API が呼ばれ「4 parts aligned」と表示されることを確認
6. AlignNode → PreviewNode を接続し、寝かせた状態の3Dプレビューを確認
7. AlignNode → PlacementNode を接続し、各パーツがシートに配置できることを確認

**Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration adjustments for AlignNode"
```
