# Sheet Management Refactor Design

## Problem

1. 下流ノードでシートタブを操作しても上流に反映されず、ユーザーに違和感がある
2. シート数が増えるとノード内タブがゴチャつく
3. Auto Nesting後、PlacementPanelのシートタブをクリックしないと下流にシートタブが追加されない

## Approach: activeStockId をPlacementNodeで一元管理

各ノードのローカル `activeStockId` state を廃止し、PlacementNodeの `node.data.activeStockId` を唯一の真実とする。下流は `useUpstreamData` で読むだけ。

## Design

### 1. activeStockId 一元管理

**現状:**
```
PlacementNode   [activeStockId state] → node.data
OperationNode   [activeStockId state] → node.data  ← upstream同期 + 独立切替
ToolpathGenNode [activeStockId state] → node.data  ← upstream同期 + 独立切替
PreviewNode     読み取り専用
CncCodeNode     読み取り専用
```

**変更後:**
```
PlacementNode   [activeStockId state] → node.data  ← 唯一のstate保持者
OperationNode   useUpstreamDataで読むだけ（state廃止）
ToolpathGenNode useUpstreamDataで読むだけ（state廃止）
PreviewNode     useUpstreamDataで読むだけ（変更なし）
CncCodeNode     useUpstreamDataで読むだけ（変更なし）
```

**削除対象:**
- OperationNode: `useState(activeStockId)`, `prevUpstreamStockRef`, upstream同期の `useEffect`, `handleStockChange`
- ToolpathGenNode: 同上
- 両ノードの `syncToNodeData` では `upstream.activeStockId` をそのまま `node.data` にパススルー

### 2. 下流ノードのUI変更

| ノード | 現状 | 変更後 |
|--------|------|--------|
| PlacementPanel | スクロール不可タブ | スクロール可能タブ |
| OperationNode | 操作可能 Small タブ | タブ廃止 → `StockBadge` |
| OperationDetailPanel | 操作可能 Normal タブ | タブ廃止 → `StockBadge` |
| ToolpathGenNode | 操作可能 Small タブ | タブ廃止 → `StockBadge` |
| ToolpathPreviewNode | readOnly Small タブ | タブ廃止 → `StockBadge` |
| CncCodeNode | readOnly Small タブ | タブ廃止 → `StockBadge` |

**StockBadge 仕様:**
- シートが1枚: 非表示
- シートが2枚以上: pill型バッジで「Sheet N」表示（背景 `#4a90d9`、白文字、小フォント）

### 3. PlacementPanel のタブ改善

StockTabs にスクロール対応を追加（`overflow-x: auto`）。多シート時に左右スクロールで全タブにアクセス可能にする。

### 4. StockTabs コンポーネント整理

PlacementPanel 専用になるため:
- `readOnly` プロップ削除
- `size="small"` プロップ削除
- スクロール対応追加

### 5. Auto Nesting バグ修正

state 一元化により自然解消。ローカル state と `useEffect` タイミング依存の同期が不要になるため、PlacementNode の `syncToNodeData` 更新が `useUpstreamData` 経由で即座に下流へ伝播する。
