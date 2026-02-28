# 3D PreviewNode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 独立した3Dプレビューノードを作成し、既存ノードの内蔵プレビューを廃止して統一する

**Architecture:** `PreviewNode` は `useUpstreamData` で上流の `brepResult` を取得し、`fetchMeshData` でメッシュを取得、ノード内にインライン `MeshViewer`（200x150）を表示する。クリックでサイドパネルに `BrepImportPanel` を拡大表示。`brepResult` は `setNodes` でパススルー出力。既存の AiCadNode / BrepImportNode から meshes state・fetchMeshData・View 3D ボタンを削除。

**Tech Stack:** React, React Flow, @react-three/fiber, three.js, TypeScript

**Design doc:** `docs/plans/2026-02-28-3d-preview-node-design.md`

---

### Task 1: PreviewNode — 基本スケルトン作成

**Files:**
- Create: `frontend/src/nodes/PreviewNode.tsx`
- Modify: `frontend/src/nodeRegistry.ts:27-41` (1行追加)

**Step 1: PreviewNode のスケルトンを作成**

`frontend/src/nodes/PreviewNode.tsx`:

```tsx
import { memo, useState, useEffect, useCallback } from "react";
import { type NodeProps, useReactFlow } from "@xyflow/react";
import { LabeledHandle } from "./LabeledHandle";
import { useUpstreamData } from "../hooks/useUpstreamData";
import { usePanelTabs } from "../components/PanelTabsContext";
import { MeshViewer } from "../components/MeshViewer";
import { BrepImportPanel } from "../components/BrepImportPanel";
import { fetchMeshData } from "../api";
import type { BrepImportResult, ObjectMesh } from "../types";

function PreviewNodeInner({ id }: NodeProps) {
  const { setNodes } = useReactFlow();
  const { openTab } = usePanelTabs();

  const brepResult = useUpstreamData<BrepImportResult>(
    id,
    `${id}-brep`,
    (d) => d.brepResult as BrepImportResult | undefined,
  );

  const [meshes, setMeshes] = useState<ObjectMesh[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch mesh data when brepResult changes
  useEffect(() => {
    if (!brepResult?.file_id) {
      setMeshes([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchMeshData(brepResult.file_id)
      .then((data) => {
        if (!cancelled) setMeshes(data.objects);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Mesh fetch failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [brepResult?.file_id]);

  // Pass-through brepResult to downstream
  useEffect(() => {
    setNodes((nodes) =>
      nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, brepResult: brepResult ?? null } } : n,
      ),
    );
  }, [id, brepResult, setNodes]);

  // Open side panel with full 3D view
  const handleExpand = useCallback(() => {
    if (!brepResult) return;
    openTab({
      id: `preview-3d-${id}`,
      label: "3D View",
      icon: "📦",
      content: <BrepImportPanel brepResult={brepResult} meshes={meshes} />,
    });
  }, [id, brepResult, meshes, openTab]);

  return (
    <div style={{ background: "#1e1e1e", borderRadius: 8, padding: 8, width: 220 }}>
      <LabeledHandle type="target" id={`${id}-brep`} label="brep" dataType="geometry" />

      <div style={{ fontSize: 11, color: "#ccc", marginBottom: 4, fontWeight: 600 }}>
        3D Preview
      </div>

      <div
        style={{ width: 200, height: 150, borderRadius: 4, overflow: "hidden", background: "#111", cursor: brepResult ? "pointer" : "default" }}
        onClick={handleExpand}
        onPointerDown={(e) => e.stopPropagation()}
        onWheelCapture={(e) => e.stopPropagation()}
      >
        {!brepResult && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#666", fontSize: 11 }}>
            Connect upstream node
          </div>
        )}
        {brepResult && loading && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#888", fontSize: 11 }}>
            Loading...
          </div>
        )}
        {brepResult && error && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#f44", fontSize: 11 }}>
            {error}
          </div>
        )}
        {brepResult && !loading && !error && meshes.length > 0 && (
          <MeshViewer meshes={meshes} style={{ width: 200, height: 150 }} />
        )}
      </div>

      <LabeledHandle type="source" id={`${id}-out`} label="out" dataType="geometry" />
    </div>
  );
}

export const PreviewNode = memo(PreviewNodeInner);
```

**Step 2: nodeRegistry.ts に登録**

`frontend/src/nodeRegistry.ts` の `NODE_REGISTRY` オブジェクト内、`codeNode` の後に追加:

```ts
import { PreviewNode } from "./nodes/PreviewNode";
```

```ts
  preview:         { component: PreviewNode,           label: "3D Preview",      category: "cad"     },
```

**Step 3: 動作確認**

Run: `make front` でフロントエンドを起動
Expected: Sidebar の CAD カテゴリに「3D Preview」が表示される。ノードをキャンバスにドロップできる。

**Step 4: Commit**

```bash
git add frontend/src/nodes/PreviewNode.tsx frontend/src/nodeRegistry.ts
git commit -m "feat: add 3D PreviewNode with inline MeshViewer and pass-through"
```

---

### Task 2: 接続テスト — CodeNode → PreviewNode の動作確認

**Files:** なし（手動テスト）

**Step 1: フロー接続テスト**

1. `make dev` でフル起動
2. CodeNode → PreviewNode → PlacementNode のフローを構築
3. CodeNode でコード実行（例: `Box(10, 10, 5)`）
4. PreviewNode に3Dプレビューが表示されることを確認
5. PreviewNode をクリックしてサイドパネルに拡大3Dが表示されることを確認
6. PlacementNode に brepResult がパススルーされていることを確認

**Step 2: 問題があれば修正して commit**

---

