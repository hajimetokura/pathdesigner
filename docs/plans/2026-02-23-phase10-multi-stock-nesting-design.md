# Phase 10: マルチストック・ネスティング — 設計ドキュメント

日付: 2026-02-23

## 概要

Auto Nesting機能を実装し、複数パーツを複数ストック（材料シート）に自動分配する。1つのストックテンプレートから必要枚数を自動算出し、パーツをBLFアルゴリズムで効率的に配置する。SBP出力はストックごとに生成し、ZIP一括ダウンロードで提供する。

## 決定事項

| 項目 | 決定 |
|------|------|
| アプローチ | Auto-Stock生成（テンプレート×N枚） |
| ノード構成 | PlacementNode拡張（新規ノードなし） |
| ネスティングアルゴリズム | BLF（Bottom-Left Fill） |
| SBP出力 | ストック単位で生成、ZIP一括ダウンロード |
| 将来拡張 | DXFインポートによるレイアウト指定 |

## アーキテクチャ

### PlacementNode 出力の変更

現在:
```json
{
  "placements": [PlacementItem],
  "stock": StockSettings,
  "objects": [BrepObject]
}
```

Phase 10:
```json
{
  "stockInstances": [
    { "stock_id": "stock_1", "placements": [PlacementItem] },
    { "stock_id": "stock_2", "placements": [PlacementItem] }
  ],
  "stock": StockSettings,
  "objects": [BrepObject],
  "activeStockId": "stock_1"
}
```

### PlacementItem スキーマ変更

```python
class PlacementItem(BaseModel):
    object_id: str
    stock_id: str = "stock_1"       # 追加: 割り当て先ストック
    material_id: str = "mat_001"
    x_offset: float = 0
    y_offset: float = 0
    rotation: int = 0
```

### BLFアルゴリズム（マルチストック版）

1. パーツを面積降順でソート
2. 各パーツに対して8方向（0°〜315°、45°刻み）を試行
3. 現在のストックで配置可能な位置をBLFで探索
4. 収まらなければ新しいストックインスタンスを自動追加
5. パーツ間マージン: ツール径/2 + クリアランス（デフォルト5mm）
6. ストック内の走査はグリッドサーチ（初期ステップ: 5mm）

### 下流ノードへの影響

| ノード | 変更内容 |
|--------|----------|
| OperationNode | 全ストック共通（object_idベース）。変更なし |
| ToolpathGenNode | ストックごとにツールパスを生成。activeStockIdに応じて出力 |
| CncCodeNode | ドロップダウンでストック切替表示 + ZIP一括DLボタン |
| ToolpathPreviewNode | 選択中ストックのプレビュー |

### 新規APIエンドポイント

#### `POST /api/auto-nesting`

リクエスト:
```json
{
  "objects": [BrepObject],
  "stock": StockSettings,
  "tool_diameter": 6.35,
  "clearance": 5.0
}
```

レスポンス:
```json
{
  "stock_instances": [
    { "stock_id": "stock_1", "placements": [PlacementItem] },
    { "stock_id": "stock_2", "placements": [PlacementItem] }
  ],
  "warnings": ["Part X could not be placed"]
}
```

#### `POST /api/generate-sbp-zip`

リクエスト: 全ストックのツールパス情報
レスポンス: ZIPバイナリ（各ストックのSBPファイルを含む）

### PlacementPanel UI

```
┌─────────────────────────────────────┐
│ [Auto Nesting] Clearance: [5] mm    │
│                                     │
│ [Stock 1/3] [Stock 2/3] [Stock 3/3] │
│                                     │
│ ┌─────────────────────────────┐     │
│ │   Canvas (Stock 1)          │     │
│ │  ┌─┐  ┌───┐                │     │
│ │  └─┘  └───┘                │     │
│ │       ○                    │     │
│ └─────────────────────────────┘     │
│                                     │
│ Part A: x=10 y=20 rot=0°           │
│ Part B: x=80 y=10 rot=45°          │
└─────────────────────────────────────┘
```

- Auto Nestingボタン: 全パーツを自動分配
- タブでストック切替
- 各ストック内では手動微調整可能（既存のoffset/rotation UI）
- 衝突判定はストック内で適用

### SBPダウンロード

CncCodeNodeにZIP一括ダウンロードボタンを追加:
- ファイル名: `{project_name}_stocks.zip`
- ZIP内: `stock_1.sbp`, `stock_2.sbp`, ...
- 個別ストックの表示はドロップダウンで切替

## 後方互換性

- 単一ストック（パーツが1枚に収まる場合）は `stockInstances` が1要素になるだけ
- Auto Nestingを使わない場合の手動配置も従来通り動作
- 既存のPlacementItem.material_idとstock_idは独立（material_idは素材種別、stock_idは物理シート識別）
