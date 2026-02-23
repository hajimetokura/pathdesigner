# AI CAD Node — Design Document

**Date:** 2026-02-23
**Status:** Draft

## 概要

PathDesignerに「AI CAD」ノードを追加する。スケッチ画像+テキストプロンプトからLLM（OpenRouter経由）でbuild123dコードを生成・実行し、3Dモデルデータを出力する。既存のBREP Importと並列の「入口ノード」として機能し、下流のCAMパイプラインは変更不要。

生成データはSQLite + ファイルストレージで永続化し、将来のテンプレート化・AI学習データとして蓄積する。

## モチベーション

- 簡単な形状のためにRhinoを起動する手間をなくす
- スケッチ写真やテキスト指示から直接CNCパーツを生成するワークフローを実現
- 画像入力 → AI認識 → モデリング → CAM加工の一気通貫パイプライン

## ノード構成

```
[AI CAD Node] ──→ [Sheet] ──→ [Placement] ──→ [Operation] ──→ ...
     ↑
  画像 + テキスト入力
  3Dプレビュー / コード表示（サイドパネル）

[BREP Import] ──→ (同じ下流パイプライン)  ← STEPファイル持ってる場合
```

AI CADノードはBREP Importと**同じ出力型** (`BrepImportResult`) を使用し、下流ノードは変更不要。

## LLM バックエンド: OpenRouter

コスト最適化のため、OpenRouter経由で複数の安価なコーディング特化モデルを切り替える。

### 対象モデル

| モデル | 用途 | 特徴 |
|--------|------|------|
| Gemini 2.5 Flash Lite | デフォルト | 超安価、コード生成◎ |
| DeepSeek R1 | 推論重視 | 複雑な形状、reasoning向き |
| Qwen3 Coder Next | コード特化 | コーディング精度◎ |

### 設定

```python
# 環境変数
OPENROUTER_API_KEY=...
AI_CAD_MODEL=google/gemini-2.5-flash-lite  # デフォルト

# バックエンド設定ファイル (backend/config.yaml or 環境変数)
# UIのドロップダウンでも変更可能
```

### OpenRouter API 呼び出し

```python
# OpenRouter は OpenAI互換API
import httpx

response = await httpx.post(
    "https://openrouter.ai/api/v1/chat/completions",
    headers={
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "HTTP-Referer": "https://pathdesigner.local",
    },
    json={
        "model": selected_model,
        "messages": [...],
    },
)
```

OpenRouter は OpenAI 互換 API なので、`openai` SDK や生の HTTP で呼べる。画像入力もマルチモーダル対応モデルなら同一APIで送信可能。

## UI設計

### ノード本体（コンパクト）

- テキスト入力欄（プロンプト）
- 画像ドロップゾーン（スケッチ写真D&D / クリックで選択）
- モデル選択ドロップダウン（設定のデフォルト値を初期表示）
- 「生成」ボタン
- ステータス表示: idle → generating → success / error
- 成功時: オブジェクト数、BBox概要表示
- 「View 3D」「View Code」ボタン → サイドパネル

### サイドパネル

- **3Dプレビュータブ**: 既存MeshViewerコンポーネント再利用
- **コードタブ**: 生成されたbuild123dコード表示、手動編集可能、「再実行」ボタン
- **ライブラリタブ**（Phase 2）: 過去の生成結果一覧

## データフロー

```
[Frontend]                        [Backend]                      [OpenRouter]
   │                                 │                               │
   │── POST /ai-cad/generate ──────→│                               │
   │   { prompt, image_base64?,      │── OpenRouter API call ──────→│
   │     model? }                    │   system_prompt +             │
   │                                 │   build123d examples +        │
   │                                 │   user prompt + image         │
   │                                 │←── build123d code ───────────│
   │                                 │                               │
   │                                 │── exec() sandbox ──────────→ Solid in memory
   │                                 │── analyze (既存) ───────────→ objects[]
   │                                 │── tessellate (既存) ────────→ mesh
   │                                 │── save to DB ──────────────→ SQLite + files
   │                                 │                               │
   │←── AiCadResult ───────────────│
   │    { objects, meshes,           │
   │      code, generation_id }      │
   │                                 │
   │── POST /ai-cad/execute ───────→│  (手動コード編集→再実行)
   │   { code }                      │
   │←── AiCadResult ───────────────│
   │                                 │
   │── GET /ai-cad/library ────────→│  (過去の生成一覧)
   │←── GenerationSummary[] ───────│
   │                                 │
   │── GET /ai-cad/library/{id} ───→│  (特定の生成を読み込み)
   │←── AiCadResult ───────────────│
   │                                 │
   │── GET /ai-cad/models ─────────→│  (利用可能モデル一覧)
   │←── ModelInfo[] ───────────────│
```

