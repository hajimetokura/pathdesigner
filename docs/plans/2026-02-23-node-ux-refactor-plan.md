# Node UX Refactor v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** サイドバーのカテゴリグループ化、Stock→Sheet全面リネーム、ハンドル1接続制限の3つを実施する。

**Architecture:** Sidebar.tsx をグループ表示に変更、NodeShell のカテゴリカラーを統一、Stock関連の全ファイル・型・変数をSheet にリネーム、onConnect で既存エッジ自動除去。

**Tech Stack:** React, TypeScript, React Flow

---

### Task 1: NodeShell のカテゴリカラーを変更

**Files:**
- Modify: `frontend/src/components/NodeShell.tsx`

**Step 1: CATEGORY_COLORS を新しい3色に変更**

```tsx
const CATEGORY_COLORS: Record<NodeCategory, string> = {
  cad: "#ff9800",     // オレンジ
  cam: "#00bcd4",     // 水色
  utility: "#888888",  // 灰色
};
```

**Step 2: ビルド確認**

Run: `cd frontend && npx tsc --noEmit`

**Step 3: コミット**

```bash
git add frontend/src/components/NodeShell.tsx
git commit -m "Update NodeShell category colors: CAD=orange, CAM=cyan, Utility=gray"
```

---

### Task 2: BrepImportNode のカテゴリを cad に変更

**Files:**
- Modify: `frontend/src/nodes/BrepImportNode.tsx`

**Step 1: category を "cam" → "cad" に変更**

Line 90: `<NodeShell category="cam"` → `<NodeShell category="cad"`

**Step 2: ビルド確認 → コミット**

```bash
git add frontend/src/nodes/BrepImportNode.tsx
git commit -m "Change BrepImportNode category from CAM to CAD"
```

---

### Task 3: Sidebar をカテゴリグループ表示に変更

**Files:**
- Modify: `frontend/src/Sidebar.tsx`

**Step 1: nodeItems をグループ構造に変更**

```tsx
import type { NodeCategory } from "./components/NodeShell";

const CATEGORY_COLORS: Record<NodeCategory, string> = {
  cad: "#ff9800",
  cam: "#00bcd4",
  utility: "#888888",
};

const nodeGroups: { category: NodeCategory; label: string; items: { type: string; label: string }[] }[] = [
  {
    category: "cad",
    label: "CAD",
    items: [
      { type: "brepImport", label: "BREP Import" },
    ],
  },
  {
    category: "cam",
    label: "CAM",
    items: [
      { type: "sheet", label: "Sheet" },
      { type: "placement", label: "Placement" },
      { type: "operation", label: "Operation" },
      { type: "postProcessor", label: "Post Processor" },
      { type: "toolpathGen", label: "Toolpath Gen" },
      { type: "cncCode", label: "CNC Code" },
      { type: "toolpathPreview", label: "Toolpath Preview" },
    ],
  },
  {
    category: "utility",
    label: "Utility",
    items: [
      { type: "dam", label: "Dam" },
      { type: "debug", label: "Debug" },
    ],
  },
];
```

**Step 2: レンダリングをグループ表示に変更**

```tsx
return (
  <aside style={sidebarStyle}>
    {nodeGroups.map((group) => (
      <div key={group.category}>
        <div style={{ ...groupTitleStyle, color: CATEGORY_COLORS[group.category] }}>
          {group.label}
        </div>
        {group.items.map((item) => (
          <div
            key={item.type}
            draggable
            onDragStart={(e) => onDragStart(e, item.type)}
            style={{ ...itemStyle, borderLeftColor: CATEGORY_COLORS[group.category] }}
          >
            {item.label}
          </div>
        ))}
      </div>
    ))}
  </aside>
);
```

groupTitleStyle を追加（titleStyle ベースで）。旧 `nodeItems` と `titleStyle` は削除。

**Step 3: ビルド確認 → コミット**

```bash
git add frontend/src/Sidebar.tsx
git commit -m "Group sidebar nodes by CAD/CAM/Utility categories"
```

---

### Task 4: Stock → Sheet リネーム（型・ファイル名）

**Files:**
- Rename: `frontend/src/nodes/StockNode.tsx` → `frontend/src/nodes/SheetNode.tsx`
- Rename: `frontend/src/components/StockBadge.tsx` → `frontend/src/components/SheetBadge.tsx`
- Rename: `frontend/src/components/StockTabs.tsx` → `frontend/src/components/SheetTabs.tsx`
- Modify: `frontend/src/types.ts`

