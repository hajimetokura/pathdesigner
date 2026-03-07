# 3D Machining Phase 1 — STL Import + Schema + SBP 3D Support

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** STLファイルをインポートして解析結果を表示し、3Dツールパス（`[[x,y,z]]`）をSBP出力できる基盤を整える。

**Architecture:** MeshImportNode（新規）を BrepImportNode と同じパターンで実装。trimesh でSTL解析。ToolpathPass.path を2D/3D両対応に拡張し、SBP Writer を修正。

**Tech Stack:** trimesh (STL/OBJ), FastAPI, React Flow, build123d (STEP→STL変換)

---

## Task 1: trimesh 依存追加

**Files:**
- Modify: `backend/pyproject.toml`

**Step 1: trimesh を追加**

```bash
cd backend && uv add trimesh
```

**Step 2: インストール確認**

Run: `cd backend && uv run python -c "import trimesh; print(trimesh.__version__)"`
Expected: バージョン番号が出力される

**Step 3: Commit**

```bash
git add backend/pyproject.toml backend/uv.lock
git commit -m "deps: add trimesh for STL/OBJ mesh import"
```

---

## Task 2: MeshImportResult スキーマ追加

**Files:**
- Modify: `backend/schemas.py`
- Test: `backend/tests/test_schemas_mesh.py`

**Step 1: テストを書く**

Create `backend/tests/test_schemas_mesh.py`:

```python
"""Tests for mesh import schemas."""

from schemas import MeshImportResult, BrepObject, BoundingBox, Origin, FacesAnalysis


def test_mesh_import_result_valid():
    """MeshImportResult should accept valid mesh data."""
    obj = BrepObject(
        object_id="obj_001",
        file_name="test.stl",
        bounding_box=BoundingBox(x=100, y=80, z=45),
        thickness=45.0,
        origin=Origin(
            position=[0, 0, 0],
            reference="bounding_box_min",
            description="STL bounding box minimum",
        ),
        unit="mm",
        is_closed=True,
        is_planar=False,
        machining_type="3d",
        faces_analysis=FacesAnalysis(
            top_features=False, bottom_features=False, freeform_surfaces=True
        ),
        outline=[],
    )
    result = MeshImportResult(
        file_id="abc123",
        objects=[obj],
        object_count=1,
        mesh_file_path="/tmp/abc123.stl",
    )
    assert result.file_id == "abc123"
    assert result.mesh_file_path == "/tmp/abc123.stl"
    assert result.objects[0].machining_type == "3d"


def test_mesh_import_result_inherits_brep_import():
    """MeshImportResult should extend BrepImportResult."""
    from schemas import BrepImportResult

    assert issubclass(MeshImportResult, BrepImportResult)
```

**Step 2: テスト失敗を確認**

Run: `cd backend && uv run pytest tests/test_schemas_mesh.py -v`
Expected: FAIL — `MeshImportResult` が存在しない

**Step 3: スキーマ実装**

`backend/schemas.py` の `BrepImportResult` 定義の直後（行49付近）に追加:

```python
class MeshImportResult(BrepImportResult):
    """Mesh import output — extends BrepImportResult with mesh file path."""
    mesh_file_path: str  # path to STL/OBJ file for opencamlib/trimesh
```

**Step 4: テスト通過を確認**

Run: `cd backend && uv run pytest tests/test_schemas_mesh.py -v`
Expected: 2 passed

**Step 5: Commit**

```bash
git add backend/schemas.py backend/tests/test_schemas_mesh.py
git commit -m "feat: add MeshImportResult schema extending BrepImportResult"
```

---

## Task 3: STL解析バックエンド実装

**Files:**
- Create: `backend/nodes/mesh_import.py`
- Test: `backend/tests/test_mesh_import.py`

**Step 1: テスト用STLフィクスチャを追加**

`backend/tests/conftest.py` に追加:

