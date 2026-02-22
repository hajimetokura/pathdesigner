# 3Dプレビュー・PlacementNode・Toolpathプレビュー強化 実装計画

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** BREPインポートの3Dソリッド表示、部品配置ノード追加、Toolpathプレビューへの原点・Stock範囲表示を実装する。

**Architecture:** 3つの独立した機能を段階的に実装する。(1) ToolpathプレビューへのStock範囲オーバーレイ、(2) Three.jsによるBREP 3Dプレビュー、(3) 新規PlacementNodeの追加とデータフローの変更。各機能を個別のPR可能な状態で完成させる。

**Tech Stack:** React + React Flow + Three.js (@react-three/fiber, @react-three/drei) / FastAPI + build123d (tessellation) / Canvas 2D (placement preview)

**Design doc:** `docs/plans/2026-02-22-3d-preview-placement-design.md`

---

## Task 1: Toolpathプレビューに原点座標軸 + Stock範囲を追加

Stock寸法をToolpathGenResultに追加し、プレビューキャンバスにStock矩形と原点軸を描画する。

### Task 1-1: バックエンド — ToolpathGenResult に stock 寸法を追加

**Files:**
- Modify: `backend/schemas.py:222-223`
- Test: `backend/tests/test_toolpath_schemas.py`

**Step 1: ToolpathGenResult スキーマを更新**

`backend/schemas.py` の `ToolpathGenResult` に `stock_width` と `stock_depth` を追加:

```python
class ToolpathGenResult(BaseModel):
    toolpaths: list[Toolpath]
    stock_width: float | None = None   # mm (X axis)
    stock_depth: float | None = None   # mm (Y axis)
```

**Step 2: generate_toolpath_from_operations で stock 寸法を含める**

`backend/nodes/toolpath_gen.py` の `generate_toolpath_from_operations()` 関数で、返す `ToolpathGenResult` に stock 寸法を設定する。この関数は `stock: StockSettings` を引数に取っている。

`toolpath_gen.py` の `generate_toolpath_from_operations` の return 文を修正:

```python
    # Return result with stock dimensions for preview
    first_material = stock.materials[0] if stock.materials else None
    return ToolpathGenResult(
        toolpaths=toolpaths,
        stock_width=first_material.width if first_material else None,
        stock_depth=first_material.depth if first_material else None,
    )
```

**Step 3: テスト更新**

`backend/tests/test_toolpath_schemas.py` を更新して stock 寸法フィールドを確認:

```python
def test_toolpath_gen_result_with_stock_dimensions():
    """ToolpathGenResult should include optional stock dimensions."""
    result = ToolpathGenResult(
        toolpaths=[],
        stock_width=600.0,
        stock_depth=400.0,
    )
    assert result.stock_width == 600.0
    assert result.stock_depth == 400.0


def test_toolpath_gen_result_without_stock_dimensions():
    """ToolpathGenResult stock dimensions should default to None."""
    result = ToolpathGenResult(toolpaths=[])
    assert result.stock_width is None
    assert result.stock_depth is None
```

