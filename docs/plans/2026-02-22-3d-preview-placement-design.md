# 3Dプレビュー・部品配置・ツールパスプレビュー強化 設計書

## 背景

Phase 5（CNC Code + Toolpath Preview）完了後、以下の課題が明確になった:

1. BREPインポート後に3D形状を確認する手段がない
2. インポートした部品とStockの位置関係が定義されていない
3. Toolpathプレビューに原点やStock範囲の表示がない

本設計では3つの機能を追加し、切り出し加工フロー（部品 < Stock）を優先対応する。

## 前提・スコープ

- **v1対象:** 切り出し加工（板材Stockから部品を切り出す）
- **v1対象外:** 彫り込み加工（STEP ≈ Stock）、自動ネスティング
- 将来: 自動ネスティングはPlacementNodeに追加、彫り込み対応は別Phase

## 機能1: BREPインポート 3Dプレビュー

### 概要

BREPインポート後にSTEPの3D形状をThree.jsでソリッド表示する。

### バックエンド

- 新エンドポイント: `POST /api/mesh-data`
  - リクエスト: `{ file_id: string }`
  - レスポンス: `{ objects: [{ object_id, vertices: number[], faces: number[] }] }`
- build123dでSolidをテッセレーション（三角形メッシュ化）
- vertices: flat array `[x0, y0, z0, x1, y1, z1, ...]`
- faces: flat array of triangle indices `[i0, j0, k0, i1, j1, k1, ...]`
- STEPファイルは `file_id` で再読み込み（既存の一時保存を利用）

### フロントエンド

- 依存追加: `@react-three/fiber`, `@react-three/drei`
- BrepImportNode内にサムネイル3Dビュー（200x150相当）
- クリックでBrepImportPanel（サイドパネル）を開き、大きな3Dビューを表示
- OrbitControlsで回転・ズーム
- マテリアル: Phong shading（ライトグレー + エッジ表示）
- データサイズ: 一般的なCNC部品で数百KB〜1MB（v1では問題なし）

## 機能2: PlacementNode（部品配置ノード）

### 概要

BREP ImportとOperationの間に配置され、部品をStock上のどこに置くかを定義する。

### データフロー変更

```
【変更前】
BREP Import ──→ Operation ──→ Toolpath Gen → Preview
Stock ─────────→ Operation ↗               → CNC Code
PostProcessor ───────────────↗

【変更後】
BREP Import ──→ Placement ──→ Operation ──→ Toolpath Gen → Preview
Stock ─────────→ Placement ↗                              → CNC Code
PostProcessor ────────────────────────────↗
```

PlacementNodeがobjects + stockをまとめ、配置情報付きでOperationに渡す。

### 出力データ型: PlacementResult

```typescript
interface PlacementResult {
  placements: {
    object_id: string      // BREPオブジェクトID
    material_id: string    // 配置先Stock ID
    x_offset: number       // Stock上のX位置 (mm)
    y_offset: number       // Stock上のY位置 (mm)
    rotation: number       // 回転角度 (deg) — v1は0固定
  }[]
  stock: StockSettings     // Stock情報パススルー
  objects: BrepObject[]    // オブジェクト情報パススルー
}
```

### バックエンド

- 配置ロジック: フロントエンドのみ（ドラッグ・数値入力）
- バリデーション: `POST /api/validate-placement`
  - はみ出しチェック、重なり検出
  - v1は警告のみ（エラーにしない）

### フロントエンド: PlacementNode

- ノード内2Dキャンバス（200x150程度）
  - Stock矩形（グレー）+ 部品矩形（バウンディングボックス上面投影、カラー）
- クリックでPlacementPanel（サイドパネル）を開く

### フロントエンド: PlacementPanel（サイドパネル）

- 大きな2Dキャンバス（600x450程度）
- Stock領域表示（グレー背景 + 寸法ラベル）
- 部品をドラッグで移動可能
- 数値入力フィールド: 各部品のX, Yオフセット
- はみ出し時に警告表示（赤枠 or メッセージ）
- 原点マーカー (0,0) 表示

### OperationNodeへの影響

- 入力データが変わる: BrepImportResult + StockSettings → PlacementResult
- PlacementResult内にobjects + stock + placements全て含まれる
- Operation検出時にplacement情報（位置オフセット）をcontour座標に反映

## 機能3: Toolpathプレビュー強化

### 概要

既存のToolpathPreviewPanelに原点座標軸とStock範囲を追加する。

### 追加描画要素

1. **原点座標軸**
   - X軸: 赤い矢印線（→ 方向にラベル "X"）
   - Y軸: 緑の矢印線（↑ 方向にラベル "Y"）
   - 原点 (0,0) に小さな丸マーカー

2. **Stock範囲**
   - Stock外形を薄いグレーの破線矩形で表示
   - 寸法ラベル（幅 x 奥行）をStock矩形の外側に表示

3. **レイヤー順序（下→上）**
   - Stock範囲（背景）→ 原点軸 → ツールパス → タブマーカー

### データフロー変更

- ToolpathGenResult に `stock_width`, `stock_depth` を追加
- ToolpathGenNode → ToolpathPreviewNode へ Stock寸法をパススルー
- バックエンド schemas.py も対応更新

### 変更対象

- `frontend/src/components/ToolpathPreviewPanel.tsx` — 描画ロジック追加
- `frontend/src/nodes/ToolpathPreviewNode.tsx` — サムネイルにも反映
- `frontend/src/types.ts` — ToolpathGenResult型更新
- `backend/schemas.py` — Pydanticモデル更新

## ノード構成（変更後: 9ノード）

| # | ノード | 役割 |
|---|--------|------|
| 1 | BREPインポート | STEP読み込み + **3Dプレビュー** |
| 2 | Stock | 板材寸法定義 |
| 3 | **Placement (NEW)** | **部品のStock上配置** |
| 4 | Operation | 加工操作検出・設定 |
| 5 | PostProcessor | ShopBot設定 |
| 6 | ToolpathGen | ツールパス計算・SBP生成 |
| 7 | CNC Code | SBPコード表示・エクスポート |
| 8 | Toolpath Preview | パス可視化 + **原点・Stock範囲** |