### Task 3: AiCadNode から内蔵プレビューを削除

**Files:**
- Modify: `frontend/src/nodes/AiCadNode.tsx`

**Step 1: meshes state を削除**

AiCadNode.tsx から以下を削除:
- `import { fetchMeshData } from "../api";` （他に使っていなければ）
- `import type { ObjectMesh } from "../types";` （他に使っていなければ）
- `const [meshes, setMeshes] = useState<ObjectMesh[]>([]);` (28行目付近)

**Step 2: fetchMeshData 呼び出しを3箇所削除**

handleGenerate 内 (57-62行目付近):
```tsx
// 削除:
try {
  const meshData = await fetchMeshData(data.file_id);
  setMeshes(meshData.objects);
} catch {
  // non-critical
}
```

handleCodeRerun 内 (83-86行目付近):
```tsx
// 削除:
try {
  const meshData = await fetchMeshData(data.file_id);
  setMeshes(meshData.objects);
} catch {}
```

handleApplyRefinement 内 (110-113行目付近):
```tsx
// 削除:
try {
  const meshData = await fetchMeshData(refineResult.file_id);
  setMeshes(meshData.objects);
} catch {}
```

**Step 3: handleView3D と View 3D ボタンを削除**

handleView3D コールバック (136-144行目付近):
```tsx
// 削除:
const handleView3D = useCallback(() => {
  if (!result) return;
  openTab({
    id: `ai-cad-3d-${id}`,
    label: "3D View",
    icon: "📦",
    content: <BrepImportPanel brepResult={result} meshes={meshes} />,
  });
}, [id, result, meshes, openTab]);
```

View 3D ボタン (225-229行目付近):
```tsx
// 削除:
{meshes.length > 0 && (
  <button onClick={handleView3D} style={viewBtnStyle}>
    View 3D
  </button>
)}
```

**Step 4: 不要になった import を整理**

`BrepImportPanel`, `usePanelTabs` (openTab) が他で使われていなければ import も削除。
ただし `openTab` は AiCadPanel（チャットパネル）等で使われている可能性があるので確認。

**Step 5: ビルド確認**

Run: `cd frontend && npx tsc --noEmit`
Expected: エラーなし

**Step 6: Commit**

```bash
git add frontend/src/nodes/AiCadNode.tsx
git commit -m "refactor: remove built-in 3D preview from AiCadNode (use PreviewNode instead)"
```

---

### Task 4: BrepImportNode から内蔵プレビューを削除

**Files:**
- Modify: `frontend/src/nodes/BrepImportNode.tsx`

**Step 1: meshes state を削除**

BrepImportNode.tsx から以下を削除:
- `const [meshes, setMeshes] = useState<ObjectMesh[]>([]);` (18行目付近)

**Step 2: fetchMeshData 呼び出しを削除**

handleFile 内 (37-41行目付近):
```tsx
// 削除:
try {
  const meshData = await fetchMeshData(data.file_id);
  setMeshes(meshData.objects);
} catch {
  // Mesh fetch failure is non-critical, preview just won't show
}
```

**Step 3: handleView3D と View 3D ボタンを削除**

handleView3D コールバック (78-86行目付近):
```tsx
// 削除:
const handleView3D = useCallback(() => {
  if (!result) return;
  openTab({
    id: `brep-3d-${id}`,
    label: "3D View",
    icon: "📦",
    content: <BrepImportPanel brepResult={result} meshes={meshes} />,
  });
}, [id, result, meshes, openTab]);
```

View 3D ボタン (138-141行目付近):
```tsx
// 削除:
{meshes.length > 0 && (
  <button onClick={handleView3D} style={viewBtnStyle}>
    View 3D
  </button>
)}
```

**Step 4: 不要になった import を整理**

`fetchMeshData`, `ObjectMesh`, `BrepImportPanel`, `usePanelTabs` が他で使われていなければ import も削除。

**Step 5: ビルド確認**

Run: `cd frontend && npx tsc --noEmit`
Expected: エラーなし

**Step 6: Commit**

```bash
git add frontend/src/nodes/BrepImportNode.tsx
git commit -m "refactor: remove built-in 3D preview from BrepImportNode (use PreviewNode instead)"
```

---

### Task 5: 統合テスト

**Files:** なし（手動テスト）

**Step 1: 全フローの動作確認**

`make dev` で起動し、以下のフローを確認:

1. **BrepImportNode → PreviewNode → PlacementNode**
   - STEPファイルアップロード → PreviewNode に3D表示 → PlacementNode に配置データがパススルー

2. **AiCadNode → PreviewNode → PlacementNode**
   - AI生成 → PreviewNode に3D表示 → PlacementNode に配置データがパススルー

3. **CodeNode → PreviewNode → PlacementNode**
   - コード実行 → PreviewNode に3D表示 → PlacementNode に配置データがパススルー

4. **PreviewNode 単体（未接続）**
   - 「Connect upstream node」が表示されること

5. **サイドパネル拡大**
   - PreviewNode クリック → サイドパネルに BrepImportPanel（寸法情報付き）が表示

**Step 2: 問題があれば修正して commit**

**Step 3: 最終 commit（必要に応じて）**

```bash
git commit -m "test: verify PreviewNode integration with all upstream nodes"
```

---

### Task 6: SnippetDbNode のサムネイル生成を確認

**Files:** なし（確認のみ）

**Step 1: SnippetDbNode の動作確認**

SnippetDbNode は `fetchMeshData` を独自に使用（オフスクリーンサムネイル生成用）。
これは PreviewNode とは独立した用途なので、影響がないことを確認。

- SnippetDbNode でスニペット保存 → サムネイルが正常に生成されること

**Step 2: 問題なければ完了**