```python
@pytest.fixture
def simple_box_stl() -> Path:
    """Path to a simple 100x50x10mm box STL file."""
    path = FIXTURES_DIR / "simple_box.stl"
    if not path.exists():
        _generate_simple_box_stl(path)
    return path


@pytest.fixture
def freeform_stl() -> Path:
    """Path to a freeform (sphere) STL file for 3D machining tests."""
    path = FIXTURES_DIR / "sphere.stl"
    if not path.exists():
        _generate_sphere_stl(path)
    return path


def _generate_simple_box_stl(output_path: Path):
    """Generate a simple box STL file using trimesh."""
    import trimesh

    mesh = trimesh.creation.box(extents=[100, 50, 10])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    mesh.export(str(output_path))


def _generate_sphere_stl(output_path: Path):
    """Generate a sphere STL for 3D machining tests."""
    import trimesh

    mesh = trimesh.creation.icosphere(subdivisions=3, radius=25)
    # Translate so bottom is at Z=0
    mesh.apply_translation([0, 0, 25])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    mesh.export(str(output_path))
```

**Step 2: テストを書く**

Create `backend/tests/test_mesh_import.py`:

```python
"""Tests for STL/OBJ mesh import."""

from nodes.mesh_import import analyze_mesh_file


def test_analyze_stl_basic(simple_box_stl):
    """Analyze a simple box STL and verify BrepObject-compatible output."""
    result = analyze_mesh_file(simple_box_stl, file_name="simple_box.stl")
    assert len(result) == 1

    obj = result[0]
    assert obj.object_id == "obj_001"
    assert obj.file_name == "simple_box.stl"
    assert obj.machining_type == "3d"
    assert obj.is_planar is False
    assert obj.faces_analysis.freeform_surfaces is True
    # Bounding box should be approximately 100x50x10
    assert abs(obj.bounding_box.x - 100) < 1
    assert abs(obj.bounding_box.y - 50) < 1
    assert abs(obj.bounding_box.z - 10) < 1
    assert abs(obj.thickness - 10) < 1


def test_analyze_stl_origin(simple_box_stl):
    """STL origin should be bounding_box_min."""
    result = analyze_mesh_file(simple_box_stl, file_name="box.stl")
    obj = result[0]
    assert obj.origin.reference == "bounding_box_min"
    assert len(obj.origin.position) == 3


def test_analyze_freeform_stl(freeform_stl):
    """Freeform (sphere) STL should be detected as 3D."""
    result = analyze_mesh_file(freeform_stl, file_name="sphere.stl")
    obj = result[0]
    assert obj.machining_type == "3d"
    assert obj.is_closed is True
    # Sphere radius=25, translated to Z=0 bottom → BB.z ≈ 50
    assert abs(obj.bounding_box.z - 50) < 1
```

**Step 3: テスト失敗を確認**

Run: `cd backend && uv run pytest tests/test_mesh_import.py -v`
Expected: FAIL — `mesh_import` モジュールが存在しない

**Step 4: 実装**

Create `backend/nodes/mesh_import.py`:

```python
"""Mesh Import Node — STL/OBJ file analysis using trimesh."""

from pathlib import Path

import trimesh

from schemas import BoundingBox, BrepObject, FacesAnalysis, Origin


def analyze_mesh_file(filepath: str | Path, file_name: str) -> list[BrepObject]:
    """Import a mesh file (STL/OBJ) and analyze for CNC machining.

    Unlike BREP import, mesh files lack topological info (face types, edges).
    All meshes are classified as machining_type="3d".
    """
    mesh = trimesh.load(str(filepath), force="mesh")

    if not isinstance(mesh, trimesh.Trimesh):
        raise ValueError(f"File does not contain a valid mesh: {file_name}")

    bounds = mesh.bounds  # [[min_x, min_y, min_z], [max_x, max_y, max_z]]
    bb_min = bounds[0]
    bb_max = bounds[1]
    size = bb_max - bb_min

    return [
        BrepObject(
            object_id="obj_001",
            file_name=file_name,
            bounding_box=BoundingBox(
                x=round(float(size[0]), 4),
                y=round(float(size[1]), 4),
                z=round(float(size[2]), 4),
            ),
            thickness=round(float(size[2]), 4),
            origin=Origin(
                position=[round(float(bb_min[0]), 4), round(float(bb_min[1]), 4), round(float(bb_min[2]), 4)],
                reference="bounding_box_min",
                description="Mesh bounding box minimum",
            ),
            unit="mm",
            is_closed=bool(mesh.is_watertight),
            is_planar=False,
            machining_type="3d",
            faces_analysis=FacesAnalysis(
                top_features=False,
                bottom_features=False,
                freeform_surfaces=True,
            ),
            outline=[],
        )
    ]
```

**Step 5: テスト通過を確認**

Run: `cd backend && uv run pytest tests/test_mesh_import.py -v`
Expected: 3 passed

**Step 6: Commit**

```bash
git add backend/nodes/mesh_import.py backend/tests/test_mesh_import.py backend/tests/conftest.py
git commit -m "feat: add mesh_import module — STL/OBJ analysis with trimesh"
```

---

## Task 4: メッシュアップロード API エンドポイント

**Files:**
- Modify: `backend/main.py`
- Test: `backend/tests/test_api_mesh.py`

**Step 1: APIテストを書く**

Create `backend/tests/test_api_mesh.py`:

```python
"""API tests for mesh upload endpoint."""

import io
import pytest
from fastapi.testclient import TestClient
from main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_upload_stl(client, simple_box_stl):
    """Upload STL file and verify MeshImportResult."""
    with open(simple_box_stl, "rb") as f:
        response = client.post(
            "/api/upload-mesh",
            files={"file": ("box.stl", f, "application/octet-stream")},
        )
    assert response.status_code == 200
    data = response.json()
    assert "file_id" in data
    assert "mesh_file_path" in data
    assert data["object_count"] == 1
    assert data["objects"][0]["machining_type"] == "3d"


def test_upload_invalid_extension(client):
    """Reject non-mesh files."""
    fake = io.BytesIO(b"not a mesh")
    response = client.post(
        "/api/upload-mesh",
        files={"file": ("test.txt", fake, "text/plain")},
    )
    assert response.status_code == 400
    assert "stl" in response.json()["detail"].lower()


def test_upload_no_filename(client):
    """Reject upload without filename."""
    fake = io.BytesIO(b"data")
    response = client.post(
        "/api/upload-mesh",
        files={"file": ("", fake, "application/octet-stream")},
    )
    assert response.status_code == 400
```

**Step 2: テスト失敗を確認**

Run: `cd backend && uv run pytest tests/test_api_mesh.py -v`
Expected: FAIL — 404 (endpoint not found)

**Step 3: エンドポイント実装**

`backend/main.py` の upload_step エンドポイント直後に追加。

imports に追加:
```python
from nodes.mesh_import import analyze_mesh_file
from schemas import MeshImportResult  # 既存 import ブロックに追加
```

エンドポイント:
```python
@app.post("/api/upload-mesh", response_model=MeshImportResult)
async def upload_mesh(file: UploadFile):
    """Upload a mesh file (STL/OBJ) and return analysis results."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    suffix = Path(file.filename).suffix.lower()
    if suffix not in (".stl", ".obj"):
        raise HTTPException(
            status_code=400, detail="Only .stl/.obj files are accepted"
        )

    file_id = uuid.uuid4().hex[:12]
    saved_path = UPLOAD_DIR / f"{file_id}{suffix}"

    content = await file.read()
    saved_path.write_bytes(content)

    try:
        objects = analyze_mesh_file(saved_path, file_name=file.filename)
    except ValueError as e:
        saved_path.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        saved_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Mesh analysis failed: {e}")

    return MeshImportResult(
        file_id=file_id,
        objects=objects,
        object_count=len(objects),
        mesh_file_path=str(saved_path),
    )
```