**Step 1: types.ts の型名変更**

- `StockMaterial` → `SheetMaterial`
- `StockSettings` → `SheetSettings`

**Step 2: ファイルリネーム（git mv）**

```bash
git mv frontend/src/nodes/StockNode.tsx frontend/src/nodes/SheetNode.tsx
git mv frontend/src/components/StockBadge.tsx frontend/src/components/SheetBadge.tsx
git mv frontend/src/components/StockTabs.tsx frontend/src/components/SheetTabs.tsx
```

**Step 3: リネーム先ファイル内のコード変更**

SheetNode.tsx:
- `StockMaterial` → `SheetMaterial`, `StockSettings` → `SheetSettings`
- 関数名 `StockNode` → `SheetNode`
- `DEFAULT_MAT` の `material_id: "stock_1"` → `"sheet_1"`, `label: "Stock"` → `"Sheet"`
- `stockSettings` → `sheetSettings`
- ヘッダーテキスト "Stock" → "Sheet"
- ハンドル `label="stock"` → `label="sheet"`

SheetBadge.tsx:
- `StockBadgeProps` → `SheetBadgeProps`
- `StockBadge` → `SheetBadge`
- `activeStockId` → `activeSheetId`
- `totalStocks` → `totalSheets`
- `"stock_"` → `"sheet_"`

SheetTabs.tsx:
- `StockTabsProps` → `SheetTabsProps`
- `StockTabs` → `SheetTabs`
- `stockIds` → `sheetIds`
- `activeStockId` → `activeSheetId`
- `"stock_"` → `"sheet_"`

**Step 4: ビルド確認（エラーが出るのは想定内 — 次のTaskで修正）**

---

