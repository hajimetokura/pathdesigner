# Node UX Refactor v2 — Design Document

**Date:** 2026-02-23

## Summary

3つのリファクタリングを実施する:

1. サイドバーのノードをCAD/CAM/Utilityにグループ化し、NodeShellのカテゴリカラーと統一
2. Stock → Sheet にリネーム
3. ハンドルの接続を1本に制限（新しいエッジが繋がると古いエッジが外れる）

## 1. サイドバーのグループ化 + カテゴリカラー

### カテゴリ定義

| グループ | 色 | ノード |
|---------|-----|------|
| **CAD** | `#ff9800`（オレンジ） | BREP Import |
| **CAM** | `#00bcd4`（水色） | Sheet, Placement, Operation, Post Processor, Toolpath Gen, CNC Code, Toolpath Preview |
| **Utility** | `#888888`（灰色） | Dam, Debug |

### 変更箇所

- `NodeShell.tsx`: `CATEGORY_COLORS` を新しい3色に変更
- `Sidebar.tsx`: フラットリスト → グループ化リストに変更。各グループにカテゴリ名ヘッダーと色を表示
- `BrepImportNode.tsx`: category を `"cam"` → `"cad"` に変更

## 2. Stock → Sheet リネーム

### ファイルリネーム

- `StockNode.tsx` → `SheetNode.tsx`
- `StockBadge.tsx` → `SheetBadge.tsx`
- `StockTabs.tsx` → `SheetTabs.tsx`

### 型名変更

- `StockMaterial` → `SheetMaterial`
- `StockSettings` → `SheetSettings`

### データキー変更

- `stockSettings` → `sheetSettings`
- `activeStockId` → `activeSheetId`
- `stock_1` → `sheet_1`（デフォルトID）

### 参照変更

- `App.tsx`: nodeTypes の `stock` → `sheet`、initialNodes のtype
- `Sidebar.tsx`: ノードアイテムの type/label
- 全下流ノード: useUpstreamData の extractStock → extractSheet 等

## 3. ハンドルの1接続制限

### 実装方針

`App.tsx` の `onConnect` を修正:

```typescript
const onConnect: OnConnect = useCallback(
  (params) => {
    setEdges((eds) => {
      // 同じtargetHandleへの既存エッジを削除
      // 同じsourceHandleからの既存エッジを削除
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

source/target各ハンドルにつき1本のみ。新しい接続が来たら古い接続を自動的に外す。
