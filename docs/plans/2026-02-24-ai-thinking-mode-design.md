# AI Thinking Mode — 設計ドキュメント

## 概要

AI CADノードの生成品質を向上させるため、LLMに「考えてからコードを書く」思考モードを導入する。
全モデルで利用可能なプロンプト誘導思考と、推論モデルのネイティブ思考を統合したハイブリッド設計。

## 背景

- 現状は1ショットでコード出力のみ指示 → 複雑な形状で精度が低い
- DeepSeek R1は利用可能だがレスポンスが遅くタイムアウトしていた
- より高速な推論モデル（Gemini 2.5 Flash）が利用可能になった

## 設計

### 2つの思考モード

| | prompt-guided thinking | native reasoning |
|---|---|---|
| 対象モデル | 非推論モデル（Gemini Flash Lite等） | 推論モデル（R1, Gemini 2.5 Flash） |
| 仕組み | プロンプトで `<thinking>` + コード出力を指示 | モデル内蔵の推論機能 |
| 思考の取得 | レスポンス本文をパース | `<think>` タグ or reasoning フィールド |
| 速度 | 1回のAPI呼び出し（やや長め） | モデル依存 |

`supports_thinking` フラグで自動切替。

### モデル定義の拡張

```python
AVAILABLE_MODELS = {
    "google/gemini-2.5-flash-lite": {
        "name": "Gemini 2.5 Flash Lite",
        "supports_vision": True,
        "supports_thinking": False,
    },
    "google/gemini-2.5-flash": {
        "name": "Gemini 2.5 Flash",
        "supports_vision": True,
        "supports_thinking": True,
    },
    "deepseek/deepseek-r1-0528": {
        "name": "DeepSeek R1",
        "supports_vision": False,
        "supports_thinking": True,
    },
}
```

### プロンプト変更

非推論モデル向けに `_BASE_PROMPT` に思考指示を追加:

```
THINKING MODE:
First, analyze the request inside <thinking>...</thinking> tags:
- What shapes/features are needed?
- What build123d approach fits best (Builder vs Algebra)?
- What are potential pitfalls?
Then output only the Python code after the thinking block.
```

推論モデル（`supports_thinking: True`）にはこの指示を付けない。

### レスポンスパース

```python
def _extract_thinking_and_code(raw: str) -> tuple[str, str]:
    """レスポンスから思考とコードを分離."""
    thinking = ""
    # <think> (DeepSeek R1形式) or <thinking> (プロンプト誘導形式)
    for tag in ("think", "thinking"):
        pattern = rf"<{tag}>(.*?)</{tag}>"
        match = re.search(pattern, raw, re.DOTALL)
        if match:
            thinking = match.group(1).strip()
            raw = raw[:match.start()] + raw[match.end():]
            break
    code = _strip_code_fences(raw)
    return thinking, code
```

### スキーマ変更

**Backend (schemas.py):**
```python
class AiCadResult(BrepImportResult):
    generated_code: str
    generation_id: str
    prompt_used: str
    model_used: str
    thinking: str = ""  # NEW
```

**Frontend (types.ts):**
```typescript
export interface AiCadResult extends BrepImportResult {
  generated_code: string;
  generation_id: string;
  prompt_used: string;
  model_used: string;
  thinking: string;  // NEW
}

export interface ModelInfo {
  id: string;
  name: string;
  is_default: boolean;
  supports_vision: boolean;
  supports_thinking: boolean;  // NEW
}
```

### LLMClient メソッド変更

`generate()`, `generate_with_history()` の戻り値:
- 変更前: `str` (code)
- 変更後: `tuple[str, str]` (thinking, code)

`generate_and_execute()` の戻り値:
- 変更前: `tuple[str, list[BrepObject], bytes | None]`
- 変更後: `tuple[str, str, list[BrepObject], bytes | None]` (thinking, code, objects, step_bytes)

### チートシート拡充

`general` プロファイルを中心に以下を追加:
- 引数の型・デフォルト値の明記
- よくあるエラー（TopologyError等）と対処法
- 複合パターン（sketch on face → pocket 等）

### フロントエンド UI

**AiCadPanel:** 思考過程を折りたたみ表示
- `thinking` が空なら非表示
- デフォルト折りたたみ

**モデル選択:** `supports_thinking` に応じたバッジ表示

### APIエンドポイント

`POST /ai-cad/generate` レスポンスに `thinking` フィールド追加。後方互換。

## テスト方針

- `_extract_thinking_and_code()` のユニットテスト（各タグ形式）
- `generate()` のモック: 思考付きレスポンスの処理
- プロンプト構築テスト: thinking指示の有無
- E2E: 実際のAPI呼び出し（手動テスト）
