# Sheet Management Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** activeStockId を PlacementNode で一元管理し、下流ノードのタブを廃止してバッジ表示に統一する

**Architecture:** PlacementNode が唯一の activeStockId state 保持者。下流ノードは useUpstreamData で読むだけにし、syncToNodeData でパススルー。下流 UI は StockTabs → StockBadge に置き換え。

**Tech Stack:** React, TypeScript, React Flow

---

### Task 1: StockBadge コンポーネント作成

**Files:**
- Create: `frontend/src/components/StockBadge.tsx`

**Step 1: StockBadge コンポーネントを作成**

```tsx
interface StockBadgeProps {
  activeStockId: string;
  totalStocks: number;
}

export function StockBadge({ activeStockId, totalStocks }: StockBadgeProps) {
  if (totalStocks <= 1) return null;

  const sheetNum = activeStockId.replace("stock_", "");

  return (
    <div
      style={{
        display: "inline-block",
        padding: "1px 8px",
        borderRadius: 10,
        backgroundColor: "#4a90d9",
        color: "#fff",
        fontSize: 10,
        fontWeight: 600,
        lineHeight: "18px",
      }}
    >
      Sheet {sheetNum}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/components/StockBadge.tsx
git commit -m "Add StockBadge component for read-only sheet indicator"
```

---

### Task 2: OperationNode — ローカル state 削除 & StockBadge 導入

**Files:**
- Modify: `frontend/src/nodes/OperationNode.tsx`

**Step 1: activeStockId ローカル state を削除**

以下を削除:
- 行34: `const [activeStockId, setActiveStockId] = useState("stock_1");`
- 行35: `const prevUpstreamStockRef = useRef<string | undefined>();`
- 行47-54: upstream同期の `useEffect`
- 行63-68: fallback の `useEffect`
- 行170-175: `handleStockChange`

**Step 2: upstream から activeStockId を読み取るように変更**

`extractUpstream` （または既存の upstream 抽出）で `activeStockId` を含めるようにする。現在の `upstream` オブジェクトに `activeStockId` が含まれているか確認し、含まれていなければ追加する。

`activeStockId` の参照を全て `upstream?.activeStockId ?? "stock_1"` に変更。

**Step 3: syncToNodeData の activeStockId をパススルーに変更**

行76-92 の `syncToNodeData` で、引数の `stockId` を `upstream?.activeStockId ?? "stock_1"` に固定:

```tsx
const syncToNodeData = useCallback(
  (det, assign, stock, plc, objects) => {
    const sid = upstream?.activeStockId ?? "stock_1";
    const objectOrigins: Record<string, [number, number]> = {};
    for (const obj of objects) {
      objectOrigins[obj.object_id] = [obj.origin.position[0], obj.origin.position[1]];
    }
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, detectedOperations: det, assignments: assign, stockSettings: stock, placements: plc, objectOrigins, activeStockId: sid } }
          : n
      )
    );
  },
  [id, setNodes, upstream?.activeStockId]
);
```

**Step 4: StockTabs を StockBadge に置き換え**

行248-255 のJSXを:

```tsx
{stockIds.length > 1 && (
  <StockBadge
    activeStockId={upstream?.activeStockId ?? "stock_1"}
    totalStocks={stockIds.length}
  />
)}
```

import も `StockTabs` → `StockBadge` に変更。

**Step 5: OperationDetailPanel の props から StockTabs 関連を削除**

`OperationDetailPanel` への props 渡しから `onActiveStockChange` を削除（もう操作不可のため）。

**Step 6: Commit**

```bash
git add frontend/src/nodes/OperationNode.tsx
git commit -m "Remove local activeStockId state from OperationNode, use upstream passthrough"
```

---

### Task 3: OperationDetailPanel — StockTabs を StockBadge に置き換え

**Files:**
- Modify: `frontend/src/components/OperationDetailPanel.tsx`

**Step 1: Props から `onActiveStockChange` を削除**

行17-19 の props 定義を変更:
```tsx
stockIds: string[];
activeStockId: string;
// onActiveStockChange は削除
```

**Step 2: StockTabs を StockBadge に置き換え**

行70-76 を:
```tsx
{stockIds.length > 1 && (
  <StockBadge
    activeStockId={activeStockId}
    totalStocks={stockIds.length}
  />
)}
```

import を `StockBadge` に変更。

**Step 3: Commit**

```bash
git add frontend/src/components/OperationDetailPanel.tsx
git commit -m "Replace StockTabs with StockBadge in OperationDetailPanel"
```

---

### Task 4: ToolpathGenNode — ローカル state 削除 & StockBadge 導入

**Files:**
- Modify: `frontend/src/nodes/ToolpathGenNode.tsx`

**Step 1: activeStockId ローカル state を削除**

