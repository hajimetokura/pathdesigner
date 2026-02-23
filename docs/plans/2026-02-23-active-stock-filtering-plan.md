# Active Stock Filtering 実装計画

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** PlacementNode以外の全ノード（Operation, ToolpathGen, ToolpathPreview, CncCode）とサイドパネルに、アクティブストック別フィルタリングとストックタブUIを追加する。

**Architecture:** 各ノードがローカルの `activeStockId` state を持ち、上流ノードの変更に自動追従する。共通の `StockTabs` コンポーネントを抽出して全ノードで再利用。Operation/ToolpathGen は切替可能タブ、Preview/CncCode は読み取り専用インジケータ。

**Tech Stack:** React, TypeScript, React Flow

---

## Task 1: StockTabs 共通コンポーネントを作成

**Files:**
- Create: `frontend/src/components/StockTabs.tsx`

**Step 1: StockTabs コンポーネントを作成**

PlacementPanel の既存タブUI（lines 300-322）をベースに再利用可能コンポーネントを作成する。

```tsx
// frontend/src/components/StockTabs.tsx
import { useMemo } from "react";

interface StockTabsProps {
  stockIds: string[];
  activeStockId: string;
  onChange?: (stockId: string) => void;
  readOnly?: boolean;
  size?: "small" | "normal";
  /** Optional: show part count per stock */
  counts?: Record<string, number>;
}

export default function StockTabs({
  stockIds,
  activeStockId,
  onChange,
  readOnly = false,
  size = "normal",
  counts,
}: StockTabsProps) {
  if (stockIds.length <= 1) return null;

  const isSmall = size === "small";

  return (
    <div style={{ display: "flex", gap: isSmall ? 2 : 4, marginBottom: isSmall ? 4 : 8 }}>
      {stockIds.map((sid) => {
        const isActive = sid === activeStockId;
        const label = sid.replace("stock_", "Sheet ");
        const count = counts?.[sid];
        return (
          <button
            key={sid}
            onClick={() => !readOnly && onChange?.(sid)}
            style={{
              padding: isSmall ? "2px 6px" : "4px 12px",
              fontSize: isSmall ? 10 : 12,
              background: isActive ? "#4a90d9" : readOnly ? "#f0f0f0" : "#e0e0e0",
              color: isActive ? "#fff" : "#333",
              border: "none",
              borderRadius: 4,
              cursor: readOnly ? "default" : "pointer",
              opacity: readOnly && !isActive ? 0.6 : 1,
            }}
          >
            {label}{count !== undefined ? ` (${count})` : ""}
          </button>
        );
      })}
    </div>
  );
}
```

**Step 2: ビルド確認**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS（型エラーなし）

**Step 3: コミット**

```bash
git add frontend/src/components/StockTabs.tsx
git commit -m "Add reusable StockTabs component for multi-stock UI"
```

---

## Task 2: OperationNode に activeStockId state とストックタブを追加

**Files:**
- Modify: `frontend/src/nodes/OperationNode.tsx`

**Step 1: UpstreamData に activeStockId を追加し、local state を追加**

`OperationNode.tsx` に以下の変更を加える:

1. import に `StockTabs` を追加（行1付近）:
```tsx
import StockTabs from "../components/StockTabs";
```

2. UpstreamData interface に `activeStockId` を追加（行18-21）:
```tsx
interface UpstreamData {
  placementResult: { placements: PlacementItem[]; stock: StockSettings; objects: BrepObject[] };
  fileId: string;
  activeStockId: string;
}
```

3. extractUpstream で `activeStockId` を取得（行34-39）:
```tsx
const extractUpstream = useCallback((d: Record<string, unknown>): UpstreamData | undefined => {
  const placementResult = d.placementResult as UpstreamData["placementResult"] | undefined;
  const fileId = d.fileId as string | undefined;
  const activeStockId = (d.activeStockId as string) || "stock_1";
  if (!placementResult || !fileId) return undefined;
  return { placementResult, fileId, activeStockId };
}, []);
```

4. local state と上流同期を追加（行30付近、`lastFileIdRef` の後）:
```tsx
const [activeStockId, setActiveStockId] = useState("stock_1");
const prevUpstreamStockRef = useRef<string | undefined>();

// Sync activeStockId from upstream PlacementNode
useEffect(() => {
  const upstreamStockId = upstream?.activeStockId;
  if (upstreamStockId && upstreamStockId !== prevUpstreamStockRef.current) {
    prevUpstreamStockRef.current = upstreamStockId;
    setActiveStockId(upstreamStockId);
  }
}, [upstream?.activeStockId]);
```

