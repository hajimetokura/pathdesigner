# アーキテクチャ再設計: オペレーション中心のノード構成

> 日付: 2026-02-22

## 背景

Phase 4 完了時点でのアーキテクチャレビューにより、以下の課題が浮上:

1. **MaterialSettings が PostProcessorSettings に内包されている** — 素材設定はマシン設定ではなくジョブ設定
2. **複合加工に対応できない** — 現在は外形切り抜きのみ。ポケット・穴あけ等を追加するためのノード構造がない
3. **マージノードの立ち位置が曖昧** — 複数オブジェクトの統合は「オペレーション管理」の一部であるべき
4. **自動検出→手動調整のワークフロー** — 3Dデータから加工操作を自動判定し、個別にオン/オフ・設定変更したい

## 選択したアプローチ: オペレーション中心（Approach B）

3つのアプローチを検討:
- **A: Material 分離のみ** — 最小修正だが根本課題は残る
- **B: オペレーション中心の再設計** ← 選択
- **C: Grasshopper 型ビルディングブロック** — v1 には過剰

B を選択した理由: 実際の CNC 加工ワークフロー（自動検出→調整）に最も合致。将来 C の柔軟性を B 上に追加可能。

## ノード構成

### 変更前（7 ノード）

| # | ノード | 役割 |
|---|--------|------|
| 1 | STEP インポート | STEP 読み込み・BREP 解析 |
| 2 | 外形線抽出 | 底面スライス → 輪郭座標 |
| 3 | 加工設定 | 工具・送り・タブ等（グローバル 1 つ） |
| 4 | マージ | 複数パスの統合 |
| 5 | ポストプロセッサ | マシン設定 + 素材設定 |
| 6 | パス生成 | ツールパス計算・SBP 出力 |
| 7 | プレビュー | SBP 表示・パス可視化 |

### 変更後（7 ノード、役割再編）

| # | ノード | 役割 | 変更 |
|---|--------|------|------|
| 1 | **STEP インポート** | STEP 読み込み・BREP 解析 | 既存のまま |
| 2 | **素材（Stock）** | 加工素材の定義（複数対応） | **新規** |
| 3 | **オペレーション検出** | BREP から加工操作を自動検出 | 外形抽出を拡張 |
| 4 | **オペレーション編集** | 検出された操作のオン/オフ・設定変更 | 加工設定 + マージを統合 |
| 5 | **ポストプロセッサ** | マシン固有の出力設定のみ | material を除去 |
| 6 | **ツールパス生成** | 全操作のパス生成 + SBP 出力 | 入力スキーマ変更 |
| 7 | **プレビュー** | SBP 表示・パス可視化 | 既存のまま |

### データフロー

```
┌──────────┐    ┌──────────────┐    ┌──────────────┐
│ STEP(1)   │───→│ 操作検出(3)   │───→│ 操作編集(4)   │
└──────────┘    └──────────────┘    │  サマリー表示  │
                                    │ [詳細を編集...]│
┌──────────┐                       └──────┬───────┘
│ 素材(2)   │                              │
└───┬──────┘                              │
    │   ┌──────────┐                      │
    │   │ ポスプロ(5)│                      │
    │   └────┬─────┘                      │
    │        │                            │
    └────────┼────────────────────────────┘
        ┌────▼────────────────────▼───┐
        │        パス生成(6)           │
        └──────────────┬──────────────┘
                  ┌────▼──────┐
                  │プレビュー(7)│
                  └───────────┘
```

## 新規スキーマ

### 素材（Stock）

```python
class StockMaterial(BaseModel):
    material_id: str          # "mtl_1", "mtl_2"
    label: str = ""           # ユーザーが任意でつける名前
    width: float = 600        # mm (X)
    depth: float = 400        # mm (Y)
    thickness: float = 18     # mm (Z)
    x_position: float = 0     # CNC ベッド上の配置位置
    y_position: float = 0

class StockSettings(BaseModel):
    materials: list[StockMaterial]  # 1 つ以上
```

- v1: 矩形板材のみ（`width/depth/thickness`）
- 将来: `type: "custom"` で不定形素材・BREP 入力に対応

### オペレーション検出

```python
class OperationGeometry(BaseModel):
    contours: list[Contour]       # 既存の Contour スキーマを再利用
    offset_applied: OffsetApplied
    depth: float                  # この操作の深さ (mm)

class DetectedOperation(BaseModel):
    operation_id: str             # "op_001"
    object_id: str                # "obj_001"
    operation_type: str           # "contour" | "pocket" | "drill" | "engrave"
    geometry: OperationGeometry
    suggested_settings: MachiningSettings
    enabled: bool = True

class OperationDetectResult(BaseModel):
    operations: list[DetectedOperation]
```