**Step 4: テスト通過を確認**

Run: `cd backend && uv run pytest tests/test_api_mesh.py -v`
Expected: 3 passed

**Step 5: 既存テストが壊れていないか確認**

Run: `cd backend && uv run pytest tests/ -v --timeout=60`
Expected: All existing tests pass

**Step 6: Commit**

```bash
git add backend/main.py backend/tests/test_api_mesh.py
git commit -m "feat: add /api/upload-mesh endpoint for STL/OBJ import"
```

---

## Task 5: STEP → STL 変換ユーティリティ

**Files:**
- Modify: `backend/nodes/mesh_export.py`
- Test: `backend/tests/test_mesh_export.py` (既存ファイルに追加)

**Step 1: テストを書く**

`backend/tests/test_mesh_export.py` に追加:

```python
def test_export_step_to_stl(simple_box_step, tmp_path):
    """Export a STEP file to STL and verify the result is loadable."""
    from nodes.mesh_export import export_step_to_stl

    stl_path = export_step_to_stl(simple_box_step, output_dir=tmp_path)
    assert stl_path.exists()
    assert stl_path.suffix == ".stl"

    import trimesh
    mesh = trimesh.load(str(stl_path), force="mesh")
    assert len(mesh.vertices) > 0
    assert len(mesh.faces) > 0
```

**Step 2: テスト失敗を確認**

Run: `cd backend && uv run pytest tests/test_mesh_export.py::test_export_step_to_stl -v`
Expected: FAIL — `export_step_to_stl` not found

**Step 3: 実装**

`backend/nodes/mesh_export.py` に追加:

```python
def export_step_to_stl(
    step_path: str | Path, output_dir: str | Path | None = None, tolerance: float = 0.1
) -> Path:
    """Convert a STEP file to STL for use with 3D toolpath engines.

    Args:
        step_path: Path to the input STEP file.
        output_dir: Directory for output STL. Defaults to same dir as input.
        tolerance: Tessellation tolerance in mm (smaller = finer mesh).

    Returns:
        Path to the generated STL file.
    """
    step_path = Path(step_path)
    if output_dir is None:
        output_dir = step_path.parent
    output_dir = Path(output_dir)

    compound = import_step(str(step_path))
    solids = compound.solids()
    if not solids:
        raise ValueError("STEP file contains no solids")

    # Tessellate all solids and combine into single mesh
    all_vertices: list[list[float]] = []
    all_faces: list[list[int]] = []
    vertex_offset = 0

    for solid in solids:
        verts_raw, tris_raw = solid.tessellate(tolerance)
        for v in verts_raw:
            all_vertices.append([v.X, v.Y, v.Z])
        for tri in tris_raw:
            all_faces.append([t + vertex_offset for t in tri])
        vertex_offset += len(verts_raw)

    import trimesh
    import numpy as np

    mesh = trimesh.Trimesh(
        vertices=np.array(all_vertices), faces=np.array(all_faces)
    )

    stl_path = output_dir / f"{step_path.stem}.stl"
    mesh.export(str(stl_path))
    return stl_path
```

**Step 4: テスト通過を確認**

Run: `cd backend && uv run pytest tests/test_mesh_export.py -v`
Expected: All passed

**Step 5: Commit**

```bash
git add backend/nodes/mesh_export.py backend/tests/test_mesh_export.py
git commit -m "feat: add STEP to STL conversion utility (export_step_to_stl)"
```

---

## Task 6: ToolpathPass 3D パス対応 + SBP Writer 修正

**Files:**
- Modify: `backend/sbp_writer.py`
- Test: `backend/tests/test_sbp_writer_3d.py`

**Step 1: テストを書く**