5. stockIds と フィルタリングを追加:
```tsx
const allPlacements = upstream?.placementResult.placements ?? [];
const stockIds = useMemo(() => {
  const ids = [...new Set(allPlacements.map((p) => p.stock_id))];
  if (ids.length === 0) ids.push("stock_1");
  return ids.sort();
}, [allPlacements]);

// Fallback if activeStockId is invalid
useEffect(() => {
  if (stockIds.length > 0 && !stockIds.includes(activeStockId)) {
    setActiveStockId(stockIds[0]);
  }
}, [stockIds, activeStockId]);

// Filter operations by active stock
const activeObjectIds = useMemo(() => {
  const ids = new Set(allPlacements.filter((p) => p.stock_id === activeStockId).map((p) => p.object_id));
  return ids;
}, [allPlacements, activeStockId]);
```

6. `syncToNodeData` に `activeStockId` を含める（行42-58）:
```tsx
const syncToNodeData = useCallback(
  (det: OperationDetectResult, assign: OperationAssignment[], stock: StockSettings | null, plc: PlacementItem[], objects: BrepObject[], stockId: string) => {
    const objectOrigins: Record<string, [number, number]> = {};
    for (const obj of objects) {
      objectOrigins[obj.object_id] = [obj.origin.position[0], obj.origin.position[1]];
    }
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, detectedOperations: det, assignments: assign, stockSettings: stock, placements: plc, objectOrigins, activeStockId: stockId } }
          : n
      )
    );
  },
  [id, setNodes]
);
```

7. `syncToNodeData` の呼び出し箇所すべてに `activeStockId` を渡す（行90, 107, 118, 130）。

8. ストックタブ切替ハンドラ:
```tsx
const handleStockChange = useCallback((stockId: string) => {
  setActiveStockId(stockId);
  if (detected && upstream) {
    syncToNodeData(detected, assignments, upstream.placementResult.stock, upstream.placementResult.placements, upstream.placementResult.objects, stockId);
  }
}, [detected, upstream, assignments, syncToNodeData]);
```

**Step 2: ノードUI にストックタブとフィルタリング表示を追加**

ヘッダーの下、ステータス表示の前に StockTabs を挿入:
```tsx
<div style={headerStyle}>Operation</div>

{stockIds.length > 1 && (
  <StockTabs
    stockIds={stockIds}
    activeStockId={activeStockId}
    onChange={handleStockChange}
    size="small"
  />
)}
```

オペレーション一覧のフィルタリング（行218-241）:
- `detected.operations` の `.map()` の前に `activeObjectIds` でフィルタする
- `enabledCount` もアクティブストック分のみカウント

```tsx
const filteredOps = detected.operations.filter((op) => activeObjectIds.has(op.object_id));
const filteredAssignments = assignments.filter((a) => {
  const op = detected.operations.find((o) => o.operation_id === a.operation_id);
  return op ? activeObjectIds.has(op.object_id) : false;
});
const enabledCount = filteredAssignments.filter((a) => a.enabled).length;
```

表示部では `filteredOps` を使って `.map()` する。サマリ行も更新:
```tsx
{filteredOps.length} detected / {enabledCount} enabled
```

**Step 3: ビルド確認**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 4: コミット**

```bash
git add frontend/src/nodes/OperationNode.tsx
git commit -m "Add activeStockId state and stock tabs to OperationNode"
```

---

## Task 3: OperationDetailPanel にストックタブとフィルタリングを追加

**Files:**
- Modify: `frontend/src/components/OperationDetailPanel.tsx`

**Step 1: Props にストック関連を追加**

```tsx
import StockTabs from "./StockTabs";
import type { PlacementItem } from "../types";

interface Props {
  detectedOperations: OperationDetectResult;
  assignments: OperationAssignment[];
  stockSettings: StockSettings | null;
  onAssignmentsChange: (assignments: OperationAssignment[]) => void;
  // New props
  placements: PlacementItem[];
  stockIds: string[];
  activeStockId: string;
  onActiveStockChange: (stockId: string) => void;
}
```

**Step 2: パネル内でストックタブ表示とフィルタリング**

```tsx
export default function OperationDetailPanel({
  detectedOperations,
  assignments,
  stockSettings,
  onAssignmentsChange,
  placements,
  stockIds,
  activeStockId,
  onActiveStockChange,
}: Props) {
  const [expandedOp, setExpandedOp] = useState<string | null>(null);
  const materials = stockSettings?.materials ?? [];

  // Filter by active stock
  const activeObjectIds = useMemo(() => {
    return new Set(placements.filter((p) => p.stock_id === activeStockId).map((p) => p.object_id));
  }, [placements, activeStockId]);

  const filteredOps = useMemo(() => {
    return detectedOperations.operations.filter((op) => activeObjectIds.has(op.object_id));
  }, [detectedOperations, activeObjectIds]);

  // ... existing callbacks ...

  return (
    <div style={panelStyle}>
      <div style={panelBodyStyle}>
        {stockIds.length > 1 && (
          <StockTabs
            stockIds={stockIds}
            activeStockId={activeStockId}
            onChange={onActiveStockChange}
          />
        )}
        {filteredOps.map((op) => {
          // ... existing operation card rendering ...
        })}
      </div>
    </div>
  );
}
```