**Step 4: テスト実行**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run python -m pytest tests/test_toolpath_schemas.py -v`
Expected: PASS

**Step 5: コミット**

```bash
git add backend/schemas.py backend/nodes/toolpath_gen.py backend/tests/test_toolpath_schemas.py
git commit -m "Add stock dimensions to ToolpathGenResult for preview overlay (#5)"
```

---

### Task 1-2: フロントエンド — TypeScript型を更新

**Files:**
- Modify: `frontend/src/types.ts:191-193`

**Step 1: ToolpathGenResult に stock 寸法を追加**

```typescript
export interface ToolpathGenResult {
  toolpaths: Toolpath[];
  stock_width: number | null;
  stock_depth: number | null;
}
```

**Step 2: コミット**

```bash
git add frontend/src/types.ts
git commit -m "Add stock_width/stock_depth to ToolpathGenResult type (#5)"
```

---

### Task 1-3: ToolpathPreviewPanel に原点軸 + Stock範囲を描画

**Files:**
- Modify: `frontend/src/components/ToolpathPreviewPanel.tsx`

**Step 1: `draw` 関数に原点軸とStock範囲の描画を追加**

`ToolpathPreviewPanel.tsx` の `draw` コールバック内、ツールパス描画の **前** に以下を追加する。

座標変換ロジック (`toCanvas`) の計算後、ツールパスの for ループの前に挿入:

```typescript
      // --- Stock bounds (background layer) ---
      if (toolpathResult.stock_width && toolpathResult.stock_depth) {
        const sw = toolpathResult.stock_width;
        const sd = toolpathResult.stock_depth;
        const [sx0, sy0] = toCanvas(0, 0);
        const [sx1, sy1] = toCanvas(sw, sd);
        ctx.save();
        ctx.strokeStyle = "#ccc";
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(sx0, sy1, sx1 - sx0, sy0 - sy1);
        ctx.setLineDash([]);
        // Dimension label
        ctx.fillStyle = "#aaa";
        ctx.font = "10px sans-serif";
        ctx.fillText(`${sw} × ${sd} mm`, sx0, sy1 - 4);
        ctx.restore();
      }

      // --- Origin axes ---
      const [ox, oy] = toCanvas(0, 0);
      const axisLen = 30; // pixels
      ctx.save();
      // X axis (red)
      ctx.strokeStyle = "#e53935";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox + axisLen, oy);
      ctx.stroke();
      ctx.fillStyle = "#e53935";
      ctx.font = "bold 10px sans-serif";
      ctx.fillText("X", ox + axisLen + 2, oy + 3);
      // Y axis (green)
      ctx.strokeStyle = "#43a047";
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox, oy - axisLen);
      ctx.stroke();
      ctx.fillStyle = "#43a047";
      ctx.fillText("Y", ox - 4, oy - axisLen - 4);
      // Origin dot
      ctx.fillStyle = "#333";
      ctx.beginPath();
      ctx.arc(ox, oy, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
```

**重要:** `toCanvas` の bounds 計算を、toolpath の点だけでなく原点 (0,0) と Stock 範囲も含めるように修正する。現在の bounds は toolpath の点のみで計算されているので、Stock 範囲がはみ出す可能性がある。

bounds 計算部分（`allPoints` 収集後）を修正:

```typescript
      // Include origin and stock bounds in view calculation
      if (toolpathResult.stock_width && toolpathResult.stock_depth) {
        allPoints.push([0, 0]);
        allPoints.push([toolpathResult.stock_width, toolpathResult.stock_depth]);
      } else {
        allPoints.push([0, 0]); // Always include origin
      }
```

**Step 2: Props に stock 寸法を渡すか確認**

`ToolpathPreviewPanel` は `toolpathResult: ToolpathGenResult` をそのまま受け取るので、`stock_width` / `stock_depth` は自動的に利用可能。Props の変更は不要。

**Step 3: コミット**

```bash
git add frontend/src/components/ToolpathPreviewPanel.tsx
git commit -m "Add origin axes and stock bounds overlay to toolpath preview (#5)"
```

---

### Task 1-4: ToolpathPreviewNode のサムネイルにも反映

**Files:**
- Modify: `frontend/src/nodes/ToolpathPreviewNode.tsx`

**Step 1: サムネイル描画にも同様の原点軸 + Stock範囲を追加**

`ToolpathPreviewNode.tsx` の `drawToolpath` 関数内にも同じ描画ロジックを追加（ただしサイズは小さいのでラベルは省略）。

bounds 計算後、ツールパス描画前に挿入:

```typescript
      // Include origin and stock bounds in view
      if (result.stock_width && result.stock_depth) {
        allPoints.push([0, 0]);
        allPoints.push([result.stock_width, result.stock_depth]);
      } else {
        allPoints.push([0, 0]);
      }
```

ツールパス描画前に:

```typescript
      // Stock bounds (thumbnail)
      if (result.stock_width && result.stock_depth) {
        const [sx0, sy0] = toCanvas(0, 0);
        const [sx1, sy1] = toCanvas(result.stock_width, result.stock_depth);
        ctx.strokeStyle = "#ddd";
        ctx.lineWidth = 0.5;
        ctx.setLineDash([3, 2]);
        ctx.strokeRect(sx0, sy1, sx1 - sx0, sy0 - sy1);
        ctx.setLineDash([]);
      }
      // Origin marker (thumbnail)
      const [ox, oy] = toCanvas(0, 0);
      ctx.fillStyle = "#e53935";
      ctx.beginPath();
      ctx.arc(ox, oy, 2, 0, Math.PI * 2);
      ctx.fill();
```

**Step 2: コミット**

```bash
git add frontend/src/nodes/ToolpathPreviewNode.tsx
git commit -m "Add stock bounds and origin marker to toolpath preview thumbnail (#5)"
```

---

### Task 1-5: 動作確認

**Step 1: `make dev` でバックエンド + フロントエンドを起動**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner && make dev`

**Step 2: ブラウザでフル操作を確認**

1. STEP ファイルをインポート
2. Stock を設定
3. Operation を検出
4. Toolpath を生成
5. Toolpath Preview でプレビューを開く
6. **確認ポイント:** 原点の赤/緑の軸が表示されるか、Stock の破線矩形が表示されるか

---

## Task 2: BREPインポート 3Dプレビュー

### Task 2-1: バックエンド — メッシュデータ API

**Files:**
- Modify: `backend/schemas.py` (MeshData スキーマ追加)
- Modify: `backend/main.py` (エンドポイント追加)
- Create: `backend/nodes/mesh_export.py` (テッセレーション処理)
- Test: `backend/tests/test_mesh_export.py`

**Step 1: テストを先に書く**

`backend/tests/test_mesh_export.py`:

```python
"""Test mesh export (tessellation) for 3D preview."""

from nodes.mesh_export import tessellate_step_file


def test_tessellate_simple_box(simple_box_step):
    """Tessellating a simple box should return valid mesh data."""
    result = tessellate_step_file(simple_box_step)
    assert len(result) > 0

    mesh = result[0]
    assert mesh["object_id"] == "obj_001"
    # Box has 6 faces, each face = 2 triangles = 12 triangles minimum
    assert len(mesh["vertices"]) > 0
    assert len(mesh["vertices"]) % 3 == 0  # flat [x,y,z,x,y,z,...]
    assert len(mesh["faces"]) > 0
    assert len(mesh["faces"]) % 3 == 0  # flat [i,j,k,i,j,k,...]
```

**Step 2: テスト実行（失敗確認）**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run python -m pytest tests/test_mesh_export.py -v`
Expected: FAIL (ModuleNotFoundError)

**Step 3: mesh_export.py 実装**

`backend/nodes/mesh_export.py`:

```python
"""Mesh export — tessellate STEP solids for 3D preview."""

from pathlib import Path

from build123d import Solid, import_step


def tessellate_step_file(
    filepath: str | Path, tolerance: float = 0.5
) -> list[dict]:
    """Tessellate all solids in a STEP file and return mesh data.

    Returns a list of dicts, one per solid:
        {
            "object_id": "obj_001",
            "vertices": [x0, y0, z0, x1, y1, z1, ...],  # flat
            "faces": [i0, j0, k0, i1, j1, k1, ...],      # flat
        }
    """
    compound = import_step(str(filepath))
    solids = compound.solids()

    meshes = []
    for i, solid in enumerate(solids):
        verts_raw, tris_raw = solid.tessellate(tolerance)

        vertices: list[float] = []
        for v in verts_raw:
            vertices.extend([v.X, v.Y, v.Z])

        faces: list[int] = []
        for tri in tris_raw:
            faces.extend(tri)

        meshes.append({
            "object_id": f"obj_{i + 1:03d}",
            "vertices": vertices,
            "faces": faces,
        })

    return meshes
```

**Step 4: テスト実行（成功確認）**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run python -m pytest tests/test_mesh_export.py -v`
Expected: PASS

**Step 5: Pydantic スキーマ追加**

`backend/schemas.py` の末尾に追加:

```python
# --- Mesh Data (3D Preview) ---


class ObjectMesh(BaseModel):
    object_id: str
    vertices: list[float]  # flat [x0, y0, z0, x1, ...]
    faces: list[int]       # flat [i0, j0, k0, i1, ...]


class MeshDataRequest(BaseModel):
    file_id: str


class MeshDataResult(BaseModel):
    objects: list[ObjectMesh]
```

**Step 6: API エンドポイント追加**

`backend/main.py` に追加:

import 追加:
```python
from nodes.mesh_export import tessellate_step_file
from schemas import (
    ...,
    MeshDataRequest, MeshDataResult,
)
```

エンドポイント追加（`generate_sbp_endpoint` の後に）:

```python
@app.post("/api/mesh-data", response_model=MeshDataResult)
def mesh_data_endpoint(req: MeshDataRequest):
    """Return tessellated mesh data for 3D preview."""
    matches = list(UPLOAD_DIR.glob(f"{req.file_id}.*"))
    if not matches:
        raise HTTPException(status_code=404, detail=f"File not found: {req.file_id}")

    try:
        meshes = tessellate_step_file(matches[0])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Tessellation failed: {e}")

    return MeshDataResult(objects=meshes)
```

**Step 7: コミット**

```bash
git add backend/nodes/mesh_export.py backend/schemas.py backend/main.py backend/tests/test_mesh_export.py
git commit -m "Add mesh-data API endpoint for 3D preview tessellation (#5)"
```

---

### Task 2-2: フロントエンド — Three.js 依存追加 + 型定義

**Files:**
- Modify: `frontend/package.json` (依存追加)
- Modify: `frontend/src/types.ts` (MeshData 型追加)
- Modify: `frontend/src/api.ts` (fetchMeshData 関数追加)

**Step 1: Three.js 依存をインストール**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/frontend && npm install three @react-three/fiber @react-three/drei && npm install -D @types/three`

**Step 2: types.ts に MeshData 型を追加**

`frontend/src/types.ts` の末尾に追加:

```typescript
/** Mesh data for 3D preview */

export interface ObjectMesh {
  object_id: string;
  vertices: number[];  // flat [x0, y0, z0, x1, ...]
  faces: number[];     // flat [i0, j0, k0, i1, ...]
}

export interface MeshDataResult {
  objects: ObjectMesh[];
}
```

**Step 3: api.ts に fetchMeshData 関数を追加**

`frontend/src/api.ts` の末尾に追加:

```typescript
export async function fetchMeshData(
  fileId: string
): Promise<MeshDataResult> {
  const res = await fetch(`${API_URL}/api/mesh-data`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Mesh data fetch failed" }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}
```

api.ts の import に `MeshDataResult` を追加。

**Step 4: コミット**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/types.ts frontend/src/api.ts
git commit -m "Add Three.js deps and mesh data API client (#5)"
```

---

### Task 2-3: BrepImportNode に 3D プレビューを追加

**Files:**
- Create: `frontend/src/components/BrepImportPanel.tsx` (サイドパネル: 大きな3Dビュー)
- Create: `frontend/src/components/MeshViewer.tsx` (Three.js ビューワーコンポーネント)
- Modify: `frontend/src/nodes/BrepImportNode.tsx` (サムネイル + パネル開閉)

**Step 1: MeshViewer コンポーネントを作成**

`frontend/src/components/MeshViewer.tsx`:

```tsx
import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { ObjectMesh } from "../types";

interface Props {
  meshes: ObjectMesh[];
  style?: React.CSSProperties;
}

function MeshObject({ mesh }: { mesh: ObjectMesh }) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(mesh.vertices);
    const indices = new Uint32Array(mesh.faces);
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();
    return geo;
  }, [mesh]);

  return (
    <mesh geometry={geometry}>
      <meshPhongMaterial color="#b0bec5" side={THREE.DoubleSide} />
    </mesh>
  );
}

function EdgeLines({ mesh }: { mesh: ObjectMesh }) {
  const edges = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(mesh.vertices);
    const indices = new Uint32Array(mesh.faces);
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    return new THREE.EdgesGeometry(geo, 15);
  }, [mesh]);

  return (
    <lineSegments geometry={edges}>
      <lineBasicMaterial color="#546e7a" />
    </lineSegments>
  );
}

export default function MeshViewer({ meshes, style }: Props) {
  // Compute bounding box to center camera
  const bounds = useMemo(() => {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const m of meshes) {
      for (let i = 0; i < m.vertices.length; i += 3) {
        minX = Math.min(minX, m.vertices[i]);
        maxX = Math.max(maxX, m.vertices[i]);
        minY = Math.min(minY, m.vertices[i + 1]);
        maxY = Math.max(maxY, m.vertices[i + 1]);
        minZ = Math.min(minZ, m.vertices[i + 2]);
        maxZ = Math.max(maxZ, m.vertices[i + 2]);
      }
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    return { center: [cx, cy, cz] as [number, number, number], size };
  }, [meshes]);

  return (
    <div style={style}>
      <Canvas
        camera={{
          position: [
            bounds.center[0] + bounds.size * 0.8,
            bounds.center[1] - bounds.size * 0.6,
            bounds.center[2] + bounds.size * 0.8,
          ],
          fov: 50,
          near: 0.1,
          far: bounds.size * 10,
        }}
      >
        <ambientLight intensity={0.4} />
        <directionalLight position={[1, 1, 1]} intensity={0.8} />
        <directionalLight position={[-1, -0.5, 0.5]} intensity={0.3} />
        <group position={[-bounds.center[0], -bounds.center[1], -bounds.center[2]]}>
          {meshes.map((m) => (
            <group key={m.object_id}>
              <MeshObject mesh={m} />
              <EdgeLines mesh={m} />
            </group>
          ))}
        </group>
        <OrbitControls />
      </Canvas>
    </div>
  );
}
```

**Step 2: BrepImportPanel サイドパネルを作成**

`frontend/src/components/BrepImportPanel.tsx`:

```tsx
import type { BrepImportResult, ObjectMesh } from "../types";
import MeshViewer from "./MeshViewer";

interface Props {
  brepResult: BrepImportResult;
  meshes: ObjectMesh[];
  onClose: () => void;
}

export default function BrepImportPanel({ brepResult, meshes, onClose }: Props) {
  return (
    <div style={panelStyle}>
      <div style={panelHeaderStyle}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>BREP Import — 3D Preview</span>
        <button onClick={onClose} style={closeBtnStyle}>×</button>
      </div>

      <MeshViewer
        meshes={meshes}
        style={{ flex: 1, minHeight: 300 }}
      />

      <div style={infoStyle}>
        <div style={infoTitle}>Objects</div>
        {brepResult.objects.map((obj) => (
          <div key={obj.object_id} style={infoRow}>
            <span>{obj.object_id}</span>
            <span>
              {obj.bounding_box.x.toFixed(1)} × {obj.bounding_box.y.toFixed(1)} × {obj.bounding_box.z.toFixed(1)} {obj.unit}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  right: 0,
  width: 480,
  height: "100vh",
  background: "white",
  borderLeft: "1px solid #ddd",
  boxShadow: "-4px 0 16px rgba(0,0,0,0.1)",
  zIndex: 100,
  display: "flex",
  flexDirection: "column",
};

const panelHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "12px 16px",
  borderBottom: "1px solid #eee",
};

const closeBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  fontSize: 16,
  cursor: "pointer",
  color: "#999",
  padding: "4px 8px",
};

const infoStyle: React.CSSProperties = {
  padding: "12px 16px",
  borderTop: "1px solid #f0f0f0",
};

const infoTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "#888",
  textTransform: "uppercase",
  letterSpacing: 1,
  paddingBottom: 4,
};

const infoRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: 12,
  padding: "2px 0",
  color: "#555",
};
```

**Step 3: BrepImportNode を修正**

`frontend/src/nodes/BrepImportNode.tsx` を修正:

1. `fetchMeshData` を import に追加
2. `ObjectMesh` 型を import に追加
3. state 追加: `meshes`, `showPanel`
4. `handleFile` 内で STEP upload 成功後に `fetchMeshData` を呼ぶ
5. 成功時にパネル開閉ボタンを追加
6. `createPortal` で `BrepImportPanel` を表示

主な変更点:

```tsx
import { fetchMeshData } from "../api";
import type { BrepImportResult, BrepObject, ObjectMesh } from "../types";
import BrepImportPanel from "../components/BrepImportPanel";
import { createPortal } from "react-dom";

// state 追加:
const [meshes, setMeshes] = useState<ObjectMesh[]>([]);
const [showPanel, setShowPanel] = useState(false);

// handleFile 内、setResult(data) の後に追加:
try {
  const meshData = await fetchMeshData(data.file_id);
  setMeshes(meshData.objects);
} catch {
  // Mesh fetch failure is non-critical, preview just won't show
}

// result 表示部分の後に "View 3D" ボタンを追加:
{meshes.length > 0 && (
  <button onClick={() => setShowPanel(true)} style={viewBtnStyle}>
    View 3D
  </button>
)}

// ノードの最後（LabeledHandle の後）に portal を追加:
{showPanel && result && (
  createPortal(
    <BrepImportPanel
      brepResult={result}
      meshes={meshes}
      onClose={() => setShowPanel(false)}
    />,
    document.body
  )
)}
```

**Step 4: コミット**

```bash
git add frontend/src/components/MeshViewer.tsx frontend/src/components/BrepImportPanel.tsx frontend/src/nodes/BrepImportNode.tsx
git commit -m "Add Three.js 3D solid preview to BREP import node (#5)"
```

---

### Task 2-4: 動作確認

**Step 1: `make dev` で起動**

**Step 2: ブラウザで確認**

1. STEP ファイルをインポート
2. "View 3D" ボタンが表示されることを確認
3. クリックしてサイドパネルが開くことを確認
4. **確認ポイント:** 3Dモデルがソリッド表示されるか、OrbitControls で回転・ズームできるか、エッジ線が見えるか

---

## Task 3: PlacementNode（部品配置ノード）

### Task 3-1: バックエンド — PlacementResult スキーマ + バリデーション

**Files:**
- Modify: `backend/schemas.py` (PlacementResult 追加)
- Modify: `backend/main.py` (validate-placement エンドポイント追加)
- Create: `backend/tests/test_placement.py`

**Step 1: テストを先に書く**

`backend/tests/test_placement.py`:

```python
"""Test placement validation."""

from schemas import (
    PlacementItem,
    PlacementResult,
    StockMaterial,
    StockSettings,
    BoundingBox,
)


def test_placement_within_bounds():
    """Placement within stock bounds should produce no warnings."""
    from main import _validate_placement
    placement = PlacementItem(
        object_id="obj_001",
        material_id="mtl_1",
        x_offset=10,
        y_offset=10,
        rotation=0,
    )
    stock = StockMaterial(material_id="mtl_1", width=600, depth=400, thickness=18)
    bb = BoundingBox(x=100, y=50, z=10)
    warnings = _validate_placement(placement, stock, bb)
    assert len(warnings) == 0


def test_placement_out_of_bounds():
    """Placement exceeding stock bounds should produce a warning."""
    from main import _validate_placement
    placement = PlacementItem(
        object_id="obj_001",
        material_id="mtl_1",
        x_offset=550,
        y_offset=10,
        rotation=0,
    )
    stock = StockMaterial(material_id="mtl_1", width=600, depth=400, thickness=18)
    bb = BoundingBox(x=100, y=50, z=10)
    warnings = _validate_placement(placement, stock, bb)
    assert len(warnings) > 0
    assert "X" in warnings[0]
```

**Step 2: テスト実行（失敗確認）**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run python -m pytest tests/test_placement.py -v`
Expected: FAIL

**Step 3: スキーマ追加**

`backend/schemas.py` に追加:

```python
# --- Placement ---


class PlacementItem(BaseModel):
    object_id: str
    material_id: str
    x_offset: float = 0       # mm, position on stock
    y_offset: float = 0
    rotation: float = 0        # degrees, v1 = 0 fixed


class PlacementResult(BaseModel):
    placements: list[PlacementItem]
    stock: StockSettings
    objects: list[BrepObject]


class ValidatePlacementRequest(BaseModel):
    placements: list[PlacementItem]
    stock: StockSettings
    bounding_boxes: dict[str, BoundingBox]  # object_id -> bounding_box


class ValidatePlacementResponse(BaseModel):
    valid: bool
    warnings: list[str]
```

**Step 4: バリデーション関数 + エンドポイント追加**

`backend/main.py` に追加:

```python
from schemas import (
    ...,
    PlacementItem, ValidatePlacementRequest, ValidatePlacementResponse,
)


def _validate_placement(
    placement: PlacementItem,
    stock: StockMaterial,
    bb: BoundingBox,
) -> list[str]:
    """Check if a placed object fits within stock bounds."""
    warnings = []
    if placement.x_offset + bb.x > stock.width:
        warnings.append(
            f"{placement.object_id}: X方向がStockを超えています "
            f"({placement.x_offset + bb.x:.1f} > {stock.width:.1f}mm)"
        )
    if placement.y_offset + bb.y > stock.depth:
        warnings.append(
            f"{placement.object_id}: Y方向がStockを超えています "
            f"({placement.y_offset + bb.y:.1f} > {stock.depth:.1f}mm)"
        )
    if placement.x_offset < 0:
        warnings.append(f"{placement.object_id}: X方向が負の位置です")
    if placement.y_offset < 0:
        warnings.append(f"{placement.object_id}: Y方向が負の位置です")
    return warnings


@app.post("/api/validate-placement", response_model=ValidatePlacementResponse)
def validate_placement_endpoint(req: ValidatePlacementRequest):
    """Validate part placements on stock."""
    mat_lookup = {m.material_id: m for m in req.stock.materials}
    all_warnings: list[str] = []

    for p in req.placements:
        stock = mat_lookup.get(p.material_id)
        bb = req.bounding_boxes.get(p.object_id)
        if stock and bb:
            all_warnings.extend(_validate_placement(p, stock, bb))

    return ValidatePlacementResponse(
        valid=len(all_warnings) == 0,
        warnings=all_warnings,
    )
```

**Step 5: テスト実行（成功確認）**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run python -m pytest tests/test_placement.py -v`
Expected: PASS

**Step 6: コミット**

```bash
git add backend/schemas.py backend/main.py backend/tests/test_placement.py
git commit -m "Add placement validation schema and endpoint (#5)"
```

---

### Task 3-2: フロントエンド — PlacementResult 型 + API クライアント

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api.ts`

**Step 1: types.ts に Placement 型を追加**

```typescript
/** Placement types */

export interface PlacementItem {
  object_id: string;
  material_id: string;
  x_offset: number;
  y_offset: number;
  rotation: number;
}

export interface PlacementResult {
  placements: PlacementItem[];
  stock: StockSettings;
  objects: BrepObject[];
}
```

**Step 2: api.ts に validatePlacement 関数を追加**

```typescript
export async function validatePlacement(
  placements: PlacementItem[],
  stock: StockSettings,
  boundingBoxes: Record<string, BoundingBox>
): Promise<{ valid: boolean; warnings: string[] }> {
  const res = await fetch(`${API_URL}/api/validate-placement`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      placements,
      stock,
      bounding_boxes: boundingBoxes,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Validation failed" }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}
```

**Step 3: コミット**

```bash
git add frontend/src/types.ts frontend/src/api.ts
git commit -m "Add placement types and validation API client (#5)"
```

---

### Task 3-3: PlacementPanel（サイドパネル）を作成

**Files:**
- Create: `frontend/src/components/PlacementPanel.tsx`

**Step 1: PlacementPanel を実装**

2D Canvas でStock上に部品を表示。ドラッグ移動 + 数値入力。

`frontend/src/components/PlacementPanel.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import type { BrepObject, StockSettings, PlacementItem } from "../types";

interface Props {
  objects: BrepObject[];
  stockSettings: StockSettings;
  placements: PlacementItem[];
  onPlacementsChange: (placements: PlacementItem[]) => void;
  warnings: string[];
  onClose: () => void;
}

export default function PlacementPanel({
  objects,
  stockSettings,
  placements,
  onPlacementsChange,
  warnings,
  onClose,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState<{ mx: number; my: number; ox: number; oy: number } | null>(null);

  const stock = stockSettings.materials[0];
  if (!stock) return null;

  const canvasW = 560;
  const canvasH = 400;
  const padding = 40;

  const scale = Math.min(
    (canvasW - 2 * padding) / stock.width,
    (canvasH - 2 * padding) / stock.depth
  );
  const offsetX = (canvasW - stock.width * scale) / 2;
  const offsetY = (canvasH - stock.depth * scale) / 2;

  const toCanvas = (x: number, y: number): [number, number] => [
    x * scale + offsetX,
    canvasH - (y * scale + offsetY),
  ];

  const fromCanvas = (cx: number, cy: number): [number, number] => [
    (cx - offsetX) / scale,
    (canvasH - cy - offsetY) / scale,
  ];

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasW, canvasH);

    // Stock background
    const [sx0, sy0] = toCanvas(0, 0);
    const [sx1, sy1] = toCanvas(stock.width, stock.depth);
    ctx.fillStyle = "#f5f5f5";
    ctx.fillRect(sx0, sy1, sx1 - sx0, sy0 - sy1);
    ctx.strokeStyle = "#999";
    ctx.lineWidth = 1;
    ctx.strokeRect(sx0, sy1, sx1 - sx0, sy0 - sy1);

    // Stock dimensions
    ctx.fillStyle = "#999";
    ctx.font = "11px sans-serif";
    ctx.fillText(`${stock.width} × ${stock.depth} mm`, sx0, sy1 - 6);

    // Origin
    ctx.fillStyle = "#333";
    ctx.beginPath();
    ctx.arc(sx0, sy0, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText("(0,0)", sx0 + 6, sy0 - 4);

    // Parts
    const colors = ["#4a90d9", "#7b61ff", "#43a047", "#ef5350"];
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      const obj = objects.find((o) => o.object_id === p.object_id);
      if (!obj) continue;

      const bb = obj.bounding_box;
      const [px0, py0] = toCanvas(p.x_offset, p.y_offset);
      const [px1, py1] = toCanvas(p.x_offset + bb.x, p.y_offset + bb.y);

      const isOut =
        p.x_offset + bb.x > stock.width ||
        p.y_offset + bb.y > stock.depth ||
        p.x_offset < 0 ||
        p.y_offset < 0;

      ctx.fillStyle = isOut ? "rgba(229,57,53,0.15)" : `${colors[i % colors.length]}22`;
      ctx.fillRect(px0, py1, px1 - px0, py0 - py1);
      ctx.strokeStyle = isOut ? "#e53935" : colors[i % colors.length];
      ctx.lineWidth = isOut ? 2 : 1.5;
      ctx.strokeRect(px0, py1, px1 - px0, py0 - py1);

      ctx.fillStyle = colors[i % colors.length];
      ctx.font = "bold 11px sans-serif";
      ctx.fillText(p.object_id, px0 + 4, py1 + 14);
    }
  }, [placements, objects, stock, scale, offsetX, offsetY]);

  useEffect(() => { draw(); }, [draw]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (canvasW / rect.width);
    const cy = (e.clientY - rect.top) * (canvasH / rect.height);

    // Hit test: find which part is under cursor
    for (let i = placements.length - 1; i >= 0; i--) {
      const p = placements[i];
      const obj = objects.find((o) => o.object_id === p.object_id);
      if (!obj) continue;
      const [px0, py0] = toCanvas(p.x_offset, p.y_offset);
      const [px1, py1] = toCanvas(p.x_offset + obj.bounding_box.x, p.y_offset + obj.bounding_box.y);
      if (cx >= px0 && cx <= px1 && cy >= py1 && cy <= py0) {
        setDragging(p.object_id);
        setDragStart({ mx: cx, my: cy, ox: p.x_offset, oy: p.y_offset });
        return;
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragging || !dragStart) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (canvasW / rect.width);
    const cy = (e.clientY - rect.top) * (canvasH / rect.height);
    const dx = (cx - dragStart.mx) / scale;
    const dy = -(cy - dragStart.my) / scale;
    const newPlacements = placements.map((p) =>
      p.object_id === dragging
        ? { ...p, x_offset: Math.round(dragStart.ox + dx), y_offset: Math.round(dragStart.oy + dy) }
        : p
    );
    onPlacementsChange(newPlacements);
  };

  const handleMouseUp = () => {
    setDragging(null);
    setDragStart(null);
  };

  const handleNumericChange = (objectId: string, field: "x_offset" | "y_offset", value: number) => {
    const updated = placements.map((p) =>
      p.object_id === objectId ? { ...p, [field]: value } : p
    );
    onPlacementsChange(updated);
  };

  return (
    <div style={panelStyle}>
      <div style={panelHeaderStyle}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>Placement</span>
        <button onClick={onClose} style={closeBtnStyle}>×</button>
      </div>

      <div style={{ padding: 16 }}>
        <canvas
          ref={canvasRef}
          width={canvasW}
          height={canvasH}
          style={{ width: "100%", border: "1px solid #eee", borderRadius: 4, cursor: dragging ? "grabbing" : "default" }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
      </div>

      {warnings.length > 0 && (
        <div style={warningStyle}>
          {warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 11, color: "#d32f2f", padding: "2px 0" }}>{w}</div>
          ))}
        </div>
      )}

      <div style={inputsStyle}>
        <div style={inputsTitle}>Position (mm)</div>
        {placements.map((p) => {
          const obj = objects.find((o) => o.object_id === p.object_id);
          return (
            <div key={p.object_id} style={inputRow}>
              <span style={{ fontSize: 12, fontWeight: 600, minWidth: 60 }}>{p.object_id}</span>
              <label style={labelStyle}>
                X:
                <input
                  type="number"
                  value={p.x_offset}
                  onChange={(e) => handleNumericChange(p.object_id, "x_offset", Number(e.target.value))}
                  style={numInputStyle}
                />
              </label>
              <label style={labelStyle}>
                Y:
                <input
                  type="number"
                  value={p.y_offset}
                  onChange={(e) => handleNumericChange(p.object_id, "y_offset", Number(e.target.value))}
                  style={numInputStyle}
                />
              </label>
              {obj && (
                <span style={{ fontSize: 10, color: "#888" }}>
                  ({obj.bounding_box.x.toFixed(0)}×{obj.bounding_box.y.toFixed(0)})
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = { position: "fixed", top: 0, right: 0, width: 480, height: "100vh", background: "white", borderLeft: "1px solid #ddd", boxShadow: "-4px 0 16px rgba(0,0,0,0.1)", zIndex: 100, display: "flex", flexDirection: "column", overflow: "auto" };
const panelHeaderStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid #eee" };
const closeBtnStyle: React.CSSProperties = { background: "none", border: "none", fontSize: 16, cursor: "pointer", color: "#999", padding: "4px 8px" };
const warningStyle: React.CSSProperties = { padding: "8px 16px", background: "#fff3e0", borderTop: "1px solid #ffe0b2" };
const inputsStyle: React.CSSProperties = { padding: "12px 16px", borderTop: "1px solid #f0f0f0" };
const inputsTitle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 1, paddingBottom: 8 };
const inputRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "4px 0" };
const labelStyle: React.CSSProperties = { fontSize: 11, display: "flex", alignItems: "center", gap: 4 };
const numInputStyle: React.CSSProperties = { width: 60, padding: "3px 6px", border: "1px solid #ddd", borderRadius: 4, fontSize: 12 };
```

**Step 2: コミット**

```bash
git add frontend/src/components/PlacementPanel.tsx
git commit -m "Add PlacementPanel with 2D canvas drag and numeric input (#5)"
```

---

### Task 3-4: PlacementNode コンポーネントを作成

**Files:**
- Create: `frontend/src/nodes/PlacementNode.tsx`

**Step 1: PlacementNode を実装**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Position, type NodeProps, useReactFlow } from "@xyflow/react";
import type {
  BrepImportResult,
  StockSettings,
  PlacementItem,
} from "../types";
import { validatePlacement } from "../api";
import LabeledHandle from "./LabeledHandle";
import PlacementPanel from "../components/PlacementPanel";

export default function PlacementNode({ id }: NodeProps) {
  const [placements, setPlacements] = useState<PlacementItem[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showPanel, setShowPanel] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { getNode, getEdges, setNodes } = useReactFlow();

  // Read upstream data
  const edges = getEdges();
  const brepEdge = edges.find((e) => e.target === id && e.targetHandle === `${id}-brep`);
  const stockEdge = edges.find((e) => e.target === id && e.targetHandle === `${id}-stock`);
  const brepNode = brepEdge ? getNode(brepEdge.source) : null;
  const stockNode = stockEdge ? getNode(stockEdge.source) : null;
  const brepResult = brepNode?.data?.brepResult as BrepImportResult | undefined;
  const stockSettings = stockNode?.data?.stockSettings as StockSettings | undefined;

  // Auto-create placements when BREP data arrives
  useEffect(() => {
    if (!brepResult || !stockSettings) return;
    if (placements.length > 0) return; // already initialized

    const defaultMtl = stockSettings.materials[0]?.material_id ?? "mtl_1";
    const initial: PlacementItem[] = brepResult.objects.map((obj, i) => ({
      object_id: obj.object_id,
      material_id: defaultMtl,
      x_offset: 10 + i * 20,
      y_offset: 10 + i * 20,
      rotation: 0,
    }));
    setPlacements(initial);
    syncToNodeData(initial, brepResult, stockSettings);
  }, [brepResult, stockSettings]);

  const syncToNodeData = useCallback(
    (p: PlacementItem[], brep: BrepImportResult, stock: StockSettings) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id
            ? { ...n, data: { ...n.data, placementResult: { placements: p, stock, objects: brep.objects } } }
            : n
        )
      );
    },
    [id, setNodes]
  );

  const handlePlacementsChange = useCallback(
    async (updated: PlacementItem[]) => {
      setPlacements(updated);
      if (brepResult && stockSettings) {
        syncToNodeData(updated, brepResult, stockSettings);

        // Validate
        const bbs: Record<string, { x: number; y: number; z: number }> = {};
        for (const obj of brepResult.objects) {
          bbs[obj.object_id] = obj.bounding_box;
        }
        try {
          const result = await validatePlacement(updated, stockSettings, bbs);
          setWarnings(result.warnings);
        } catch {
          // validation failure is non-critical
        }
      }
    },
    [brepResult, stockSettings, syncToNodeData]
  );

  // Thumbnail draw
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !stockSettings || !brepResult) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const stock = stockSettings.materials[0];
    if (!stock) return;

    const scale = Math.min((w - 20) / stock.width, (h - 20) / stock.depth);
    const ox = (w - stock.width * scale) / 2;
    const oy = (h - stock.depth * scale) / 2;

    // Stock
    ctx.fillStyle = "#f0f0f0";
    ctx.fillRect(ox, h - oy - stock.depth * scale, stock.width * scale, stock.depth * scale);
    ctx.strokeStyle = "#999";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(ox, h - oy - stock.depth * scale, stock.width * scale, stock.depth * scale);

    // Parts
    const colors = ["#4a90d9", "#7b61ff", "#43a047", "#ef5350"];
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      const obj = brepResult.objects.find((o) => o.object_id === p.object_id);
      if (!obj) continue;
      const px = ox + p.x_offset * scale;
      const py = h - oy - (p.y_offset + obj.bounding_box.y) * scale;
      const pw = obj.bounding_box.x * scale;
      const ph = obj.bounding_box.y * scale;
      ctx.fillStyle = `${colors[i % colors.length]}33`;
      ctx.fillRect(px, py, pw, ph);
      ctx.strokeStyle = colors[i % colors.length];
      ctx.lineWidth = 1;
      ctx.strokeRect(px, py, pw, ph);
    }
  }, [placements, brepResult, stockSettings]);

  useEffect(() => { draw(); }, [draw]);

  const hasData = brepResult && stockSettings;

  return (
    <>
      <div style={nodeStyle}>
        <LabeledHandle type="target" position={Position.Top} id={`${id}-brep`} label="brep" dataType="geometry" index={0} total={2} />
        <LabeledHandle type="target" position={Position.Top} id={`${id}-stock`} label="stock" dataType="settings" index={1} total={2} />

        <div style={headerStyle}>Placement</div>

        {hasData ? (
          <>
            <canvas
              ref={canvasRef}
              width={200}
              height={150}
              style={canvasStyle}
              onClick={() => setShowPanel(true)}
            />
            <div style={hintStyle}>
              {placements.length} part{placements.length > 1 ? "s" : ""} — Click to edit
            </div>
            {warnings.length > 0 && (
              <div style={{ color: "#e65100", fontSize: 10, padding: "4px 0" }}>
                {warnings.length} warning{warnings.length > 1 ? "s" : ""}
              </div>
            )}
          </>
        ) : (
          <div style={emptyStyle}>Connect BREP + Stock</div>
        )}

        <LabeledHandle type="source" position={Position.Bottom} id={`${id}-out`} label="placement" dataType="geometry" />
      </div>

      {showPanel && hasData && createPortal(
        <PlacementPanel
          objects={brepResult.objects}
          stockSettings={stockSettings}
          placements={placements}
          onPlacementsChange={handlePlacementsChange}
          warnings={warnings}
          onClose={() => setShowPanel(false)}
        />,
        document.body
      )}
    </>
  );
}

const nodeStyle: React.CSSProperties = { background: "white", border: "1px solid #ddd", borderRadius: 8, padding: "20px 12px", minWidth: 200, maxWidth: 280, boxShadow: "0 2px 6px rgba(0,0,0,0.08)" };
const headerStyle: React.CSSProperties = { fontWeight: 700, fontSize: 13, marginBottom: 8, color: "#333" };
const canvasStyle: React.CSSProperties = { width: "100%", border: "1px solid #eee", borderRadius: 4, cursor: "pointer", background: "#fafafa" };
const hintStyle: React.CSSProperties = { fontSize: 10, color: "#aaa", textAlign: "center", marginTop: 2 };
const emptyStyle: React.CSSProperties = { color: "#999", fontSize: 11 };
```

**Step 2: コミット**

```bash
git add frontend/src/nodes/PlacementNode.tsx
git commit -m "Add PlacementNode with thumbnail canvas and panel integration (#5)"
```

---

### Task 3-5: App.tsx にPlacementNodeを組み込み、データフローを変更

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/Sidebar.tsx`

**Step 1: App.tsx を更新**

PlacementNode を import に追加:
```typescript
import PlacementNode from "./nodes/PlacementNode";
```

`nodeTypes` に追加:
```typescript
const nodeTypes = {
  brepImport: BrepImportNode,
  stock: StockNode,
  placement: PlacementNode,  // NEW
  operation: OperationNode,
  ...
};
```

`initialNodes` を更新（Placement ノードを追加し、position を調整）:
```typescript
const initialNodes = [
  { id: "1", type: "brepImport", position: { x: 100, y: 100 }, data: {} },
  { id: "2", type: "stock", position: { x: 400, y: 100 }, data: {} },
  { id: "9", type: "placement", position: { x: 250, y: 300 }, data: {} },   // NEW
  { id: "3", type: "operation", position: { x: 100, y: 500 }, data: {} },
  { id: "5", type: "postProcessor", position: { x: 400, y: 500 }, data: {} },
  { id: "6", type: "toolpathGen", position: { x: 250, y: 700 }, data: {} },
  { id: "7", type: "cncCode", position: { x: 150, y: 900 }, data: {} },
  { id: "8", type: "toolpathPreview", position: { x: 400, y: 900 }, data: {} },
];
```

`initialEdges` を更新（BREP/Stock → Placement → Operation）:
```typescript
const initialEdges = [
  { id: "e1-9", source: "1", sourceHandle: "1-out", target: "9", targetHandle: "9-brep" },
  { id: "e2-9", source: "2", sourceHandle: "2-out", target: "9", targetHandle: "9-stock" },
  { id: "e9-3", source: "9", sourceHandle: "9-out", target: "3", targetHandle: "3-brep" },
  { id: "e3-6", source: "3", sourceHandle: "3-out", target: "6", targetHandle: "6-operations" },
  { id: "e5-6", source: "5", sourceHandle: "5-out", target: "6", targetHandle: "6-postprocessor" },
  { id: "e6-7", source: "6", sourceHandle: "6-output", target: "7", targetHandle: "7-in" },
  { id: "e6-8", source: "6", sourceHandle: "6-toolpath", target: "8", targetHandle: "8-in" },
];
```

**Step 2: Sidebar.tsx を更新**

`nodeItems` 配列に Placement を追加（Stock の後に）:
```typescript
{ type: "placement", label: "Placement", color: "#26a69a" },
```

**Step 3: コミット**

```bash
git add frontend/src/App.tsx frontend/src/Sidebar.tsx
git commit -m "Wire PlacementNode into canvas and update data flow (#5)"
```

---

### Task 3-6: OperationNode を PlacementResult 入力に対応させる

**Files:**
- Modify: `frontend/src/nodes/OperationNode.tsx`

**Step 1: OperationNode の入力データ取得を修正**

現在 OperationNode は `brep` ハンドルで `BrepImportResult` を、`stock` ハンドルで `StockSettings` を直接受け取っている。PlacementNode 経由になると、`brep` ハンドルで `placementResult` を受け取る形に変わる。

`OperationNode.tsx` の `handleDetect` 内を修正:

```typescript
    // Find upstream data — either PlacementResult or direct BrepImportResult
    const brepEdge = edges.find(
      (e) => e.target === id && e.targetHandle === `${id}-brep`
    );
    if (!brepEdge) {
      setError("Connect Placement or BREP Import node first");
      setStatus("error");
      return;
    }
    const upstreamNode = getNode(brepEdge.source);

    // Try PlacementResult first (from PlacementNode)
    const placementResult = upstreamNode?.data?.placementResult as
      | { placements: any[]; stock: StockSettings; objects: BrepObject[] }
      | undefined;

    let brepResult: BrepImportResult | undefined;
    let upstreamStock: StockSettings | undefined;

    if (placementResult) {
      // PlacementNode upstream: extract brep + stock from placement result
      brepResult = upstreamNode?.data?.placementResult
        ? {
            file_id: (upstreamNode?.data as any)?.placementResult?.objects?.[0]?.file_name ?? "",
            objects: placementResult.objects,
            object_count: placementResult.objects.length,
          } as BrepImportResult
        : undefined;
      upstreamStock = placementResult.stock;
    } else {
      // Direct BrepImportResult (backwards-compatible)
      brepResult = upstreamNode?.data?.brepResult as BrepImportResult | undefined;
      // Stock from separate edge
      const stockEdge = edges.find(
        (e) => e.target === id && e.targetHandle === `${id}-stock`
      );
      const stockNode = stockEdge ? getNode(stockEdge.source) : null;
      upstreamStock = stockNode?.data?.stockSettings as StockSettings | undefined;
    }
```

**重要:** OperationNode は `brepResult.file_id` を使って `detectOperations` API を呼ぶ。PlacementResult には `file_id` が含まれない。`file_id` を PlacementResult に追加するか、PlacementNode のデータに含める必要がある。

PlacementNode の `syncToNodeData` で `file_id` も含めるように修正:

PlacementNode.tsx の `syncToNodeData` を修正:
```typescript
const syncToNodeData = useCallback(
  (p: PlacementItem[], brep: BrepImportResult, stock: StockSettings) => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id
          ? {
              ...n,
              data: {
                ...n.data,
                placementResult: { placements: p, stock, objects: brep.objects },
                fileId: brep.file_id,  // Pass file_id through for downstream
              },
            }
          : n
      )
    );
  },
  [id, setNodes]
);
```

OperationNode での `detectOperations` 呼び出しで `file_id` を取得:
```typescript
    // Get file_id for API call
    const fileId = placementResult
      ? (upstreamNode?.data?.fileId as string)
      : brepResult?.file_id;

    if (!fileId) {
      setError("Upload a STEP file first");
      setStatus("error");
      return;
    }
```

`stock` ハンドルの接続は PlacementNode 経由の場合は不要になるが、後方互換のために残す。

**Step 2: コミット**

```bash
git add frontend/src/nodes/OperationNode.tsx frontend/src/nodes/PlacementNode.tsx
git commit -m "Update OperationNode to accept PlacementResult input (#5)"
```

---

### Task 3-7: 全体動作確認

**Step 1: バックエンドテスト全実行**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run python -m pytest tests/ -v`
Expected: ALL PASS

**Step 2: フロントエンドビルド確認**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/frontend && npm run build`
Expected: ビルド成功

**Step 3: `make dev` でフルパイプライン動作確認**

1. STEP ファイルをインポート → 3Dプレビュー表示
2. Stock を設定
3. **Placement ノード** で部品を配置（ドラッグ + 数値入力）
4. Operation を検出
5. Toolpath を生成
6. Toolpath Preview で原点軸 + Stock 範囲を確認
7. CNC Code を確認

---

## 注意事項

- **build123d `tessellate()` の tolerance**: 値が小さいほど精密だがデータが大きくなる。デフォルト 0.5mm で開始し、必要に応じて調整。
- **Three.js バンドルサイズ**: Three.js は大きいライブラリ。v1ではそのまま使うが、将来的には動的 import で遅延読み込みを検討。
- **PlacementNode の rotation**: v1 では 0 固定。UI にフィールドは含めない。
- **後方互換**: OperationNode は PlacementNode なしでも直接 BrepImportResult を受け取れるようにする。