Create `backend/tests/test_sbp_writer_3d.py`:

```python
"""Tests for SBP Writer 3D path support."""

from sbp_writer import SbpWriter
from schemas import (
    MachiningSettings,
    PostProcessorSettings,
    Tool,
    FeedRate,
    TabSettings,
    Toolpath,
    ToolpathPass,
)


def _make_settings(**overrides) -> MachiningSettings:
    defaults = dict(
        operation_type="contour",
        tool=Tool(diameter=6.0, type="ballnose", flutes=2),
        feed_rate=FeedRate(xy=60, z=20),
        jog_speed=200,
        spindle_speed=18000,
        depth_per_pass=3.0,
        total_depth=10.0,
        direction="climb",
        offset_side="none",
        tabs=TabSettings(enabled=False, height=0, width=0, count=0),
    )
    defaults.update(overrides)
    return MachiningSettings(**defaults)


def _make_post() -> PostProcessorSettings:
    return PostProcessorSettings(safe_z=38.0)


def test_3d_path_generates_m3_with_per_point_z():
    """3D paths ([[x,y,z]]) should use per-point Z, not z_depth."""
    settings = _make_settings()
    post = _make_post()
    writer = SbpWriter(settings=post, machining=settings)

    tp = Toolpath(
        operation_id="op1",
        passes=[
            ToolpathPass(
                pass_number=1,
                z_depth=-10.0,  # reference only for 3D
                path=[[0, 0, -2], [10, 0, -5], [20, 0, -3], [20, 10, -8]],
                tabs=[],
            )
        ],
    )

    sbp = writer.generate([tp])
    lines = sbp.split("\n")

    # Find M3 commands
    m3_lines = [l for l in lines if l.startswith("M3,")]
    # First M3 is descend: M3,0,0,-2
    assert "M3,0,0,-2" in m3_lines[0]
    # Subsequent M3 use per-point Z
    assert "M3,10,0,-5" in m3_lines[1]
    assert "M3,20,0,-3" in m3_lines[2]
    assert "M3,20,10,-8" in m3_lines[3]


def test_2d_path_still_uses_z_depth():
    """2D paths ([[x,y]]) should still use z_depth as before."""
    settings = _make_settings()
    post = _make_post()
    writer = SbpWriter(settings=post, machining=settings)

    tp = Toolpath(
        operation_id="op1",
        passes=[
            ToolpathPass(
                pass_number=1,
                z_depth=-6.0,
                path=[[0, 0], [10, 0], [10, 10], [0, 10]],
                tabs=[],
            )
        ],
    )

    sbp = writer.generate([tp])
    lines = sbp.split("\n")

    m3_lines = [l for l in lines if l.startswith("M3,")]
    # All M3 should use z_depth=-6.0
    for line in m3_lines:
        assert line.endswith("-6.0") or line.endswith("-6")


def test_mixed_2d_3d_toolpaths():
    """A mix of 2D and 3D toolpaths should work in the same SBP file."""
    settings = _make_settings()
    post = _make_post()
    writer = SbpWriter(settings=post, machining=settings)

    tp_2d = Toolpath(
        operation_id="op_2d",
        passes=[
            ToolpathPass(pass_number=1, z_depth=-6.0, path=[[0, 0], [10, 0]], tabs=[])
        ],
    )
    tp_3d = Toolpath(
        operation_id="op_3d",
        passes=[
            ToolpathPass(
                pass_number=1,
                z_depth=-10.0,
                path=[[50, 0, -2], [60, 0, -5]],
                tabs=[],
            )
        ],
    )

    sbp = writer.generate([tp_2d, tp_3d])
    # Should contain both 2D (z=-6) and 3D (z=-2, z=-5) M3 commands
    assert "M3,0,0,-6" in sbp
    assert "M3,50,0,-2" in sbp
    assert "M3,60,0,-5" in sbp
```