**Step 3: OperationNode 側で新しい props を渡す**

`OperationNode.tsx` の `openTab` / `updateTab` 呼び出し（行140-172）で、OperationDetailPanel に新しい props を渡す:

```tsx
<OperationDetailPanel
  detectedOperations={detected}
  assignments={assignments}
  stockSettings={upstream?.placementResult.stock ?? null}
  onAssignmentsChange={handleAssignmentsChange}
  placements={allPlacements}
  stockIds={stockIds}
  activeStockId={activeStockId}
  onActiveStockChange={handleStockChange}
/>
```

**Step 4: ビルド確認**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 5: コミット**

```bash
git add frontend/src/nodes/OperationNode.tsx frontend/src/components/OperationDetailPanel.tsx
git commit -m "Add stock tabs and filtering to OperationDetailPanel"
```

---

## Task 4: ToolpathGenNode の activeStockId 取得修正とストックタブ追加

**Files:**
- Modify: `frontend/src/nodes/ToolpathGenNode.tsx`

**Step 1: activeStockId のローカル管理と上流同期を追加**

import を追加:
```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import StockTabs from "../components/StockTabs";
```

state を追加（行27-31付近）:
```tsx
const [activeStockId, setActiveStockId] = useState("stock_1");
const prevUpstreamStockRef = useRef<string | undefined>();
```

OperationsUpstream から `activeStockId` を削除し、代わりに上流同期で管理:
```tsx
interface OperationsUpstream {
  detectedOperations: OperationDetectResult;
  assignments: OperationAssignment[];
  stockSettings: StockSettings;
  placements: PlacementItem[];
  objectOrigins: Record<string, [number, number]>;
  upstreamActiveStockId: string;  // renamed to avoid conflict with local state
}
```

extractOperations で `upstreamActiveStockId` として取得:
```tsx
const upstreamActiveStockId = (d.activeStockId as string) || "stock_1";
// ...
return { detectedOperations, assignments, stockSettings, placements, objectOrigins: objectOrigins ?? {}, upstreamActiveStockId };
```

上流同期:
```tsx
useEffect(() => {
  const upstreamStockId = operations?.upstreamActiveStockId;
  if (upstreamStockId && upstreamStockId !== prevUpstreamStockRef.current) {
    prevUpstreamStockRef.current = upstreamStockId;
    setActiveStockId(upstreamStockId);
  }
}, [operations?.upstreamActiveStockId]);
```

stockIds を計算:
```tsx
const allPlacements = operations?.placements ?? [];
const stockIds = useMemo(() => {
  const ids = [...new Set(allPlacements.map((p) => p.stock_id))];
  if (ids.length === 0) ids.push("stock_1");
  return ids.sort();
}, [allPlacements]);

// Fallback
useEffect(() => {
  if (stockIds.length > 0 && !stockIds.includes(activeStockId)) {
    setActiveStockId(stockIds[0]);
  }
}, [stockIds, activeStockId]);
```

**Step 2: フィルタリングロジックを activeStockId (local) ベースに変更**

既存の `useEffect` 内（行51-139）で、`operations.activeStockId` の代わりにローカルの `activeStockId` を使用する。

`genKey` にもローカルの `activeStockId` を使う:
```tsx
const genKey = JSON.stringify({ assignments, placements, stockSettings, postProc, activeStockId });
```

フィルタリング部分（行61-70）でもローカルの `activeStockId` を使用。

`node.data` への保存でもローカルの `activeStockId`:
```tsx
activeStockId,  // local state value
```

useEffect の依存配列に `activeStockId` を追加。

**Step 3: ストックタブUIを追加**

ヘッダーの下に:
```tsx
<div style={headerStyle}>Toolpath Gen</div>

{stockIds.length > 1 && (
  <StockTabs
    stockIds={stockIds}
    activeStockId={activeStockId}
    onChange={setActiveStockId}
    size="small"
  />
)}
```

**Step 4: ビルド確認**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 5: コミット**

```bash
git add frontend/src/nodes/ToolpathGenNode.tsx
git commit -m "Add local activeStockId state and stock tabs to ToolpathGenNode"
```