## バックエンド設計

### 新規ファイル

```
backend/
├── nodes/
│   └── ai_cad.py           # LLM呼出 + コード実行 + 解析
├── prompts/
│   ├── system.md            # システムプロンプト
│   └── examples.md          # build123dコード例
├── llm_client.py            # OpenRouter APIクライアント（モデル切替対応）
├── db.py                    # SQLiteデータベース管理
└── data/                    # ファイルストレージ（gitignore対象）
    ├── generations/         # {generation_id}/code.py, model.step, thumb.png
    └── pathdesigner.db      # SQLiteファイル
```

### エンドポイント

| Method | Path | 説明 |
|--------|------|------|
| POST | `/ai-cad/generate` | プロンプト+画像からモデル生成 |
| POST | `/ai-cad/execute` | build123dコード手動実行 |
| GET | `/ai-cad/models` | 利用可能なLLMモデル一覧 |
| GET | `/ai-cad/library` | 生成履歴一覧（ページネーション、検索） |
| GET | `/ai-cad/library/{id}` | 特定の生成データ読み込み |
| DELETE | `/ai-cad/library/{id}` | 生成データ削除 |

### Pydanticスキーマ

```python
class AiCadRequest(BaseModel):
    prompt: str
    image_base64: str | None = None
    model: str | None = None  # 未指定ならデフォルトモデル

class AiCadCodeRequest(BaseModel):
    code: str  # build123dコード手動入力

class AiCadResult(BrepImportResult):
    """AI CADノードの出力。BrepImportResultを拡張。"""
    generated_code: str
    generation_id: str
    prompt_used: str
    model_used: str

class GenerationSummary(BaseModel):
    """ライブラリ一覧用の要約データ。"""
    generation_id: str
    prompt: str
    object_count: int
    model_used: str
    created_at: str  # ISO 8601

class ModelInfo(BaseModel):
    """利用可能なLLMモデル情報。"""
    id: str            # e.g. "google/gemini-2.5-flash-lite"
    name: str          # e.g. "Gemini 2.5 Flash Lite"
    is_default: bool
    supports_vision: bool
```

### SQLite テーブル

```sql
CREATE TABLE generations (
    id TEXT PRIMARY KEY,           -- UUID
    prompt TEXT NOT NULL,
    image_path TEXT,               -- data/generations/{id}/input.jpg
    code TEXT NOT NULL,            -- build123dコード
    result_json TEXT,              -- BrepImportResult JSON
    step_path TEXT,                -- data/generations/{id}/model.step
    model_used TEXT NOT NULL,      -- OpenRouterモデルID
    status TEXT NOT NULL,          -- 'success' | 'error'
    error_message TEXT,
    tags TEXT,                     -- JSON配列: ["template", "furniture"]
    created_at TEXT NOT NULL       -- ISO 8601
);
```

### OpenRouter クライアント (llm_client.py)

```python
class LLMClient:
    """OpenRouter API client with model switching."""

    MODELS = {
        "google/gemini-2.5-flash-lite": {
            "name": "Gemini 2.5 Flash Lite",
            "supports_vision": True,
        },
        "deepseek/deepseek-r1": {
            "name": "DeepSeek R1",
            "supports_vision": False,
        },
        "qwen/qwen3-coder-next": {
            "name": "Qwen3 Coder Next",
            "supports_vision": False,
        },
    }

    async def generate(self, prompt, image_base64=None, model=None) -> str:
        """Generate build123d code from prompt (+ optional image)."""
        ...
```

### Claude API プロンプト設計

