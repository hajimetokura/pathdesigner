# AI Knowledge Flywheel — 設計ドキュメント

## 概要

AIノードの生成精度を継続的に向上させるための「ナレッジフライホイール」を構築する。
ユーザーの成功コードがDBに蓄積 → AIのfew-shot examplesが増加 → 生成精度が向上 → さらに良いコードが蓄積、という好循環を作る。

## 全体アーキテクチャ

```
Phase A: HITL Chat     Phase B: Snippet DB     Phase C: AI強化     Phase D: Code Node
┌──────────────┐      ┌──────────────┐       ┌──────────────┐    ┌──────────────┐
│ AIノード生成   │      │ 名前+タグで   │       │ タグベース    │    │ 手動コーディング│
│   ↓           │      │ DBに保存     │       │ スニペット検索 │    │ build123d補完 │
│ チャットで修正  │─────→│              │──────→│ few-shot注入  │    │   ↓           │
│   ↓           │      │ ライブラリ   │       │              │    │ DBに保存可    │
│ 「適用」で確定 │      │ 閲覧パネル   │       │              │    │              │
└──────────────┘      └──────────────┘       └──────────────┘    └──────────────┘
```

## フェーズ構成

| Phase | 内容 | 依存 |
|-------|------|------|
| A | HITLチャットパネル | なし（既存AIノード拡張） |
| B | スニペットDB + 保存ノード | Phase A（保存対象のコードが必要） |
| C | DB参照 + AI few-shot注入 | Phase B（DBにスニペットが蓄積されている必要） |
| D | Codeノード（手動エディタ） | Phase B（保存先DBが必要） |

---

## Phase A: HITLチャットパネル（優先実装）

### バックエンド

#### 新規エンドポイント

```
POST /ai-cad/refine (SSEストリーミング)
```

**リクエスト:**
```json
{
  "generation_id": "abc123def456",
  "message": "角をR5で丸めて",
  "history": [
    {"role": "assistant", "content": "Box(100,80,30)のコードを生成しました"},
    {"role": "user", "content": "角をR5で丸めて"}
  ],
  "current_code": "from build123d import *\nresult = Box(100,80,30)"
}
```

**SSEレスポンス:**
- `event: stage` → `{"message": "修正中..."}`
- `event: stage` → `{"message": "実行中..."}`
- `event: result` → `{"code": "...", "objects": [...], "ai_message": "フィレットを追加しました", "file_id": "..."}`
- `event: error` → `{"message": "エラー内容"}`

**処理フロー:**
1. `current_code` + `history` + `message` を Qwen に `generate_with_history()` で送信
2. 修正されたコードを `execute_build123d_code()` で実行
3. 実行エラー時: エラーメッセージ込みで自動リトライ（1回）
4. 成功時: `generations` テーブルのコード・結果を更新、会話履歴を保存

**設計判断:**
- Gemini→Qwen 2段階パイプラインは使わない（リファインではデザイン段階不要）
- Qwen直接呼び出しで低レイテンシ

#### DBスキーマ変更

```sql
ALTER TABLE generations ADD COLUMN conversation_history TEXT;
-- JSON配列: [{"role": "user"|"assistant", "content": "..."}, ...]
```

### フロントエンド

#### 新規コンポーネント: AiCadChatPanel

既存のサイドパネルタブ機構に「Chat」タブを追加。

```
┌─────────────────────────────┐
│  [Code] [3D] [Chat]        │  ← タブ切替
├─────────────────────────────┤
│ ┌─ Chat History ──────────┐ │
│ │ 🤖 生成完了              │ │
│ │   ▶ コード表示           │ │  ← 折りたたみ
│ │                          │ │
│ │ 👤 角をR5で丸めて        │ │
│ │                          │ │
│ │ 🤖 フィレット追加しました │ │
│ │   ▶ コード表示           │ │
│ │                          │ │
│ │ 🤖 修正中...             │ │  ← ストリーミング
│ └──────────────────────────┘ │
├─────────────────────────────┤
│ [修正指示を入力...]    [送信] │
├─────────────────────────────┤
│ [💾 保存] [適用]            │
└─────────────────────────────┘
```

