# PathDesigner — カスタムノード基盤 設計書

日付: 2026-02-26

## 1. 背景・動機

PathDesignerは13ノード（CAD 4 + CAM 7 + Utility 2）が稼働するノードベースCAMシステムに成長した。
次のステージでは以下の2つの柱で進化させる：

1. **プラットフォーム化** — ユーザーがAIと一緒にカスタムノードを自作できる
2. **プロダクション対応** — 実案件で柔軟に対応できる拡張性

### 採用アプローチ

**スキーマ駆動アプローチ**を採用。ノード定義をJSON/YAMLスキーマで宣言的に記述し、フロントエンドUIを自動生成する。

選定理由：
- AIがスキーマを生成するのに最適（構造化データはLLMの得意領域）
- バリデーション・テストが容易
- 段階的に複雑さを増やせる
- 既存ノードの移行パスが明確

---

## 2. 現状アーキテクチャ（As-Is）

### システム全体構成

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React 19)                   │
│  ┌───────────────────────────────────────────────────┐  │
│  │            React Flow Canvas                       │  │
│  │  ┌─────────┐ ┌─────────┐ ┌──────────┐            │  │
│  │  │ CAD     │ │ CAM     │ │ Utility  │            │  │
│  │  │ Nodes(4)│ │ Nodes(7)│ │ Nodes(2) │            │  │
│  │  └────┬────┘ └────┬────┘ └──────────┘            │  │
│  │       │           │                               │  │
│  │       └─────┬─────┘                               │  │
│  │             │ node.data (useUpstreamData)          │  │
│  │             ▼                                     │  │
│  │  ┌───────────────────┐  ┌──────────────────────┐  │  │
│  │  │ PanelTabsContext  │──│  SidePanel (480px)   │  │  │
│  │  └───────────────────┘  │  - パネルタブ管理     │  │  │
│  │                         │  - ノード設定UI       │  │  │
│  │                         │  - 3Dプレビュー       │  │  │
│  │                         └──────────────────────┘  │  │
│  └───────────────────────────────────────────────────┘  │
│         │ REST API + SSE                                │
└─────────┼───────────────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────────────┐
│                  Backend (FastAPI)                        │
│  ┌────────────────┐  ┌─────────────────┐                │
│  │ CAM Pipeline   │  │ AI CAD Pipeline │                │
│  │ - brep_import  │  │ - Gemini (設計) │                │
│  │ - contour      │  │ - Qwen (コード) │                │
│  │ - operation    │  │ - self-review   │                │
│  │ - toolpath     │  │ - execute       │                │
│  │ - sbp_writer   │  │ - refine (chat) │                │
│  └────────────────┘  └─────────────────┘                │
│  ┌────────────────┐  ┌─────────────────┐                │
│  │ Code Execution │  │ SQLite DB       │                │
│  │ - ai_cad.py    │  │ - generations   │                │
│  │ - sandbox      │  │ - snippets      │                │
│  └────────────────┘  └─────────────────┘                │
└─────────────────────────────────────────────────────────┘
```

### ノード一覧

| type | カテゴリ | 役割 |
|------|---------|------|
| `aiCad` | cad | AIテキスト/画像プロンプトから3Dモデル生成 |
| `snippetDb` | cad | Codeライブラリからスニペット選択・実行 |
| `codeNode` | cad | CodeMirrorで手書きbuild123dコード実行 |
| `brepImport` | cad | STEPファイルをドロップしてBREP解析 |
| `sheet` | cam | シート素材寸法設定 |
| `placement` | cam | シート上への部品配置 |
| `operation` | cam | 加工操作の自動検出と設定 |
| `postProcessor` | cam | ShopBot SBP設定 |
| `toolpathGen` | cam | ツールパス生成 + SBPコード生成 |
| `cncCode` | cam | SBPコード表示・書き出し |
| `toolpathPreview` | cam | ツールパス可視化 |
| `dam` | utility | アップストリームデータの手動リリースゲート |
| `debug` | utility | アップストリームデータのJSON表示 |

### ノード間データフロー

```
 CAD Side                          CAM Side

 AiCadNode    ─┐
 CodeNode     ─┼── brepResult ──→ PlacementNode ── placementResult ──→ OperationNode
 SnippetDbNode─┘                      ▲                                     │
                               sheetSettings                         detectedOps
 BrepImportNode── brepResult         │                               assignments
                              SheetNode                              outlines
                                                                          │
                                                                          ▼
                              PostProcessorNode ── postSettings ──→ ToolpathGenNode
                                                                     │         │
                                                                     ▼         ▼
                                                              CncCodeNode  ToolpathPreviewNode
```

### ハンドルデータ型

| 型 | 色 | 用途 |
|---|---|---|
| `geometry` | 青 #4a90d9 | BREP・コンター・ジオメトリ |
| `settings` | 緑 #66bb6a | パラメータ・設定 |
| `toolpath` | オレンジ #ff9800 | ツールパス |
| `generic` | 灰 #9e9e9e | Debug・その他 |

---

## 3. カスタムノード基盤設計（To-Be）

### 3.1 ノード定義スキーマ

```yaml
# ===== ノード定義スキーマ (v1) =====