**システムプロンプト（要約）:**
```
あなたはbuild123dを使った3Dモデリングの専門家です。
ユーザーの要求に基づいてbuild123dのPythonコードを生成してください。

ルール:
- 変数 `result` にSolid/Part/Compound を代入すること
- 単位はmm
- from build123d import * は自動挿入される（書かないこと）
- print/ファイル出力は書かないこと
- ShopBot CNCで切り出す板材パーツを想定（基本は平面的な形状）
- コードのみ出力すること（説明不要）
```

**コード例を付与:**
- 矩形の板（基本）
- 穴あき板
- 角丸矩形
- L字型パーツ
- 複数パーツの組み合わせ

### コード実行のサンドボックス

```python
allowed_globals = {
    "__builtins__": {},  # builtins制限
    "math": math,
}
# build123d の主要クラス/関数を明示的に追加
from build123d import Box, Cylinder, Sphere, ...
allowed_globals.update({name: getattr(build123d, name) for name in ALLOWED_NAMES})

exec(generated_code, allowed_globals)
result = allowed_globals.get("result")
```

- タイムアウト: 30秒
- ファイルI/O, ネットワーク, subprocess は禁止
- エラー発生時: エラーメッセージをフロントに返す

## フロントエンド設計

### 新規ファイル

```
frontend/src/
├── nodes/
│   └── AiCadNode.tsx          # AI CADノードUI
└── components/
    ├── AiCadPanel.tsx         # サイドパネル（3D + コード + ライブラリ）
    └── CodeEditor.tsx         # build123dコードエディタ（textarea）
```

### nodeRegistryへの追加

```typescript
{
  type: 'aiCad',
  label: 'AI CAD',
  category: 'cad',
  // 入力ハンドルなし（入口ノード）
  // 出力: brepResult (BrepImportResultと同じ型)
}
```

### api.ts への追加

```typescript
export async function generateAiCad(prompt: string, imageBase64?: string, model?: string): Promise<AiCadResult>
export async function executeAiCadCode(code: string): Promise<AiCadResult>
export async function fetchAiCadModels(): Promise<ModelInfo[]>
export async function fetchAiCadLibrary(): Promise<GenerationSummary[]>
export async function loadAiCadGeneration(id: string): Promise<AiCadResult>
```

## 段階的実装計画

### Phase 1: MVP（今回のスコープ）
- AI CADノード（テキストプロンプトのみ）
- OpenRouter クライアント + モデル切替
- build123dコード生成 → 実行 → 解析
- 既存CAMパイプラインへの接続
- コード表示・手動編集・再実行
- SQLite保存（自動）
- 3Dプレビュー（既存MeshViewer再利用）

### Phase 2: 画像入力 + ライブラリUI
- 画像ドロップ入力（マルチモーダル対応モデル使用時のみ）
- ライブラリ一覧・検索・読み込みUI
- サムネイル生成

### Phase 3: 対話的改善
- チャット的な反復修正（「穴を追加して」「もう少し大きく」）
- 生成履歴表示
- テンプレートとしてのタグ付け・呼び出し

### 将来
- JSONパラメトリック生成（定型的な形状用の高速パス）
- dogbone/接合部ノード（GH資産の移植）
- 2.5D/組み立て家具対応

## 依存パッケージ追加

- **Backend:** `httpx` (既存), `openai` (OpenRouter互換SDK、オプション)
- **Frontend:** 追加なし

## テスト方針

- `test_ai_cad.py`: コード実行サンドボックスのテスト（安全性、タイムアウト、正常系）
- `test_db.py`: SQLite CRUD テスト
- `test_llm_client.py`: OpenRouter APIクライアントのテスト（モック）
- E2Eテスト: テキスト → 生成 → 下流パイプライン接続

## 設定（環境変数）

| 変数 | 必須 | デフォルト | 説明 |
|------|------|----------|------|
| `OPENROUTER_API_KEY` | Yes | — | OpenRouter APIキー |
| `AI_CAD_DEFAULT_MODEL` | No | `google/gemini-2.5-flash-lite` | デフォルトLLMモデル |
| `AI_CAD_TIMEOUT` | No | `30` | コード実行タイムアウト秒数 |
