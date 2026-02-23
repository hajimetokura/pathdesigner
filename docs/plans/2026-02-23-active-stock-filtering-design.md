# Active Stock Filtering — 全ノード対応設計

## 概要

PlacementNodeで実装済みの「アクティブストック別表示」を、OperationNode / ToolpathGenNode / ToolpathPreviewNode / CncCodeNode およびサイドパネルに展開する。

## 背景

Phase 10（マルチストック・ネスティング）で複数ストックに対応したが、PlacementNode以外のノードは全ストックのデータを混在表示している。OperationNodeは全オブジェクトのオペレーションを一覧表示し、ToolpathGenNodeの `activeStockId` 取得元に不整合がある。

## 設計方針

- **方式A: 独立管理 + 上流同期** を採用
- 各ノードがローカルの `activeStockId` state を持つ
- 上流ノードの `activeStockId` が変わったら下流に伝搬（自動追従）
- ユーザーはローカルで独立して切り替え可能（次に上流が変わるまで）

## ノード別仕様

| ノード | ストックタブ | 動作 |
|--------|------------|------|
| PlacementNode | 切替可能（既存） | ローカル管理、下流に伝搬 |
| OperationNode | 切替可能 | ローカル管理 + 上流同期、下流に伝搬 |
| ToolpathGenNode | 切替可能 | ローカル管理 + 上流同期、切替時にAPI再生成 |
| ToolpathPreviewNode | 読み取り専用インジケータ | 上流の選択に追従のみ |
| CncCodeNode | 読み取り専用インジケータ | 上流の選択に追従 + ZIP全ストックは維持 |

## サイドパネル

| パネル | ストックタブ | 動作 |
|--------|------------|------|
| PlacementPanel | 切替可能（既存） | ノードと双方向同期 |
| OperationDetailPanel | 切替可能 | ノードと双方向同期、アクティブストックのオペレーションのみ表示 |
| ToolpathPreview パネル | 読み取り専用 | 上流追従 |
| CncCode パネル | 読み取り専用 | 上流追従 |

## データフロー

```
PlacementNode (activeStockId: local state)
    │ node.data: activeStockId + 全placements
    ▼
OperationNode (activeStockId: local state)
    │ 上流の activeStockId 変更を検知 → 自分も同期
    │ node.data: activeStockId + 全assignments
    │ サムネイル: アクティブストックのオペレーションのみ表示
    ▼
ToolpathGenNode (activeStockId: local state)
    │ 上流の activeStockId 変更を検知 → 自分も同期
    │ 切替時に /api/generate-toolpath を再呼び出し
    │ node.data: activeStockId + フィルタ済み結果 + allPlacements/allAssignments
    ▼
┌─────────────────────────┬──────────────────────────┐
ToolpathPreviewNode        CncCodeNode
(読み取り専用インジケータ)    (読み取り専用 + ZIP全ストック)
```

## 上流同期ロジック

```tsx
// 各ノード共通パターン
const prevUpstreamRef = useRef<string | undefined>();

useEffect(() => {
  const upstreamStockId = upstream?.activeStockId;
  if (upstreamStockId && upstreamStockId !== prevUpstreamRef.current) {
    prevUpstreamRef.current = upstreamStockId;
    setActiveStockId(upstreamStockId);
  }
}, [upstream?.activeStockId]);
```

## 共通コンポーネント: StockTabs

PlacementPanelの既存タブUIをベースに再利用可能なコンポーネントに抽出する。

```tsx
<StockTabs
  stockIds={["stock_1", "stock_2"]}
  activeStockId="stock_1"
  onChange={(id) => setActiveStockId(id)}
  size="small" | "normal"    // ノード内 vs パネル内
  readOnly?: boolean          // Preview/CncCode用
/>
```

## OperationNode のフィルタリング

- 上流から `placements` を受け取る
- `activeStockId` に属する `object_id` のセットを算出
- そのセットに含まれるオブジェクトのオペレーションのみ表示
- サムネイルとサイドパネルの両方でフィルタリング

## ToolpathGenNode の変更

- `activeStockId` の取得元を修正（OperationNode の `node.data.activeStockId` から正しく取得）
- 既存のフィルタリングロジックは維持
- ストック切替時に自動で API 再呼び出し

## エッジケース

- ストック数が1の場合: タブは表示するが切替不要（既存動作と同じ）
- 存在しないストックIDがローカルに残った場合: 最初のストックにフォールバック
- 上流データが未到着の場合: タブ非表示、既存の「データなし」表示を維持
