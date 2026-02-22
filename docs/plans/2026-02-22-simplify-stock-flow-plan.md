# Stock データフロー簡素化 — 実装計画

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stock → Toolpath Gen の直接接続を削除し、Operation ノード経由で stock 情報を渡す

**Architecture:** OperationNode が `syncToNodeData` で `stockSettings` も node data に保存し、ToolpathGenNode が Operation ノードから stock 情報を取得する。エッジとハンドルを整理してUIをシンプルにする。

**Tech Stack:** React, React Flow, TypeScript

---

### Task 1: OperationNode — stockSettings を node data に保存

**Files:**
- Modify: `frontend/src/nodes/OperationNode.tsx:25-36`

**Step 1: syncToNodeData に stockSettings を追加**

`syncToNodeData` 関数を変更し、`detectedOperations` と `assignments` に加えて `stockSettings` も node data に保存する。

```typescript
const syncToNodeData = useCallback(
  (det: OperationDetectResult, assign: OperationAssignment[], stock: StockSettings | null) => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, detectedOperations: det, assignments: assign, stockSettings: stock } }
          : n
      )
    );
  },
  [id, setNodes]
);
```

**Step 2: syncToNodeData の全呼び出し箇所を更新**

3箇所の呼び出しに `stockSettings` 引数を追加:

- `handleDetect` 内 (line 85): `syncToNodeData(result, newAssignments, upstreamStock ?? null);`
- `handleToggleOp` 内 (line 99): `if (detected) syncToNodeData(detected, updated, stockSettings);`
- `handleAssignmentsChange` 内 (line 109): `if (detected) syncToNodeData(detected, updated, stockSettings);`

**Step 3: フロントエンドビルド確認**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/frontend && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add frontend/src/nodes/OperationNode.tsx
git commit -m "feat: pass stockSettings through OperationNode data"
```

---

### Task 2: ToolpathGenNode — Stock を Operation 経由で取得

**Files:**
- Modify: `frontend/src/nodes/ToolpathGenNode.tsx:48-65` (stock取得ロジック)
- Modify: `frontend/src/nodes/ToolpathGenNode.tsx:136-162` (ハンドル)

**Step 1: Stock 取得ロジックを変更**

Stock を別エッジから取得するのではなく、Operation ノード（opsNode）から取得する。
lines 48-65 の stock 取得ブロックを以下に置き換え:

```typescript
// 2. Get stock settings from OperationNode (passed through)
const stockSettings = opsNode?.data?.stockSettings as
  | StockSettings
  | undefined;
if (!stockSettings || stockSettings.materials.length === 0) {
  setError("Configure Stock settings first");
  setStatus("error");
  return;
}
```

**Step 2: stock ハンドルを削除**

`6-stock` の LabeledHandle を削除し、残り2つのハンドルの `total` を `2` に変更:

```tsx
<LabeledHandle
  type="target"
  position={Position.Top}
  id={`${id}-operations`}
  label="operations"
  dataType="geometry"
  index={0}
  total={2}
/>
<LabeledHandle
  type="target"
  position={Position.Top}
  id={`${id}-postprocessor`}
  label="post proc"
  dataType="settings"
  index={1}
  total={2}
/>
```

**Step 3: StockSettings の import を整理**

`StockSettings` は引き続き使用するので import は残す（変更不要）。

**Step 4: フロントエンドビルド確認**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/frontend && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add frontend/src/nodes/ToolpathGenNode.tsx
git commit -m "refactor: get stock settings from Operation node instead of direct Stock connection"
```

---

### Task 3: App.tsx — Stock → Toolpath Gen エッジを削除

**Files:**
- Modify: `frontend/src/App.tsx:36`

**Step 1: e2-6 エッジを削除**

`initialEdges` から以下の行を削除:

```typescript
{ id: "e2-6", source: "2", sourceHandle: "2-out", target: "6", targetHandle: "6-stock" },
```

**Step 2: フロントエンドビルド確認**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "refactor: remove redundant Stock → Toolpath Gen edge"
```

---

### Task 4: 動作確認

**Step 1: dev サーバー起動**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner && make dev`

**Step 2: 手動確認項目**

1. キャンバス上で Stock → Toolpath Gen の接続線がないことを確認
2. Toolpath Gen ノードに stock ハンドルがなく、operations と post proc の2つだけであることを確認
3. STEP ファイルをアップロード → Detect Operations → Generate → Download SBP の一連のフローが動作すること
4. 生成されるSBPが以前と同一であること（stock thickness が正しく伝播している）