# --- メタデータ ---
name: string              # ユニークID (snake_case)
label: string             # 表示名
description: string       # 説明文
category: cad | cam | utility | custom
icon: string              # Material Icons名 or emoji
color: string             # ノードカラー（省略時はcategory依存）
version: number           # スキーマバージョン

# --- 入力ハンドル（左側ピン）---
inputs:
  - name: string          # ハンドルID
    type: geometry | settings | toolpath | number | text | list | any
    label: string
    required: boolean     # default: true

# --- 出力ハンドル（右側ピン）---
outputs:
  - name: string
    type: geometry | settings | toolpath | number | text | list | any
    label: string

# --- UIパラメータ ---
params:
  - name: string
    type: number | text | select | boolean | slider | color | file
    label: string
    default: any
    # 型ごとのオプション:
    min: number           # number/slider
    max: number
    step: number
    unit: string          # mm, deg, rpm
    options:              # select
      - value: string
        label: string
    placeholder: string   # text

# --- UIレイアウト ---
ui:
  template: form | canvas | code | composite | passthrough
  node_summary: string    # ノード上のサマリーテンプレート（例: "{radius}mm フィレット"）
  canvas:                 # canvas テンプレート用
    width: number
    height: number
  tabs:                   # composite テンプレート用
    - label: string
      template: form | canvas | code

# --- Python処理 ---
handler: |
  # inputs["handle名"] で上流データ、params["param名"] でUI設定値
  # outputs["handle名"] に結果を書き出す
```

### 3.2 スキーマ具体例

```yaml
# フィレット追加ノード
name: fillet_edges
label: "フィレット追加"
category: cad
icon: "rounded_corner"

inputs:
  - name: brep
    type: geometry
    label: "入力ジオメトリ"

outputs:
  - name: result
    type: geometry
    label: "出力ジオメトリ"

params:
  - name: radius
    type: slider
    label: "フィレット半径"
    default: 2.0
    min: 0.1
    max: 50.0
    step: 0.1
    unit: mm

ui:
  template: form
  node_summary: "{radius}mm フィレット"

handler: |
  from build123d import *
  solid = inputs["brep"]
  radius = params["radius"]
  filleted = fillet(solid, radius)
  outputs["result"] = filleted
```

```yaml
# Boolean演算ノード（複数入出力）
name: boolean_operation
label: "Boolean演算"
category: cad
icon: "merge_type"

inputs:
  - name: body_a
    type: geometry
    label: "ボディA"
  - name: body_b
    type: geometry
    label: "ボディB"

outputs:
  - name: result
    type: geometry
    label: "結果"
  - name: removed
    type: geometry
    label: "除去部分"

params:
  - name: operation
    type: select
    label: "操作"
    default: "subtract"
    options:
      - value: subtract
        label: "減算"
      - value: union
        label: "合体"
      - value: intersect
        label: "交差"

ui:
  template: form
  node_summary: "{operation}"

handler: |
  from build123d import *
  a = inputs["body_a"]
  b = inputs["body_b"]
  op = params["operation"]
  if op == "subtract":
    result = a - b
  elif op == "union":
    result = a + b
  else:
    result = a & b
  outputs["result"] = result