### Task 5: Stock → Sheet リネーム（全参照更新 — フロントエンド）

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/nodes/PlacementNode.tsx`
- Modify: `frontend/src/nodes/OperationNode.tsx`
- Modify: `frontend/src/nodes/ToolpathGenNode.tsx`
- Modify: `frontend/src/nodes/CncCodeNode.tsx`
- Modify: `frontend/src/nodes/ToolpathPreviewNode.tsx`
- Modify: `frontend/src/components/PlacementPanel.tsx`
- Modify: `frontend/src/components/OperationDetailPanel.tsx`
- Modify: `frontend/src/api.ts`

**Step 1: App.tsx の変更**

- `import StockNode` → `import SheetNode from "./nodes/SheetNode"`
- `nodeTypes` の `stock: StockNode` → `sheet: SheetNode`
- `initialNodes` の `type: "stock"` → `type: "sheet"`
- `initialEdges` の `targetHandle: "9-stock"` → `targetHandle: "9-sheet"`

**Step 2: PlacementNode.tsx の変更**

- import: `StockSettings` → `SheetSettings`
- `extractStock` → `extractSheet`
- `d.stockSettings` → `d.sheetSettings`
- `stockSettings` → `sheetSettings`
- `activeStockId` → `activeSheetId`
- `stock_id: "stock_1"` → `sheet_id: "sheet_1"` （注意: PlacementItem の stock_id フィールドも変更必要）
- ハンドル `id={...-stock}` → `id={...-sheet}`, `label="stock"` → `label="sheet"`
- 空状態テキスト: "Connect BREP + Stock" → "Connect BREP + Sheet"

**Step 3: OperationNode.tsx の変更**

- `StockSettings` → `SheetSettings`
- `stockSettings` → `sheetSettings`
- `activeStockId` → `activeSheetId`
- `stock_id` → `sheet_id`
- `stockIds` → `sheetIds`
- `"stock_1"` → `"sheet_1"`
- `StockBadge` → `SheetBadge` (import パスも更新)

**Step 4: ToolpathGenNode.tsx の変更**

同パターン:
- `StockSettings` → `SheetSettings`
- `stockSettings` → `sheetSettings`
- `activeStockId` → `activeSheetId`
- `allStockIds` → `allSheetIds`
- `stockIds` → `sheetIds`
- `"stock_1"` → `"sheet_1"`
- `StockBadge` → `SheetBadge`
- エラーメッセージ: "stock" → "sheet"

**Step 5: CncCodeNode.tsx の変更**

- `StockSettings` → `SheetSettings`
- `allStockIds` → `allSheetIds`
- `stockSettings` → `sheetSettings`
- `activeStockId` → `activeSheetId`
- `hasMultipleStocks` → `hasMultipleSheets`
- `"pathdesigner_stocks.zip"` → `"pathdesigner_sheets.zip"`
- `StockBadge` → `SheetBadge`
- ボタンテキスト: "stocks" → "sheets"

**Step 6: ToolpathPreviewNode.tsx の変更**

- `StockSettings` → `SheetSettings`
- `stockSettings` → `sheetSettings`
- `activeStockId` → `activeSheetId`
- `allStockIds` → `allSheetIds`
- `StockBadge` → `SheetBadge`

**Step 7: PlacementPanel.tsx の変更**

- `StockSettings` → `SheetSettings`
- `stockSettings` → `sheetSettings`
- `activeStockId` → `activeSheetId`
- `stockIds` → `sheetIds`
- `stock_id` → `sheet_id`
- `StockTabs` → `SheetTabs` (import パスも更新)
- `"stock_1"` → `"sheet_1"`

**Step 8: OperationDetailPanel.tsx の変更**

- `StockSettings` → `SheetSettings`
- `stockSettings` → `sheetSettings`
- `stockIds` → `sheetIds`
- `activeStockId` → `activeSheetId`
- `stock_id` → `sheet_id`
- `StockBadge` → `SheetBadge`
- "stock too thin" → "sheet too thin"

**Step 9: api.ts の変更**

- `StockSettings` → `SheetSettings`
- パラメータ名 `stock:` → `sheet:`

**Step 10: types.ts — PlacementItem の stock_id → sheet_id, PlacementResult の stock → sheet**

**Step 11: ビルド確認**

Run: `cd frontend && npx tsc --noEmit`
Expected: エラーなし

**Step 12: コミット**

```bash
git add -A frontend/src/
git commit -m "Rename Stock to Sheet across entire frontend codebase"
```

---

### Task 6: Stock → Sheet リネーム（バックエンド）

**Files:**
- Modify: `backend/schemas.py`
- Modify: `backend/main.py`
- Modify: `backend/sbp_writer.py`
- Modify: `backend/nodes/nesting.py`

**Step 1: schemas.py**

- `class StockMaterial` → `class SheetMaterial`
- `class StockSettings` → `class SheetSettings`
- 全パラメータの `stock:` → `sheet:`
- `stock_id: str = "stock_1"` → `sheet_id: str = "sheet_1"`
- `stock_width` → `sheet_width`
- `stock_depth` → `sheet_depth`
- PlacementItem の `stock_id` → `sheet_id`

**Step 2: main.py**

- import 変更
- `req.stock` → `req.sheet`

**Step 3: sbp_writer.py**

- `StockSettings` → `SheetSettings`
- `self.stock` → `self.sheet`
- パラメータ名 `stock:` → `sheet:`

**Step 4: nodes/nesting.py**

- import 変更
- パラメータ名・変数名の stock → sheet
- `stock_id=sid` → `sheet_id=sid`
- `stock_id="stock_1"` → `sheet_id="sheet_1"`

**Step 5: コミット**

```bash
git add backend/
git commit -m "Rename Stock to Sheet across entire backend codebase"
```

---

### Task 7: ハンドルの1接続制限を実装

**Files:**
- Modify: `frontend/src/App.tsx`

**Step 1: onConnect を修正**

```tsx
const onConnect: OnConnect = useCallback(
  (params) => {
    setEdges((eds) => {
      const filtered = eds.filter(
        (e) =>
          !(e.target === params.target && e.targetHandle === params.targetHandle) &&
          !(e.source === params.source && e.sourceHandle === params.sourceHandle)
      );
      return addEdge(params, filtered);
    });
  },
  [setEdges]
);
```

**Step 2: ビルド確認**

Run: `cd frontend && npx tsc --noEmit`

**Step 3: コミット**

```bash
git add frontend/src/App.tsx
git commit -m "Limit each handle to single connection, auto-remove old edges on reconnect"
```

---

### Task 8: 最終ビルド確認

**Step 1: TypeScript 型チェック**

Run: `cd frontend && npx tsc --noEmit`
Expected: エラーなし

**Step 2: 目視確認項目**

- [ ] サイドバーが CAD / CAM / Utility にグループ化されている
- [ ] CAD グループ（BREP Import）にオレンジの左ボーダー
- [ ] CAM グループ（Sheet 等）に水色の左ボーダー
- [ ] Utility グループ（Dam, Debug）に灰色の左ボーダー
- [ ] "Sheet" ノードが正しく表示される（旧 Stock）
- [ ] ハンドルを別のノードに繋ぎ直すと古い接続が自動で外れる
- [ ] source ハンドルも1接続のみ