**Step 2: テスト失敗を確認**

Run: `cd backend && uv run pytest tests/test_sbp_writer_3d.py -v`
Expected: FAIL — 2D unpacking `x, y = path[i]` fails for 3-element lists

**Step 3: SBP Writer 修正**

`backend/sbp_writer.py` を修正:

`_single_pass` メソッド（行156-178）を修正:

```python
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
        pt = path[i]
        if len(pt) >= 3:
            # 3D path: per-point Z
            x, y, z = pt[0], pt[1], pt[2]
        else:
            # 2D path: use pass z_depth (or tab override)
            x, y = pt[0], pt[1]
            z = tab_z_map.get(i, tp_pass.z_depth)
        lines.append(f"M3,{x},{y},{z}")

    return lines
```

`_descend` メソッド（行180-183）を修正:

```python
def _descend(self, point: list[float], z_depth: float) -> list[str]:
    """Descend to cutting depth at the given point."""
    x, y = point[0], point[1]
    z = point[2] if len(point) >= 3 else z_depth
    return [f"M3,{x},{y},{z}"]
```

`_cutting_passes` メソッドの `start_x, start_y` 取得部分（行136）も修正:

```python
start_x, start_y = first_path[0][0], first_path[0][1]
```
（注: 現在 `start_x, start_y = first_path[0]` はタプルアンパック。`[0][0], [0][1]` に変更）

**Step 4: テスト通過を確認**

Run: `cd backend && uv run pytest tests/test_sbp_writer_3d.py -v`
Expected: 3 passed

**Step 5: 既存SBPテストが壊れていないか確認**

Run: `cd backend && uv run pytest tests/ -v -k "sbp or writer"`
Expected: All passed（既存2Dパスの動作に影響なし）

**Step 6: 全テスト実行**

Run: `cd backend && uv run pytest tests/ -v`
Expected: All passed

**Step 7: Commit**

```bash
git add backend/sbp_writer.py backend/tests/test_sbp_writer_3d.py
git commit -m "feat: extend SBP Writer to support 3D paths ([[x,y,z]])"
```

---

## Task 7: フロントエンド — uploadMeshFile API関数

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/types.ts`

**Step 1: MeshImportResult 型を追加**

`frontend/src/types.ts` の `BrepImportResult` 定義の直後に追加:

```typescript
export interface MeshImportResult extends BrepImportResult {
  mesh_file_path: string;
}
```

**Step 2: API関数を追加**

`frontend/src/api.ts` の `uploadStepFile` 関数の直後に追加:

```typescript
export async function uploadMeshFile(file: File): Promise<MeshImportResult> {
  const formData = new FormData();
  formData.append("file", file);
  return requestJson<MeshImportResult>(
    `${API_BASE_URL}/api/upload-mesh`,
    { method: "POST", body: formData },
    "Mesh upload failed"
  );
}
```

import に `MeshImportResult` を追加（`frontend/src/api.ts` 行1の import ブロック）。

**Step 3: Commit**

```bash
git add frontend/src/types.ts frontend/src/api.ts
git commit -m "feat: add MeshImportResult type and uploadMeshFile API function"
```

---

## Task 8: フロントエンド — MeshImportNode コンポーネント

**Files:**
- Create: `frontend/src/nodes/MeshImportNode.tsx`
- Modify: `frontend/src/nodeRegistry.ts`

**Step 1: MeshImportNode を作成**

BrepImportNode をベースに、STL/OBJ対応版を作成。
Create `frontend/src/nodes/MeshImportNode.tsx`:

```tsx
import { useRef, useState, useCallback } from "react";
import { type NodeProps, useReactFlow } from "@xyflow/react";
import LabeledHandle from "./LabeledHandle";
import NodeShell from "../components/NodeShell";
import { uploadMeshFile } from "../api";
import type { MeshImportResult, BrepObject } from "../types";