```

### 3.3 I/O型システム

既存4型 + 新規4型：

| 型 | ハンドル色 | データ内容 |
|---|---|---|
| `geometry` | 青 #4a90d9 | BrepResult / STEP / メッシュ |
| `settings` | 緑 #66bb6a | key-valueパラメータ |
| `toolpath` | オレンジ #ff9800 | ツールパスデータ |
| `generic` | 灰 #9e9e9e | デバッグ用 |
| `number` | 紫 (新) | 単一数値 |
| `text` | 黄 (新) | 文字列 |
| `list` | ピンク (新) | 配列 |
| `any` | 白 (新) | 型チェックなし |

接続ルール：同じ `type` 同士、または `any` の場合のみ接続可能。

### 3.4 UIテンプレート

| テンプレート | ノード上 | パネル | 用途例 |
|---|---|---|---|
| `form` | コンパクトサマリー | 入力フィールド群 | 設定系 |
| `canvas` | ミニプレビュー | Canvas/3D描画 | 可視化系 |
| `code` | ステータス | CodeMirrorエディタ | コード系 |
| `composite` | 複合 | タブ切替で複数パネル | 複雑ノード |
| `passthrough` | ハンドルのみ | なし | データ変換 |

param type → UIコンポーネント対応:

| param type | ノード上 | パネル上 |
|---|---|---|
| `number` | 値表示 | 数値入力 |
| `slider` | 値表示 | スライダー |
| `text` | — | テキスト入力 |
| `select` | 選択値 | ドロップダウン |
| `boolean` | アイコン | チェックボックス |
| `color` | カラーチップ | カラーピッカー |
| `file` | ファイル名 | ドラッグ&ドロップ |

---

## 4. システムアーキテクチャ変更

### To-Be 全体構成

```
┌──────────────────────────────────────────────────────────────┐
│                       Frontend                               │
│  ┌──────────────────────────────────────────────────────┐    │
│  │              React Flow Canvas                        │    │
│  │  ┌──────────────┐   ┌────────────────────────────┐   │    │
│  │  │ Built-in     │   │ Dynamic Nodes              │   │    │
│  │  │ Nodes (既存) │   │ (スキーマから動的生成)       │   │    │
│  │  └──────────────┘   └──────────┬─────────────────┘   │    │
│  │                                ▲ スキーマ解釈         │    │
│  │                     ┌──────────┴─────────────┐        │    │
│  │                     │ DynamicNodeRenderer     │        │    │
│  │                     │ (UIテンプレートエンジン)  │        │    │
│  │                     └────────────────────────┘        │    │
│  └───────────────────────────────────────────────────────┘    │
│  ┌──────────────────────┐  ┌──────────────────────────┐      │
│  │ Node Builder Panel   │  │ SidePanel (既存)          │      │
│  │ - AI対話でスキーマ生成 │  │                          │      │
│  │ - I/O定義エディタ     │  │                          │      │
│  │ - UIプレビュー        │  │                          │      │
│  └──────────────────────┘  └──────────────────────────┘      │
└──────────┬───────────────────────────────────────────────────┘
           │
┌──────────▼───────────────────────────────────────────────────┐
│                      Backend                                  │
│  ┌──────────────────┐  ┌──────────────────────────────┐      │
│  │ 既存パイプライン   │  │ Custom Node Runtime  [NEW]   │      │
│  │ (CAM / AI CAD)   │  │                              │      │
│  │                  │  │ POST /custom-nodes/execute    │      │
│  │                  │  │ CRUD /custom-nodes/           │      │
│  │                  │  │ POST /custom-nodes/generate   │      │
│  └──────────────────┘  └──────────────────────────────┘      │
│  ┌──────────────────────────────────────────────┐            │
│  │ SQLite: custom_nodes テーブル [NEW]           │            │
│  │ - id, name, schema_yaml, python_code,        │            │
│  │   category, icon, created_at                 │            │
│  └──────────────────────────────────────────────┘            │
└───────────────────────────────────────────────────────────────┘
```

### 新規APIエンドポイント

| メソッド | パス | 説明 |
|---|---|---|
| `POST` | `/custom-nodes/` | カスタムノード定義を保存 |
| `GET` | `/custom-nodes/` | カスタムノード一覧を取得 |
| `GET` | `/custom-nodes/{id}` | 特定ノード定義を取得 |
| `PUT` | `/custom-nodes/{id}` | ノード定義を更新 |
| `DELETE` | `/custom-nodes/{id}` | ノード定義を削除 |
| `POST` | `/custom-nodes/execute` | カスタムノードのPython handlerを実行 |
| `POST` | `/custom-nodes/generate` | AIでスキーマ+handlerを生成（SSE） |

### 新規DBテーブル

```sql
CREATE TABLE custom_nodes (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    schema_yaml TEXT NOT NULL,     -- フルスキーマ（YAML）
    python_code TEXT NOT NULL,     -- handler部分
    category TEXT DEFAULT 'custom',
    icon TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

---

## 5. AI統合

### ユースケースA: AI対話でカスタムノードを作成

```
ユーザー: 「STEPのエッジにフィレットをかけるノード」
     ↓
Stage 1 (Gemini): 要求分析 → スキーマ設計（YAML）
Stage 2 (Qwen):  スキーマ → Python handler実装
Stage 3: プレビュー表示 → ユーザー確認
Stage 4: 保存 → サイドバーに追加 → キャンバスにドロップ可能
```

既存の2ステージAIパイプライン（`llm_client.py`）を活用。

### ユースケースB: 既存ノードのhandlerをチャットで修正

既存のrefineフロー（`/ai-cad/refine`）を活用。

---

## 6. 実装フェーズ（概要）

### Phase 1: 基盤構築
- ノード定義スキーマのPydanticモデル
- バックエンド: CRUD API + execute エンドポイント
- DBテーブル作成

### Phase 2: フロントエンド動的レンダリング
- DynamicNodeRenderer コンポーネント
- form テンプレートの実装（param type → UIコンポーネント）
- サイドバーにカスタムノード一覧を追加

### Phase 3: AI統合
- Node Builder Panel（AI対話UI）
- /custom-nodes/generate エンドポイント
- スキーマ + handler の同時生成

### Phase 4: 追加テンプレート
- canvas テンプレート
- composite テンプレート
- passthrough テンプレート

### Phase 5: 既存ノード移行（オプション）
- 既存ハードコードノードをスキーマベースに段階的に移行
