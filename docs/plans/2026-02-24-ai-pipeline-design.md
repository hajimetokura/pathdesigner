# AI CAD 2ステージパイプライン設計

## 概要

AI CADノードのコード生成を、単一モデル方式から2ステージパイプラインに変更する。
Gemini（大コンテキスト）で設計+API検索し、Qwen3 Coder（コード特化）でコード生成する。

## 背景・課題

- 現在: 単一モデルにプロンプト→コード生成。複雑な指示（「板で組んだ箱」等）を正しく解釈できない
- 原因: チートシートだけでは情報不足。リファレンス全文(670KB)は小コンテキストモデルに入らない

## アーキテクチャ

```
ユーザープロンプト + プロファイル(general/2d)
         │
         ▼
┌────────────────────────────────────┐
│ Stage 1: Gemini 2.5 Flash Lite    │  1Mコンテキスト
│ - リファレンス全文 + プロンプト      │  $0.10/$0.40 per 1M tokens
│ - 構造設計 + 関連API/例の抽出       │
└──────────────┬─────────────────────┘
               │ 設計テキスト（コードではない）
               ▼
┌────────────────────────────────────┐
│ Stage 2: Qwen3 Coder              │  262Kコンテキスト
│ - チートシート + 設計 + プロンプト   │  $0.22/$1.00 per 1M tokens
│ - build123d コード生成              │
└──────────────┬─────────────────────┘
               │ コード
               ▼
┌────────────────────────────────────┐
│ Stage 2.5: Qwen3 Coder            │
│ - セルフレビュー                    │
│ - 「バグはないか？要求と合っているか？」│
│ - 修正版コードを出力                 │
└──────────────┬─────────────────────┘
               │ レビュー済みコード
               ▼
         execute_build123d_code()
               │
          エラー? ──→ NO → 完了
               │
              YES
               ▼
┌────────────────────────────────────┐
│ Retry Stage A: Gemini              │
│ - エラー内容 + 元プロンプトで       │
│ - 関連APIを再検索                   │
└──────────────┬─────────────────────┘
               ▼
┌────────────────────────────────────┐
│ Retry Stage B: Qwen3 Coder        │
│ - エラー情報 + 新コンテキストで修正  │
└──────────────┬─────────────────────┘
               ▼
         execute → 完了 or 最終エラー
```

## モデル構成

```python
PIPELINE_MODELS = {
    "designer": "google/gemini-2.5-flash-lite",
    "coder": "qwen/qwen3-coder",
}
```

- ユーザーにはモデル選択UIを見せない
- パイプライン内部で固定割り当て

## API呼び出し回数

| シナリオ | 呼び出し回数 |
|---------|------------|
| 正常（セルフレビュー含む） | 3回 (Gemini + Qwen x2) |
| リトライ1回 | 5回 (+ Gemini再検索 + Qwen修正) |

## コスト概算（1回の生成）

- Stage 1: ~170Kトークン入力 + ~1K出力 ≈ $0.02
- Stage 2 + 2.5: ~5K入力 + ~1K出力 ≈ $0.003
- 合計: 約$0.02/回（リトライ時 ~$0.04）

## SSE進行表示

`POST /ai-cad/generate` を SSE ストリームに変更:

```
← event: stage
← data: {"stage": "designing", "message": "設計中..."}

← event: stage
← data: {"stage": "coding", "message": "コーディング中..."}

← event: stage
← data: {"stage": "reviewing", "message": "レビュー中..."}

← event: stage
← data: {"stage": "executing", "message": "実行中..."}

← event: result
← data: {AiCadResult JSON}

(リトライ時)
← event: stage
← data: {"stage": "retrying", "message": "リトライ中...", "attempt": 1}

(エラー時)
← event: error
← data: {"message": "..."}
```

## フロントエンド変更

### 削除
- モデル選択ドロップダウン
- `/ai-cad/models` API呼び出し

### 残す
- プロファイル選択（general / 2d）
- プロンプト入力

### 追加
- SSEベースのステージ進行表示
- ステージごとのインジケーター

## バックエンド変更

### llm_client.py
- `generate_pipeline()` メソッド追加
- `_design_with_context()` — Stage 1 (Gemini)
- `_generate_code()` — Stage 2 (Qwen)
- `_self_review()` — Stage 2.5 (Qwen)
- `_retry_with_context()` — Retry (Gemini再検索 + Qwen修正)
- `on_stage` コールバックでステージ通知

### main.py
- `/ai-cad/generate` を `StreamingResponse` (SSE) に変更
- `/ai-cad/models` エンドポイント削除（またはパイプライン情報を返すように変更）

### Stage 1 プロンプト（Gemini用）

```
以下のユーザー要求を分析し、build123dで実装するための設計を出力してください。

ユーザー要求: {prompt}

出力形式:
1. DESIGN: 構造の分解（パーツ数、各サイズ、組み立て方法）
2. APPROACH: Builder API か Algebra API か、主要な手法
3. RELEVANT_API: この設計に必要なAPIと使い方
4. RELEVANT_EXAMPLES: 参考になるコード例
```

### Stage 2.5 プロンプト（セルフレビュー用）

```
以下のコードをレビューしてください:
- ユーザー要求と一致しているか
- build123d APIの使い方は正しいか
- バグはないか
問題があれば修正版を出力。問題なければそのまま出力。

ユーザー要求: {prompt}
コード:
{code}
```