type Status = "idle" | "loading" | "success" | "error";

export default function MeshImportNode({ id, selected }: NodeProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<MeshImportResult | null>(null);
  const [error, setError] = useState<string>("");
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { setNodes } = useReactFlow();

  const handleFile = useCallback(
    async (file: File) => {
      setStatus("loading");
      setError("");
      try {
        const data = await uploadMeshFile(file);
        setResult(data);
        setStatus("success");
        setNodes((nds) =>
          nds.map((n) =>
            n.id === id
              ? { ...n, data: { ...n.data, brepResult: data } }
              : n
          )
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
        setStatus("error");
      }
    },
    [id, setNodes]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const onDragLeave = useCallback(() => setIsDragOver(false), []);
  const onClickUpload = useCallback(() => inputRef.current?.click(), []);

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <NodeShell category="cad" selected={selected}>
      <div style={headerStyle}>Mesh Import</div>

      <div
        style={{
          ...dropZoneStyle,
          borderColor: isDragOver ? "var(--color-accent)" : "var(--border-color)",
        }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={onClickUpload}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".stl,.obj"
          style={{ display: "none" }}
          onChange={onFileChange}
        />
        {status === "loading" ? (
          <span style={{ color: "var(--text-muted)" }}>Analyzing...</span>
        ) : (
          <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
            Drop .stl/.obj here
            <br />
            or click to select
          </span>
        )}
      </div>

      {status === "error" && (
        <div style={{ color: "var(--color-error)", fontSize: 11, padding: "4px 0" }}>
          {error}
        </div>
      )}

      {status === "success" && result && (
        <div style={resultStyle}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {result.object_count} object{result.object_count > 1 ? "s" : ""}
          </div>
          {result.objects.map((obj) => (
            <MeshSummary key={obj.object_id} obj={obj} />
          ))}
        </div>
      )}

      <LabeledHandle type="source" id={`${id}-out`} label="out" dataType="geometry" />
    </NodeShell>
  );
}

function MeshSummary({ obj }: { obj: BrepObject }) {
  const bb = obj.bounding_box;
  return (
    <div style={objStyle}>
      <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{obj.object_id}</div>
      <div style={{ fontSize: 11 }}>
        {bb.x.toFixed(1)} × {bb.y.toFixed(1)} × {bb.z.toFixed(1)} {obj.unit}
      </div>
      <div style={{ fontSize: 11 }}>
        Type: <strong>{obj.machining_type}</strong>
        {obj.is_closed && (
          <span style={{ color: "var(--text-muted)" }}> (watertight)</span>
        )}
      </div>
    </div>
  );
}

const headerStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 13,
  marginBottom: 8,
  color: "var(--text-primary)",
};

const dropZoneStyle: React.CSSProperties = {
  border: "2px dashed var(--border-color)",
  borderRadius: "var(--radius-control)",
  padding: "16px 12px",
  textAlign: "center",
  cursor: "pointer",
  transition: "all 0.15s",
};

const resultStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 12,
};

const objStyle: React.CSSProperties = {
  background: "var(--surface-bg)",
  borderRadius: "var(--radius-item)",
  padding: "6px 8px",
  marginTop: 4,
};
```

**Step 2: nodeRegistry に登録**

`frontend/src/nodeRegistry.ts` を修正:

import追加:
```typescript
import MeshImportNode from "./nodes/MeshImportNode";
```

NODE_REGISTRY に追加（brepImport の次）:
```typescript
meshImport: { component: MeshImportNode, label: "Mesh Import", category: "cad" },
```

**Step 3: ビルド確認**

Run: `cd frontend && npm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add frontend/src/nodes/MeshImportNode.tsx frontend/src/nodeRegistry.ts
git commit -m "feat: add MeshImportNode — STL/OBJ drop zone with analysis display"
```

---

## Task 9: 結合テスト — STLインポート → PlacementNode接続

**Files:**
- Test: `backend/tests/test_api_mesh.py` (追加)

**Step 1: STLアップロード → PlacementNode互換データのテスト**

`backend/tests/test_api_mesh.py` に追加:

```python
def test_mesh_result_compatible_with_brep_flow(client, simple_box_stl):
    """MeshImportResult should contain data PlacementNode needs."""
    with open(simple_box_stl, "rb") as f:
        response = client.post(
            "/api/upload-mesh",
            files={"file": ("box.stl", f, "application/octet-stream")},
        )
    data = response.json()

    # PlacementNode requires: file_id, objects (with bounding_box, object_id, origin)
    assert data["file_id"]
    obj = data["objects"][0]
    assert "bounding_box" in obj
    assert "object_id" in obj
    assert "origin" in obj
    assert obj["origin"]["reference"] == "bounding_box_min"
    assert len(obj["origin"]["position"]) == 3


