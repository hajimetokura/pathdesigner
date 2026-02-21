# Phase 2: 外形線抽出ノード — 設計ドキュメント

> 作成日: 2026-02-21 | Issue: #2

## 概要

BREPインポートノード（Node 1）の出力からSTEPファイルを読み込み、底面断面をスライスして外形輪郭を抽出する。shapely でオフセットを適用し、座標列 JSON を出力する。

## 設計判断

| 判断項目 | 決定 | 理由 |
|----------|------|------|
| Phase 3 未実装への対応 | デフォルト値で先行実装 | Phase 2 単体でテスト可能にする |
| STEP ファイル受け渡し | file_id でサーバー側参照 | JSON はメタデータのみ、ファイル再送不要 |
| 輪郭抽出方法 | build123d 断面スライス → shapely 変換 | 汎用的で将来拡張に強い |
| Z=0 トレランス問題 | Z=0 試行 → 失敗時 Z=+0.001 リトライ | Grasshopper と同様の既知問題への対策 |

## アーキテクチャ

### データフロー

```
Node 1 (BREP Import)
  ├── file_id: "abc123"
  ├── objects: [{object_id, bounding_box, ...}]
  │
  ▼
Node 2 (Contour Extract)
  POST /api/extract-contours
    { file_id, object_id, tool_diameter: 6.35, offset_side: "outside" }
  ▼
  Response:
    { object_id, slice_z: 0.0, contours: [...], offset_applied: {...} }
```

### バックエンド

**Node 1 変更: file_id 追加**
- `/api/upload-step` で STEP ファイルを `backend/uploads/` に保存
- `BrepImportResult` に `file_id` フィールドを追加
- `uploads/` は `.gitignore` 対象

**Node 2 新規: contour_extract.py**
1. `file_id` から STEP ファイルを読み込み（build123d）
2. Z=0 で断面スライス（失敗時は Z=+0.001 でリトライ）
3. ワイヤーの頂点座標を抽出
4. shapely Polygon に変換
5. `buffer()` でオフセット適用
6. 座標列 JSON を返却

**新エンドポイント:**
- `POST /api/extract-contours`

**Pydantic スキーマ:**
```python
class ContourExtractRequest(BaseModel):
    file_id: str
    object_id: str
    tool_diameter: float = 6.35
    offset_side: str = "outside"  # "outside" | "inside" | "none"

class Contour(BaseModel):
    id: str
    type: str  # "exterior" | "interior"
    coords: list[list[float]]
    closed: bool

class OffsetApplied(BaseModel):
    distance: float
    side: str

class ContourExtractResult(BaseModel):
    object_id: str
    slice_z: float
    contours: list[Contour]
    offset_applied: OffsetApplied
```

### フロントエンド

**ContourExtractNode.tsx:**
- Node 1 からの接続で `file_id` と `object_id` を受け取る
- 「抽出実行」ボタンで API 呼び出し
- 結果表示: 輪郭数、座標点数、オフセット情報
- 下部に output Handle

**App.tsx 更新:**
- `nodeTypes` に ContourExtractNode を登録
- Node 2 プレースホルダーをカスタムノードに置き換え

**types.ts / api.ts 拡張:**
- `ContourExtractResult` 型追加
- `extractContours()` API 関数追加

## デフォルト加工設定（Phase 3 完成まで）

| パラメータ | デフォルト値 |
|-----------|-------------|
| tool_diameter | 6.35 mm (1/4") |
| offset_side | "outside" |

## 依存ライブラリ追加

- `shapely` — 2D 幾何演算（オフセット、座標操作）