**状態管理:**
```typescript
interface ChatMessage {
  role: "user" | "assistant";
  content: string;          // テキストメッセージ
  code?: string;            // AIが返したコード（折りたたみ表示）
  result?: AiCadResult;     // 実行結果（あれば）
}

// AiCadNode内の状態
const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
const [isRefining, setIsRefining] = useState(false);
```

**UI詳細:**
- チャット履歴: スクロール可能、自動スクロール
- AIメッセージ内コード: 折りたたみ（`<details>`相当）、シンタックスハイライト
- 入力: Enter送信、Shift+Enter改行
- 「適用」ボタン: 最新の成功結果をAIノードのdataに反映 → 3Dプレビュー更新 → 下流ノード伝播
- 「保存」ボタン: Phase Aでは既存のlibraryに保存（Phase Bで拡張）

#### API追加

```typescript
// api.ts に追加
refineAiCadStream(
  generationId: string,
  message: string,
  history: ChatMessage[],
  currentCode: string,
  onStage?: (msg: string) => void
): Promise<RefineResult>
```

### テスト方針

- バックエンド: `/ai-cad/refine` のSSEストリーミングテスト（LLMモック）
- バックエンド: 会話履歴のDB保存・復元テスト
- フロントエンド: チャットパネルのレンダリング・インタラクションテスト（必要に応じて）

---

## Phase B: スニペットDB + 保存（将来）

### 新規テーブル

```sql
CREATE TABLE snippets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  tags TEXT,                    -- JSON配列: ["box", "fillet", "pocket"]
  code TEXT NOT NULL,
  parameters TEXT,              -- JSON: 可変パラメータ情報
  source_generation_id TEXT,    -- generationsテーブルへの参照
  object_summary TEXT,          -- 生成物の概要（寸法等）
  created_at TEXT,
  updated_at TEXT
);
```

### 保存フロー

チャットで改善完了 → 「DBに保存」→ 名前・タグ入力ダイアログ → snippetsに保存

### ライブラリパネル

- タグフィルタ + テキスト検索
- コードプレビュー + 3Dサムネイル
- 「フローに挿入」ボタン

---

## Phase C: AI参照強化（将来）

### few-shot注入の仕組み

1. ユーザーがAIノードでプロンプト入力
2. プロンプトからキーワード抽出（or タグ推定）
3. snippetsテーブルからマッチするスニペットを検索（上位3-5件）
4. LLMプロンプトに「ユーザーの過去の成功例」セクションとして注入

```
## ユーザーの過去の成功コード（参考にしてください）

### 例1: 角丸ボックス (tags: box, fillet)
```python
result = fillet(Box(100,80,30), radius=5)
```

### 例2: L字ブラケット (tags: bracket, extrude)
...
```

### チャットリファイン時も同様

修正指示に関連するスニペットがあれば、コンテキストとして注入。

---

## Phase D: Codeノード（将来）

### エディタ

- CodeMirror 6 ベース（軽量）
- Python基本構文ハイライト
- build123d API補完辞書（`build123d_api_reference.md` から生成）
- 括弧補完・インデント

### ノード設計

```
┌─────────────────┐
│   Code Node     │
│ ┌─────────────┐ │
│ │ Editor      │ │
│ │ (CodeMirror)│ │
│ └─────────────┘ │
│ [▶ 実行] [💾保存]│
│                 │
│ ○ geometry-out  │ ← Operationノードに接続可能
└─────────────────┘
```

### 出力

- `execute_build123d_code()` で実行
- 出力型: geometry（BrepImportResult互換）
- Operationノード、Placementノード等に接続可能

---

## 成功指標

- Phase A: AIノードで生成 → チャットで3ターン以内に望む形状に到達できる
- Phase B: 保存したスニペットが10個以上蓄積
- Phase C: AIの初回生成がスニペットなしより明らかに精度向上
- Phase D: 手動コードからCAMパイプラインに直結できる