以下を削除:
- 行33: `const [activeStockId, setActiveStockId] = useState("stock_1");`
- 行34: `const prevUpstreamStockRef = useRef<string | undefined>();`
- 行49-56: upstream同期の `useEffect`
- 行65-70: fallback の `useEffect`

**Step 2: upstream から activeStockId を取得**

`extractOperations` 内の `upstreamActiveStockId`（行43）を利用して、全ての `activeStockId` 参照を `operations?.upstreamActiveStockId ?? "stock_1"` に変更。

**Step 3: setNodes 内の activeStockId をパススルーに**

行144 の `activeStockId` を `operations?.upstreamActiveStockId ?? "stock_1"` に変更。

**Step 4: StockTabs を StockBadge に置き換え**

行192-199 を:
```tsx
{stockIds.length > 1 && (
  <StockBadge
    activeStockId={operations?.upstreamActiveStockId ?? "stock_1"}
    totalStocks={stockIds.length}
  />
)}
```

**Step 5: useEffect の依存配列を更新**

行165 あたりの生成 useEffect の依存配列から `activeStockId` を `operations?.upstreamActiveStockId` に変更。

**Step 6: Commit**

```bash
git add frontend/src/nodes/ToolpathGenNode.tsx
git commit -m "Remove local activeStockId state from ToolpathGenNode, use upstream passthrough"
```

---

### Task 5: ToolpathPreviewNode & CncCodeNode — StockTabs を StockBadge に置き換え

**Files:**
- Modify: `frontend/src/nodes/ToolpathPreviewNode.tsx`
- Modify: `frontend/src/nodes/CncCodeNode.tsx`

**Step 1: ToolpathPreviewNode の StockTabs を StockBadge に**

行151-158 を:
```tsx
{upstream && upstream.allStockIds.length > 1 && (
  <StockBadge
    activeStockId={upstream.activeStockId}
    totalStocks={upstream.allStockIds.length}
  />
)}
```

**Step 2: CncCodeNode の StockTabs を StockBadge に**

行139-146 を:
```tsx
{stockInfo && stockInfo.allStockIds.length > 1 && (
  <StockBadge
    activeStockId={stockInfo.activeStockId}
    totalStocks={stockInfo.allStockIds.length}
  />
)}
```

**Step 3: 両ファイルの import を更新**

`StockTabs` の import を `StockBadge` に変更。

**Step 4: Commit**

```bash
git add frontend/src/nodes/ToolpathPreviewNode.tsx frontend/src/nodes/CncCodeNode.tsx
git commit -m "Replace StockTabs with StockBadge in ToolpathPreviewNode and CncCodeNode"
```

---

### Task 6: StockTabs — スクロール対応 & 不要 props 削除

**Files:**
- Modify: `frontend/src/components/StockTabs.tsx`

**Step 1: `readOnly` と `size` props を削除**

もう PlacementPanel でしか使われないため:
- `readOnly` prop と関連ロジック（行34 の条件分岐）を削除
- `size` prop とスタイル分岐を削除（"normal" サイズのみ残す）

**Step 2: スクロール対応を追加**

コンテナに overflow-x: auto を追加:
```tsx
<div style={{
  display: "flex",
  gap: 4,
  overflowX: "auto",
  scrollbarWidth: "thin",
  maxWidth: "100%",
}}>
  {stockIds.map(...)}
</div>
```

**Step 3: Commit**

```bash
git add frontend/src/components/StockTabs.tsx
git commit -m "Simplify StockTabs for PlacementPanel-only use, add scroll support"
```

---

### Task 7: 不要 import の削除 & StockTabs 参照確認

**Files:**
- Modify: 全変更ファイル

**Step 1: StockTabs の import が PlacementPanel 以外に残っていないことを確認**

```bash
grep -r "StockTabs" frontend/src/ --include="*.tsx" --include="*.ts"
```

PlacementPanel.tsx のみにあることを確認。

**Step 2: useState, useRef の不要 import を削除**

OperationNode と ToolpathGenNode で `useRef` が不要になった場合は import から削除。

**Step 3: TypeScript ビルド確認**

```bash
cd frontend && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add -A
git commit -m "Clean up unused imports after sheet management refactor"
```

---

### Task 8: 動作確認

**Step 1: `make dev` で起動**

**Step 2: 手動テスト**

1. STEPファイルをアップロード
2. Auto Nesting で複数シートが生成されることを確認
3. PlacementPanel でシートタブを切り替え → 下流ノード全てに即座に反映されることを確認
4. 下流ノードにはタブがなく、バッジ「Sheet N」が表示されていることを確認
5. シート1枚の場合はバッジが非表示であることを確認
6. ToolpathGenNode の生成がアクティブシート切り替えで正しく再実行されることを確認
7. CncCodeNode の ZIP ダウンロードが正常に動作することを確認

**Step 3: 問題があれば修正して Commit**