---

## Task 5: ToolpathPreviewNode に読み取り専用ストックインジケータを追加

**Files:**
- Modify: `frontend/src/nodes/ToolpathPreviewNode.tsx`

**Step 1: 上流から activeStockId と allStockIds を取得**

extractUpstream を拡張:
```tsx
import StockTabs from "../components/StockTabs";

const extractUpstream = useCallback((d: Record<string, unknown>) => ({
  toolpathResult: d.toolpathResult as ToolpathGenResult | undefined,
  stockSettings: d.stockSettings as StockSettings | undefined,
  activeStockId: (d.activeStockId as string) || "stock_1",
  allStockIds: (d.allStockIds as string[]) || [],
}), []);
```

**Step 2: 読み取り専用タブを表示**

ヘッダーの下に:
```tsx
<div style={headerStyle}>Toolpath Preview</div>

{upstream && upstream.allStockIds.length > 1 && (
  <StockTabs
    stockIds={upstream.allStockIds}
    activeStockId={upstream.activeStockId}
    readOnly
    size="small"
  />
)}
```

**Step 3: ビルド確認**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 4: コミット**

```bash
git add frontend/src/nodes/ToolpathPreviewNode.tsx
git commit -m "Add read-only stock indicator to ToolpathPreviewNode"
```

---

## Task 6: CncCodeNode に読み取り専用ストックインジケータを追加

**Files:**
- Modify: `frontend/src/nodes/CncCodeNode.tsx`

**Step 1: 上流から activeStockId を取得**

extractOutput を拡張するか、新しい extractor を追加:
```tsx
import StockTabs from "../components/StockTabs";

// Add activeStockId extraction alongside zipData
const extractStockInfo = useCallback((d: Record<string, unknown>) => ({
  activeStockId: (d.activeStockId as string) || "stock_1",
  allStockIds: (d.allStockIds as string[]) || [],
}), []);
const stockInfo = useUpstreamData(id, `${id}-in`, extractStockInfo);
```

**Step 2: 読み取り専用タブを表示**

ヘッダーの下に:
```tsx
<div style={headerStyle}>CNC Code</div>

{stockInfo && stockInfo.allStockIds.length > 1 && (
  <StockTabs
    stockIds={stockInfo.allStockIds}
    activeStockId={stockInfo.activeStockId}
    readOnly
    size="small"
  />
)}
```

**Step 3: ビルド確認**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 4: コミット**

```bash
git add frontend/src/nodes/CncCodeNode.tsx
git commit -m "Add read-only stock indicator to CncCodeNode"
```

---

## Task 7: PlacementPanel のストックタブを StockTabs コンポーネントに置換

**Files:**
- Modify: `frontend/src/components/PlacementPanel.tsx`

**Step 1: 既存のインラインタブUI（行300-322）を StockTabs に置換**

import:
```tsx
import StockTabs from "./StockTabs";
```

既存のストックタブ描画部分を置換:
```tsx
{/* Before: inline buttons */}
{/* After: */}
<StockTabs
  stockIds={stockIds}
  activeStockId={activeStockId}
  onChange={onActiveStockChange}
  counts={Object.fromEntries(stockIds.map((sid) => [sid, placements.filter((p) => p.stock_id === sid).length]))}
/>
```

**Step 2: ビルド確認**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 3: コミット**

```bash
git add frontend/src/components/PlacementPanel.tsx
git commit -m "Refactor PlacementPanel to use shared StockTabs component"
```

---

## Task 8: 統合テスト — make dev で動作確認

**Step 1: フロントエンドビルド確認**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: PASS（ビルド成功）

**Step 2: 手動動作確認チェックリスト**

`make dev` で起動し、以下を確認:

- [ ] PlacementNode: ストックタブが従来通り動作する
- [ ] OperationNode: ストックタブが表示され、アクティブストックのオペレーションのみ表示
- [ ] OperationDetailPanel: ストックタブが表示され、切替でパネル内容が更新
- [ ] ToolpathGenNode: ストックタブが表示され、切替でツールパスが再生成
- [ ] ToolpathPreviewNode: 読み取り専用インジケータが表示
- [ ] CncCodeNode: 読み取り専用インジケータが表示、ZIP全ストックダウンロードが機能
- [ ] 上流同期: PlacementNodeでストック切替 → 下流全ノードが追従
- [ ] ローカル切替: OperationNodeで切替 → ToolpathGen以降が追従、PlacementNodeは影響なし
- [ ] ストック1つの場合: タブが非表示

**Step 3: コミット**

問題があれば修正してコミット。

```bash
git commit -m "Fix: [修正内容]"
```