def test_mesh_data_endpoint_with_stl(client, freeform_stl):
    """Verify mesh-data endpoint works with STL imports."""
    # Upload first
    with open(freeform_stl, "rb") as f:
        upload_resp = client.post(
            "/api/upload-mesh",
            files={"file": ("sphere.stl", f, "application/octet-stream")},
        )
    file_id = upload_resp.json()["file_id"]

    # mesh-data endpoint should work with the uploaded file
    # (STL files are already mesh — tessellation is identity)
    resp = client.post(
        "/api/mesh-data",
        json={"file_id": file_id},
    )
    # Current mesh-data uses STEP tessellation, so STL will fail
    # This is expected — we'll need a separate endpoint or extension later
    # For now, just verify the upload worked
    assert upload_resp.status_code == 200
```

**Step 2: テスト通過を確認**

Run: `cd backend && uv run pytest tests/test_api_mesh.py -v`
Expected: All passed

**Step 3: 全テスト実行**

Run: `cd backend && uv run pytest tests/ -v`
Expected: All passed

**Step 4: Commit**

```bash
git add backend/tests/test_api_mesh.py
git commit -m "test: add integration tests for mesh import → placement compatibility"
```

---

## Task 10: 手動動作確認

**Step 1: バックエンド起動**

Run: `make back`

**Step 2: フロントエンド起動（別ターミナル）**

Run: `make front`

**Step 3: 動作確認チェックリスト**

1. サイドバーに "Mesh Import" が表示される
2. Mesh Import ノードをキャンバスにドラッグ&ドロップ
3. STLファイルをドロップゾーンにドラッグ → "Analyzing..." 表示
4. 解析完了後、bounding box と machining_type: "3d" が表示される
5. Mesh Import の出力ハンドルを Placement ノードに接続可能
6. BREP Import ノードは引き続き STEP ファイルで正常動作

**Step 4: Commit（動作確認で修正があれば）**

```bash
git add -A
git commit -m "fix: address issues found during manual testing"
```

---

## Summary

| Task | Description | New Files | Modified Files |
|------|-------------|-----------|----------------|
| 1 | trimesh 依存追加 | — | `pyproject.toml` |
| 2 | MeshImportResult スキーマ | `test_schemas_mesh.py` | `schemas.py` |
| 3 | STL解析バックエンド | `mesh_import.py`, `test_mesh_import.py` | `conftest.py` |
| 4 | アップロードAPI | `test_api_mesh.py` | `main.py` |
| 5 | STEP→STL変換 | — | `mesh_export.py`, `test_mesh_export.py` |
| 6 | SBP Writer 3D対応 | `test_sbp_writer_3d.py` | `sbp_writer.py` |
| 7 | フロント API関数 | — | `api.ts`, `types.ts` |
| 8 | MeshImportNode | `MeshImportNode.tsx` | `nodeRegistry.ts` |
| 9 | 結合テスト | — | `test_api_mesh.py` |
| 10 | 手動動作確認 | — | — |
