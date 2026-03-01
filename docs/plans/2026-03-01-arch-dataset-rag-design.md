# build123d 建築コードデータセット + RAG統合 設計

## 概要

build123dで建築設計を可能にするため、建築コードデータセットを体系的に構築し、PathDesignerのAI CADパイプラインにRAGとして統合する。

## アプローチ: 2プロジェクト分離

- **b3d-arch-dataset** (`OKRA_local/apps/b3d-arch-dataset/`): データ収集・変換パイプライン
- **pathdesigner**: RAG消費側。既存のLLMパイプラインにベクトル検索を追加

## 1. タクソノミー（要素 × 構法の2軸）

### 軸1: 建築要素（何を作るか）

```yaml
elements:
  furniture:              # 家具・インテリア
    - table, chair, shelf, lighting, bench
  architectural_detail:   # 建築部材・ディテール
    - wall_panel, window_frame, door_frame, stair, handrail, joint, molding, bracket
  facade:                 # ファサード・外装
    - screen, louver, cladding, canopy
  pavilion:               # パビリオン・構造体
    - frame, shell, gridshell, truss
  building_mass:          # 建物マス
    - extrusion, boolean_mass, floor_plan, roof
```

### 軸2: 構法（どう作るか）

| 構法 | 説明 | b3dパターン |
|------|------|-------------|
| frame_and_skin | フレーム＋面貼りレイヤ構成 | Wire/Edge → sweep/loft → Shell |
| mass_stacking | ソリッド積層・ブーリアン | Box/Cylinder → fuse/cut → compound |
| louver_array | 同一要素の反復配列 | 単一部材 → PolarLocations/GridLocations |
| waffle | 直交板材のスリット嵌合 | Sketch → extrude → intersecting slots |
| folding | 板材折り曲げ | Face → fold lines → loft between edges |
| shell_surface | 曲面シェル構造 | Spline/BezierCurve → loft → Shell(thickness) |
| interlocking | 嵌合・組手 | Box → cut(pattern) → mirror → mate |

各データエントリに element + construction_method の2タグが付く。

## 2. データ収集・変換パイプライン

```
① 収集 (collect)
   GitHub CadQueryコード / LLM生成 / 対話的作成
      │
② 変換 (convert)
   CadQuery → build123d (LLM変換 + 構文ルール)
      │
③ 検証 (verify)
   build123d 実行 → STEP出力確認 → 失敗時リトライ(最大3回)
      │
④ メタデータ付与 (annotate)
   element, construction_method, パラメータ説明, 難易度
      │
⑤ エクスポート (export)
   → PathDesigner の arch_snippets.db (コード + embedding + メタデータ)
```

### データエントリ構造

```json
{
  "id": "arch-0042",
  "name": "パラメトリック・ルーバースクリーン",
  "element": "facade/louver",
  "construction_method": "louver_array",
  "source": "github:cadquery-contrib/louver.py",
  "cadquery_code": "import cadquery as cq\n...",
  "build123d_code": "from build123d import *\n...",
  "parameters": {
    "width": {"type": "float", "default": 2000, "unit": "mm"},
    "height": {"type": "float", "default": 3000, "unit": "mm"},
    "blade_count": {"type": "int", "default": 20},
    "blade_angle": {"type": "float", "default": 45, "unit": "deg"}
  },
  "description": "角度調整可能なルーバーブレードの配列",
  "difficulty": "intermediate",
  "verified": true
}
```

## 3. 自動蓄積モニタリング + Google Sheetsレビュー

### taxonomy.yaml に目標数を定義

```yaml
elements:
  furniture:
    table:
      target: 10
      methods: [frame_and_skin, waffle, interlocking]
```

### monitor.py CLI

```bash
monitor.py status           # カテゴリ別進捗表示
monitor.py fill --max 20    # 不足カテゴリを自動生成
```

### Google Sheets レビューフロー (gog CLI連携)

```
パイプライン → sync_review.py push → Google Sheets
                                        ↓
                                   ユーザーが OK/NG 記入
                                        ↓
sync_review.py pull ← Google Sheets
   OK → verified/ に確定
   NG → 理由付きでLLMリトライ → 再度Sheetsに投入
```

## 4. PathDesigner RAG統合

### 仕組み

ユーザープロンプトで arch_snippets.db をベクトル検索し、関連する建築コード例をLLMのシステムプロンプトに動的注入。

```python
# arch_rag.py (新規)
class ArchRAG:
    async def search(self, query, element=None, method=None, limit=5) -> list[ArchSnippet]:
        # sqlite-vec でベクトル類似検索
```

```python
# llm_client.py (変更)
def _build_system_prompt(profile, include_reference=False, rag_examples=None):
    prompt = BASE_PROMPT + profile_cheatsheet
    if rag_examples:
        prompt += "\n\n## 関連する建築コード例\n"
        for ex in rag_examples:
            prompt += f"### {ex.name} ({ex.element} / {ex.method})\n```python\n{ex.code}\n```\n\n"
    ...
```

### RAGが効く3箇所

| 場面 | エンドポイント | 検索クエリ |
|------|---------------|-----------|
| 初回生成 | `/ai-cad/generate` | ユーザープロンプト |
| チャットリファイン | `/ai-cad/refine` | 修正指示テキスト |
| リトライ時 | 同上(retry分岐) | エラー内容 + 修正指示 |

### 新プロファイル

```python
"architecture": {
    "name": "建築設計",
    "cheatsheet": ARCH_CHEATSHEET,
    "use_rag": True,
}
```

### embedding

OpenRouter embedding API で開始。データ量増加後にローカル(sentence-transformers)へ移行可能。

## 5. b3d-arch-dataset プロジェクト構成

```
OKRA_local/apps/b3d-arch-dataset/
├── CLAUDE.md
├── pyproject.toml
├── taxonomy.yaml
├── sources/
│   ├── github/
│   └── generated/
├── converted/
├── verified/
│   └── {id}/
│       ├── meta.json
│       ├── cadquery.py
│       ├── build123d.py
│       └── model.step
├── scripts/
│   ├── collect_github.py
│   ├── generate_batch.py
│   ├── convert.py
│   ├── verify.py
│   ├── monitor.py
│   ├── sync_review.py
│   └── export.py
├── export/
│   └── arch_snippets.db
└── tests/
```

依存: build123d, httpx, pyyaml, sqlite-vec

## 6. ユーザーフロー

| モード | ユーザーの作業 | Claude Codeの役割 |
|--------|---------------|-------------------|
| バッチ生成 | 「○○を20件埋めて」と指示 | 収集→変換→検証を自動実行 |
| Sheetsレビュー | OK/NG記入（5-10分） | push/pull + NGリトライ |
| 対話的作成 | 一緒にコード設計 | 類似例提示 + コード生成 + 保存 |
| PathDesigner反映 | 「反映して」 | export.py → arch_snippets.db |
