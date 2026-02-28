# ブレインストーミング: PathDesigner — Python + React Flow でシンプルCAM

> 最終更新: 2026-02-21（Phase 1 完了）

## テーマ・課題
**PathDesigner** — PythonとReact Flowを使ったノードベースCAMシステム
- 対象: CNCフライス（v1） + 3Dプリンター（将来）
- フロントエンド: React Flow（ノードベースUI）
- バックエンド: Python（ツールパス生成ロジック）
- データ管理: すべてJSONベース
- 出力形式: **OpenSBP (.sbp)** — ShopBot対応
- 思想: ミニマムから始めて徐々にコンポーネントを増やす

## アーキテクチャ構想

### ノード一覧（v1）
1. **BREPインポートノード** — STEP読み込み、寸法・厚み・加工タイプ判定をJSONに付加
2. **外形線抽出ノード** — BREPから外形輪郭を抽出（素材底面基準、加工設定を入力に含む）
3. **加工設定ノード** — 刃物径・送り速度・回転数・パス回数・加工の向き・加工タイプ等
4. **マージノード** — 複数パスの統合（掘り込み、斜め加工等を将来マージ）
5. **ポストプロセッサ設定ノード** — 機械固有の出力設定（SBPベース）
6. **加工パス生成ノード** — ツールパス計算・SBPコード生成
7. **プレビューノード** — SBPコードの表示・加工パスの可視化

### v1スコープ決定事項
- プロジェクト名: **PathDesigner**
- 入力形式: **STEP (.step/.stp)** — Rhino互換性重視
- 出力形式: **OpenSBP (.sbp)** — ShopBot対応
- 外形線抽出: **素材底面**基準
- 穴（ドーナッツ型）の処理: **v2以降**
- 3Dプリンター対応: **延期**（将来は自前スライサー）
- 加工タイプ判定: **BREPインポートノード内で実施**（build123dで解析）

---

## ノード間JSONスキーマ（v1）

### ノード1: BREPインポートノード

**入力:** STEPファイルアップロード
**出力JSON:**
```json
{
  "objects": [
    {
      "object_id": "obj_001",
      "file_name": "part.step",
      "bounding_box": {"x": 100.0, "y": 50.0, "z": 10.0},
      "thickness": 10.0,
      "origin": {
        "position": [0.0, 0.0, 0.0],
        "reference": "bounding_box_min",
        "description": "バウンディングボックスの最小角（左下奥）"
      },
      "unit": "mm",
      "is_closed": true,
      "is_planar": true,
      "machining_type": "2d",
      "faces_analysis": {
        "top_features": true,
        "bottom_features": false,
        "freeform_surfaces": false
      }
    },
    {
      "object_id": "obj_002",
      "file_name": "part.step",
      "bounding_box": {"x": 80.0, "y": 30.0, "z": 10.0},
      ...
    }
  ],
  "object_count": 2
}
```

**originの方針:**
- `reference`: 原点の参照点を明示
  - `"bounding_box_min"` — BBの最小角（左下奥）← v1デフォルト
  - `"bounding_box_center"` — BB中心
  - `"model_origin"` — STEPファイル内のそのままの原点
- ShopBot加工では材料コーナー基準が一般的なので、`bounding_box_min` が自然

**追加フィールド:**
- `is_closed` — 閉じたソリッドかどうか（開いたサーフェスの場合false）
- `is_planar` — XY平面に対してプラナーに配置されているか（CNC 2D加工の前提条件）
- `object_count` — 複数オブジェクトが入力された場合の数量
- 各オブジェクトが独立したJSONエントリを持つ（配列構造）

**is_planarについて:**
- v1では2D CNC加工が前提なので、プラナーチェックは有用
- `false` の場合は警告を出す（「回転させますか？」等）
- 3Dプリントや両面加工では `false` でも加工可能 → 将来の拡張時に条件分岐

---

### ノード2: 外形線抽出ノード

**入力:** ノード1の出力 + ノード3（加工設定）の出力
**出力JSON:**
```json
{
  "object_id": "obj_001",
  "slice_z": 0.0,
  "contours": [
    {
      "id": "contour_001",
      "type": "exterior",
      "coords": [[0,0], [100,0], [100,50], [0,50], [0,0]],
      "closed": true
    }
  ],
  "offset_applied": {
    "distance": 3.175,
    "side": "outside"
  }
}
```

- 加工設定（刃物径・オフセット方向）を入力に含めることで、オフセット済み輪郭を出力
- 別途オフセットノードは不要

---

### ノード3: 加工設定ノード

**入力:** ユーザーがUIで設定
**出力JSON:**
```json
{
  "operation_type": "contour",
  "tool": {
    "diameter": 6.35,
    "type": "endmill",
    "flutes": 2
  },
  "feed_rate": {
    "xy": 75,
    "z": 25
  },
  "jog_speed": 200,
  "spindle_speed": 18000,
  "depth_per_pass": 6.0,
  "total_depth": 18.0,
  "direction": "climb",
  "offset_side": "outside",
  "tabs": {
    "enabled": true,
    "height": 8.0,
    "width": 5.0,
    "count": 4
  }
}
```

