# MergeNode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 複数の geometry 系ノードの brepResult を結合して1つの出力にまとめるマージノードを作る

**Architecture:** フロントエンド完結。React Flow の edges を監視して動的に入力ポートを増減し、接続された全上流の `brepResult.objects` を結合して `node.data.brepResult` に書き込む。既存の `useUpstreamData` は単一ハンドル向けなので、複数ハンドル用の `useMultiUpstreamData` カスタムフックを新設する。

**Tech Stack:** React, React Flow, TypeScript

---

### Task 1: useMultiUpstreamData フック

複数の動的入力ハンドルから上流データを一括取得するカスタムフック。

**Files:**
- Create: `frontend/src/hooks/useMultiUpstreamData.ts`

**Step 1: フックを作成**

```typescript
// frontend/src/hooks/useMultiUpstreamData.ts
import { useMemo } from "react";
import { useStore } from "@xyflow/react";

type StoreState = {
  edges: { target: string; targetHandle?: string | null; source: string }[];
  nodeLookup: Map<string, { data: Record<string, unknown> }>;
};

/**
 * Subscribe to multiple upstream nodes' data via dynamically numbered target handles.
 * Returns an array of extracted data (one per connected handle), skipping unconnected ones.
 */
export function useMultiUpstreamData<T>(
  nodeId: string,
  handlePrefix: string,
  handleCount: number,
  extract: (data: Record<string, unknown>) => T | undefined,
): T[] {
  const selector = useMemo(
    () => (s: StoreState) => {
      const results: T[] = [];
      for (let i = 0; i < handleCount; i++) {
        const handleId = `${handlePrefix}-${i}`;
        const edge = s.edges.find(
          (e) => e.target === nodeId && e.targetHandle === handleId,
        );
        if (!edge) continue;
        const node = s.nodeLookup.get(edge.source);
        if (!node?.data) continue;
        const val = extract(node.data);
        if (val !== undefined) results.push(val);
      }
      return results;
    },
    [nodeId, handlePrefix, handleCount, extract],
  );

  return useStore(selector, arrShallowEqual);
}

function arrShallowEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}
```

**Step 2: 動作確認**

Run: `cd frontend && npx tsc --noEmit`
Expected: コンパイルエラーなし

---

### Task 2: MergeNode コンポーネント

動的ポート + マージロジック + UI を持つノード本体。

**Files:**
- Create: `frontend/src/nodes/MergeNode.tsx`

**Step 1: MergeNode を作成**

```tsx
// frontend/src/nodes/MergeNode.tsx
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { type NodeProps, useReactFlow, useStore } from "@xyflow/react";
import LabeledHandle from "./LabeledHandle";
import NodeShell from "../components/NodeShell";
import { useMultiUpstreamData } from "../hooks/useMultiUpstreamData";
import type { BrepImportResult } from "../types";

const MIN_PORTS = 2;

function MergeNodeInner({ id, selected }: NodeProps) {
  const { setNodes } = useReactFlow();

  // Count connected edges to determine port count
  const connectedCount = useStore(
    useCallback(
      (s: { edges: { target: string; targetHandle?: string | null }[] }) =>
        s.edges.filter(
          (e) => e.target === id && e.targetHandle?.startsWith(`${id}-in-`),
        ).length,
      [id],
    ),
  );

  // Always keep one empty port available
  const handleCount = Math.max(MIN_PORTS, connectedCount + 1);

  const extract = useCallback(
    (d: Record<string, unknown>) => d.brepResult as BrepImportResult | undefined,
    [],
  );

  const upstreamResults = useMultiUpstreamData<BrepImportResult>(
    id,
    `${id}-in`,
    handleCount,
    extract,
  );

  // Merge objects from all connected upstream nodes
  const merged = useMemo<BrepImportResult | null>(() => {
    if (upstreamResults.length === 0) return null;
    const allObjects = upstreamResults.flatMap((r) => r.objects);
    const fileIds = upstreamResults
      .map((r) => r.file_id)
      .sort()
      .join("+");
    return {
      file_id: `merged-${fileIds}`,
      objects: allObjects,
      object_count: allObjects.length,
    };
  }, [upstreamResults]);

  // Write merged result to node data
  const prevRef = useRef(merged);
  useEffect(() => {
    if (merged === prevRef.current) return;
    prevRef.current = merged;
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, brepResult: merged } } : n,
      ),
    );
  }, [id, merged, setNodes]);

  return (
    <NodeShell category="utility" selected={selected} width={180}>
      {Array.from({ length: handleCount }, (_, i) => (
        <LabeledHandle
          key={i}
          type="target"
          id={`${id}-in-${i}`}
          label={`in ${i + 1}`}
          dataType="geometry"
          index={i}
          total={handleCount}
        />
      ))}

      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, color: "var(--text-primary)" }}>
        Merge
      </div>

      <div style={{ fontSize: 11, color: "var(--text-secondary)", minHeight: 20 }}>
        {upstreamResults.length === 0
          ? "Connect geometry nodes"
          : `${merged?.object_count ?? 0} objects from ${upstreamResults.length} sources`}
      </div>

      <LabeledHandle type="source" id={`${id}-out`} label="out" dataType="geometry" />
    </NodeShell>
  );
}

const MergeNode = memo(MergeNodeInner);
export default MergeNode;
```

**Step 2: 型チェック**

Run: `cd frontend && npx tsc --noEmit`
Expected: コンパイルエラーなし

---

### Task 3: ノードレジストリ登録

MergeNode を nodeRegistry に追加してサイドバーからドラッグ＆ドロップ可能にする。

**Files:**
- Modify: `frontend/src/nodeRegistry.ts`

**Step 1: import と登録を追加**

`nodeRegistry.ts` の import セクションに追加:
```typescript
import MergeNode from "./nodes/MergeNode";
```

`NODE_REGISTRY` に追加（`align` の後、`utility` カテゴリとして）:
```typescript
  merge: { component: MergeNode, label: "Merge", category: "utility" },
```

**Step 2: 型チェック**

Run: `cd frontend && npx tsc --noEmit`
Expected: コンパイルエラーなし

**Step 3: コミット**

```bash
git add frontend/src/hooks/useMultiUpstreamData.ts frontend/src/nodes/MergeNode.tsx frontend/src/nodeRegistry.ts
git commit -m "feat: add MergeNode with dynamic ports for combining geometry sources"
```

---

### Task 4: 動作確認

**Step 1: 開発サーバー起動**

Run: `make dev`

**Step 2: 手動テスト**

1. サイドバーの Utility グループから Merge ノードをキャンバスにドラッグ
2. BrepImport → Merge の in 1 に接続 → 3つ目のポートが自動追加されることを確認
3. AiCad or Code → Merge の in 2 に接続 → 4つ目のポートが自動追加されることを確認
4. Merge の out → Placement の brep に接続 → objects が結合されて渡ることを確認
5. エッジを切断 → 空ポートが減ることを確認

**Step 3: 最終コミット（必要なら修正後）**

```bash
git add -A
git commit -m "fix: merge node adjustments after manual testing"
```