検出する操作タイプ:

| 操作 | 検出ロジック | v1 | v2+ |
|------|-------------|:---:|:---:|
| 外形切り抜き (contour) | 底面スライスの外周 | ✓ | ✓ |
| ポケット (pocket) | 上面から一定深さの凹み | - | ✓ |
| 穴あけ (drill) | 貫通する円形穴 | - | ✓ |
| 彫刻 (engrave) | 浅い溝・テキスト | - | ✓ |

### オペレーション編集

```python
class OperationAssignment(BaseModel):
    operation_id: str
    material_id: str              # どの素材で加工するか
    enabled: bool = True
    settings: MachiningSettings   # 個別に調整可能
    order: int                    # 加工順

class OperationEditResult(BaseModel):
    assignments: list[OperationAssignment]
```

### ポストプロセッサ（修正）

```python
class PostProcessorSettings(BaseModel):
    machine_name: str = "ShopBot PRS-alpha 96-48"
    output_format: str = "sbp"
    unit: str = "mm"
    bed_size: list[float] = [1220.0, 2440.0]
    safe_z: float = 38.0
    home_position: list[float] = [0.0, 0.0]
    tool_number: int = 3
    warmup_pause: int = 2
    # material は削除 → StockSettings に移動済み
```

### パス生成（修正）

```python
class ToolpathGenRequest(BaseModel):
    operations: list[OperationAssignment]
    detected_operations: OperationDetectResult
    stock: StockSettings

class SbpGenRequest(BaseModel):
    toolpath_result: ToolpathGenResult
    operations: list[OperationAssignment]
    stock: StockSettings
    post_processor: PostProcessorSettings
```

## Z 座標の計算

| 操作 | 加工深さ |
|------|---------|
| 外形切り抜き | `stock.thickness + penetration`（素材を貫通） |
| ポケット | `operation.geometry.depth`（ポケットの深さ） |
| 穴あけ | `stock.thickness + penetration`（貫通） |

## バリデーション

- オブジェクト → 素材割り当て時: `stock.thickness >= object.thickness`
- 割り当て不可の場合は警告表示

## UI 設計

### オペレーション編集ノード

キャンバス上はコンパクトなサマリー表示。詳細編集はサイドパネルで行う。

**ノード本体（コンパクト）:**
```
┌─ オペレーション ───────────┐
│ 3 操作検出 / 2 有効       │
│                           │
│  obj_1: 外形, ポケット ✓  │
│  obj_2: 外形 ✓            │
│                           │
│ [詳細を編集...]           │
└───────────────────────────┘
```

**サイドパネル（詳細）:**
- アコーディオンで各オブジェクトを展開
- 操作ごとにオン/オフ・設定変更
- 素材割り当てドロップダウン
- プリセット適用
- 手動操作追加

## 影響を受けるファイル

| ファイル | 変更 |
|---------|------|
| `backend/schemas.py` | `StockMaterial`, `StockSettings`, `DetectedOperation` 等追加。`PostProcessorSettings` から material 削除 |
| `backend/nodes/contour_extract.py` | → `operation_detector.py` にリネーム・拡張 |
| `backend/nodes/toolpath_gen.py` | 入力を `OperationAssignment` + `StockSettings` に変更 |
| `backend/sbp_writer.py` | `StockSettings` を受け取るように変更 |
| `backend/main.py` | エンドポイントのリクエスト/レスポンス型を更新 |
| `frontend/src/types.ts` | TypeScript 型を追加・更新 |
| `frontend/src/nodes/PostProcessorNode.tsx` | Material セクション削除 |
| 新規: `frontend/src/nodes/StockNode.tsx` | 素材ノード UI |
| 新規: `frontend/src/nodes/OperationNode.tsx` | 検出 + 編集ノード（サイドパネル付き） |
| `frontend/src/App.tsx` | ノード登録・初期配置・エッジ接続の更新 |

## v1 スコープ

**対応する:**
- 素材ノード: 矩形板材の定義（複数素材対応）
- オペレーション検出: 外形切り抜きのみ（既存ロジック流用）
- オペレーション編集: オン/オフ、設定変更、素材割り当て
- ポストプロセッサ: material 削除
- パス生成: 新スキーマ対応

**対応しない:**
- ポケット検出、穴あけ検出
- ネスティング（素材面積内への自動配置）
- 素材 BREP 入力