**operation_typeで将来の拡張に対応:**
- `"contour"` — 外形切り抜き（v1）
- `"pocket"` — ポケット加工（v2）
- `"drill"` — 穴あけ（v2）
- `"engrave"` — 彫刻（v2）
- `"profile_3d"` — 3D加工（将来）

operation_typeに応じてUIのフォーム項目が変わる設計。
ポケット加工なら `stepover`, `pattern` (zigzag/spiral) 等が追加される。

---

### ノード4: マージノード

**入力:** 複数の（contours + 加工設定）ペア
**出力JSON:**
```json
{
  "operations": [
    {
      "operation_id": "op_001",
      "operation_type": "contour",
      "object_id": "obj_001",
      "contours": [...],
      "settings": {...},
      "order": 1
    },
    {
      "operation_id": "op_002",
      "operation_type": "contour",
      "object_id": "obj_002",
      "contours": [...],
      "settings": {...},
      "order": 2
    }
  ]
}
```

---

### ノード5: ポストプロセッサ設定ノード（SBPベース）

**入力:** ユーザーがUIで設定
**出力JSON:**
```json
{
  "machine": "shopbot",
  "output_format": "sbp",
  "unit": "mm",
  "unit_check": true,
  "coordinate_mode": "absolute",
  "tool_number": 3,
  "spindle_warmup": {
    "initial_rpm": 5000,
    "wait_seconds": 2
  },
  "safe_z": 38.0,
  "home_position": [0.0, 0.0],
  "material": {
    "width": 600,
    "depth": 400,
    "thickness": 18,
    "x_offset": 0,
    "y_offset": 0
  },
  "header_commands": ["CN,90"],
  "footer_commands": ["C7"],
  "custom_commands": {
    "tool_change": "C9",
    "spindle_on": "C6",
    "spindle_off": "C7"
  }
}
```

EMARF CAMのSBPファイル構造に準拠した設計:
- 単位チェック (`IF %(25)=0 THEN GOTO UNIT_ERROR`)
- ツール設定 (`&Tool`, `C9`, `TR`, `C6`)
- 材料メタデータ（コメントとして埋め込み）
- 速度設定 (`MS`, `JS`)
- 安全高さ・ホーム位置
- カスタムコマンド（C6/C7/C9等、マシン固有）

---

### ノード6: 加工パス生成ノード

**入力:** マージノード出力 + ポスプロ設定
**出力JSON:**
```json
{
  "toolpaths": [
    {
      "operation_id": "op_001",
      "passes": [
        {
          "pass_number": 1,
          "z_depth": 12.0,
          "path": [[30.4, 105.1], [30.5, 105.2], ...],
          "tabs": [
            {"start_index": 45, "end_index": 48, "z_tab": 8.0}
          ]
        },
        {
          "pass_number": 2,
          "z_depth": 6.0,
          "path": [...]
        },
        {
          "pass_number": 3,
          "z_depth": -0.3,
          "path": [...]
        }
      ]
    }
  ],
  "sbp_code": "'SHOPBOT ROUTER FILE IN MM\n'GENERATED BY PathDesigner\n..."
}
```

- Z深さは材料表面からの絶対座標（SBP準拠）
- タブ情報をパスに埋め込み
- `sbp_code` に完成したSBPファイル内容を格納

---

### ノード7: プレビューノード

**入力:** ノード6の出力
**表示内容:**
- SBPコードのテキスト表示（シンタックスハイライト付き）
- 2Dツールパスの可視化（XY平面）
- パス情報サマリ（パス数、合計距離、推定加工時間）
- SBPファイルダウンロードボタン

---

## データフロー（更新）

```
                    ┌─────────────┐
                    │ 加工設定(3)  │
                    │ operation_type
                    │ 刃物径・送り等 │
                    └──────┬──────┘
                           │
┌──────────┐    ┌──────────▼──────────┐    ┌──────────┐
│ STEP取込(1)│───→│   外形線抽出(2)      │───→│ マージ(4) │
│ 複数obj対応│    │ オフセット込み       │    │ 加工順序  │
│ is_closed  │    └─────────────────────┘    └────┬─────┘
│ is_planar  │                                    │
└──────────┘    ┌────────────────────┐            │
                │ ポスプロ設定(5)     │            │
                │ ShopBot SBP       │            │
                └────────┬──────────┘            │
                         │    ┌──────────────────┘
                         │    │
                    ┌────▼────▼────┐    ┌──────────┐
                    │ パス生成(6)   │───→│ プレビュー(7)│
                    │ SBPコード生成 │    │ SBPコード表示│
                    └─────────────┘    │ パス可視化  │
                                       └──────────┘
```

---

## 技術スタック（確定）
- フロントエンド: React + React Flow + TypeScript
- バックエンド: FastAPI (Python)
- 通信: REST + WebSocket ハイブリッド
- データ形式: JSON（Pydanticでスキーマ定義）
- 3Dモデル入力: STEP形式
- 出力形式: OpenSBP (.sbp)
- リファレンス: `resources/shopbot/` のSBPファイル・ドキュメント

### Python ライブラリ
- **build123d** — STEP読み込み・BREP操作・断面抽出・加工タイプ判定
- **shapely** — 2D幾何演算（オフセット、バッファ、ブーリアン、ツールパス座標生成）
- **ezdxf** — DXF入出力（補助的）

---

## ディレクトリ構成（確定・シンプル版）

```
apps/pathdesigner/            ← GitHub リポジトリルート (tokura.designmake)
├── backend/
│   ├── pyproject.toml        # uv 管理
│   ├── main.py               # FastAPI エントリポイント + ルート
│   ├── schemas.py            # Pydantic モデル（全ノード分）
│   ├── nodes/
│   │   ├── __init__.py
│   │   ├── brep_import.py
│   │   ├── contour_extract.py
│   │   ├── machining_settings.py
│   │   ├── merge.py
│   │   ├── post_processor.py
│   │   └── toolpath_gen.py
│   ├── sbp_writer.py         # SBPコード生成
│   └── tests/
│       └── test_nodes.py
│
├── frontend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── src/
│       ├── App.tsx            # React Flow キャンバス + 状態管理
│       ├── main.tsx
│       ├── types.ts           # 型定義
│       ├── api.ts             # バックエンド通信
│       └── nodes/
│           ├── BrepImportNode.tsx
│           ├── ContourExtractNode.tsx
│           ├── MachiningSettingsNode.tsx
│           ├── MergeNode.tsx
│           ├── PostProcessorNode.tsx
│           ├── ToolpathGenNode.tsx
│           └── PreviewNode.tsx
│
├── .gitignore
└── README.md
```

**設計方針:** ファイルが大きくなったら分ける。最初から分けない。

---

## 開発フェーズ

| Phase | 内容 | ゴール |
|-------|------|--------|
| **0** | プロジェクト初期化 | リポジトリ作成、uv/vite セットアップ、FastAPI hello world、React Flow 空キャンバス表示 |
| **1** | BREPインポート | STEPファイル → JSON変換が動く（build123d） |
| **2** | 外形線抽出 | 輪郭座標JSONが出力される（shapely） |
| **3** | 加工設定UI | React Flowでパラメータ入力できる |
| **4** | パス生成 + SBP出力 | 座標列 → SBPファイル生成 |
| **5** | プレビュー | SBPコード表示 + 2Dパス可視化 |
| **6** | マージ + 複数オブジェクト | 複数パーツの統合加工 |

GitHub: tokura.designmake/pathdesigner でフェーズごとにissue/PRを分けて管理

---

## 議論の流れ
### セッション: 2026-02-21
- テーマ提示: PythonとReact FlowでシンプルなCAMを作りたい
- 対象機器: CNC + 3Dプリンター → v1はCNCのみ
- ノードベースワークフローの構成決定（7ノード）
- 全データをJSONで管理する方針
- Python側のライブラリ選定: shapely, ezdxf, build123d
- 入力: STEP形式（Rhino互換）、出力: OpenSBP形式（ShopBot対応）
- 通信: FastAPI REST + WebSocket ハイブリッド
- プロジェクト名: **PathDesigner**
- ノード間JSONスキーマ全7ノード分を設計
- ディレクトリ構成をシンプル版で確定
- 6フェーズの開発計画を策定
- GitHub (tokura.designmake) で管理

## まとめ・ネクストアクション

### 決定事項
- プロジェクト名: **PathDesigner**
- ノードベースCAM（React Flow + FastAPI + Python）
- v1スコープ: CNC外形切り抜き、STEP入力、SBP出力
- JSONで全ノード間データ管理
- シンプルなディレクトリ構成、育てながら分割する方針

### ネクストアクション
- [x] Phase 0: プロジェクト初期化（本セッション中に実施）
  - apps/pathdesigner/ にbackend/frontend セットアップ
  - FastAPI hello world + React Flow 空キャンバス
- [x] GitHub リポジトリ作成 → https://github.com/hajimetokura/pathdesigner
- [x] Phase 1〜6 のissue作成済み (#1〜#6)
- [x] Phase 1: BREPインポートノード実装（PR #7 → main マージ済み）
  - build123d で STEP 解析 → JSON 出力
  - `POST /api/upload-step` エンドポイント
  - React Flow カスタムノード（ドラッグ&ドロップ UI）
  - Makefile 追加（`make dev` で同時起動）
- [ ] Phase 2: 外形線抽出ノード実装
- [ ] Phase 3: 加工設定UI
- [ ] Phase 4: パス生成 + SBP出力
- [ ] Phase 5: プレビュー
- [ ] Phase 6: マージ + 複数オブジェクト
