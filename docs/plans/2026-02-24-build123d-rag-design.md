# build123d ドキュメント全文注入 + RAG拡張パス 設計書

**日付:** 2026-02-24
**ステータス:** 承認済み

## 目的

AI CADノードの生成品質を向上させるため、build123dの公式ドキュメント（epub）をLLMのコンテキストに注入する。手書きチートシートではカバーしきれないAPIの網羅性、複雑な造形パターン、エラー修正の質を改善する。

## 戦略: 2フェーズ

### Phase 1 (MVP): 力技 — epub全文注入

Gemini Flash Liteの100万トークンコンテキストを活用し、build123dドキュメント全体（~165,000トークン）をシステムプロンプトに注入する。

### Phase 2 (将来): RAG移行

Phase 1で生成したリファレンスファイルをチャンク分割してベクトルDB（ChromaDB等）に格納。コンテキスト枠が小さいモデルでも使えるようにする。

## アーキテクチャ

```
build123d-readthedocs-io-en-latest.epub (18MB)
  ↓ scripts/build_reference.py (前処理)
  ↓
  ├─ backend/data/build123d_api_reference.md (~80,000トークン)
  │    直接API、Builder API、オブジェクト、操作、セレクタ等
  │
  └─ backend/data/build123d_examples.md (~60,000トークン)
       チュートリアル、サンプルコード、Builder使い方
```

### epub取捨選択

**採用（APIリファレンス）:**
- `direct_api_reference.xhtml` — 全クラス・関数の詳細
- `builder_api_reference.xhtml` — Builder APIリファレンス
- `objects.xhtml`, `objects/text.xhtml` — オブジェクト型
- `operations.xhtml` — 操作一覧
- `selectors.xhtml`, `topology_selection/*.xhtml` — セレクタ
- `key_concepts*.xhtml` — コンセプト
- `joints.xhtml`, `assemblies.xhtml` — ジョイント
- `import_export.xhtml` — インポート/エクスポート
- `tips.xhtml`, `debugging_logging.xhtml` — デバッグ

**採用（コード例）:**
- `examples_1.xhtml` — サンプルコード集
- `introductory_examples.xhtml` — 入門サンプル
- `tutorial_*.xhtml` — 全チュートリアル
- `build_line.xhtml`, `build_part.xhtml`, `build_sketch.xhtml` — Builder使い方
- `cheat_sheet.xhtml` — 公式チートシート

**除外:**
- `installation.xhtml` — インストール手順
- `genindex.xhtml`, `nav.xhtml`, `py-modindex.xhtml` — 索引・ナビゲーション
- `OpenSCAD.xhtml` — OpenSCAD比較記事
- `advantages.xhtml` — 利点紹介

## LLMへの注入設計

### レイヤー構成

```
レイヤー1: _BASE_PROMPT (ルール・制約)
  "result変数必須", "mm単位", "import禁止" 等

レイヤー2: プロファイルチートシート (経験知)
  PITFALLS + 手書きPATTERNS（既存のまま維持）

レイヤー3a: build123d_examples.md (コードパターン)
  チュートリアル・サンプルから抽出

レイヤー3b: build123d_api_reference.md (APIリファレンス)
  クラス定義、メソッド一覧、パラメータ説明
```

### LLMClient変更

```python
_REFERENCE_CACHE: dict[str, str] = {}

def _load_reference_file(name: str) -> str:
    if name not in _REFERENCE_CACHE:
        path = Path(__file__).parent / "data" / name
        _REFERENCE_CACHE[name] = path.read_text() if path.exists() else ""
    return _REFERENCE_CACHE[name]

def _build_system_prompt(
    profile: str = "general",
    supports_thinking: bool = False,
    include_reference: bool = True,
) -> str:
    prompt = _BASE_PROMPT + _PROFILES[profile]["cheatsheet"]

    if include_reference:
        examples = _load_reference_file("build123d_examples.md")
        if examples:
            prompt += "\n\n═══ CODE EXAMPLES ═══\n" + examples
        api_ref = _load_reference_file("build123d_api_reference.md")
        if api_ref:
            prompt += "\n\n═══ API REFERENCE ═══\n" + api_ref

    if not supports_thinking:
        prompt += _THINKING_INSTRUCTIONS
    return prompt
```

### モデル別の自動判定

```python
AVAILABLE_MODELS = {
    "google/gemini-2.5-flash-lite": {
        "name": "Gemini 2.5 Flash Lite",
        "supports_vision": True,
        "supports_thinking": False,
        "large_context": True,       # ← 全文注入OK
    },
    "deepseek/deepseek-r1": {
        ...
        "large_context": False,      # ← チートシートのみ
    },
}
```

`large_context: True` のモデルのみリファレンス全文を注入。それ以外は既存チートシートのみ。

## リトライ時の動き

力技方式のメリット: リファレンス全文がコンテキストに残っているため、リトライ時にも追加検索不要。LLMはエラーメッセージとリファレンスの両方を参照して修正できる。

## テスト戦略

1. **前処理スクリプト** — epubパース、フィルタリング、出力生成
2. **LLMClient** — リファレンス読み込み、キャッシュ、include_referenceフラグ
3. **既存テスト互換性** — 171テストが全てパス
4. **手動検証** — 複雑なプロンプトで精度向上を確認

## ファイル構成

```
scripts/
└── build_reference.py          # epub→md 前処理スクリプト

backend/
├── data/
│   ├── build123d_api_reference.md   # 生成物: APIリファレンス
│   └── build123d_examples.md        # 生成物: コード例
├── llm_client.py                    # 変更: リファレンス読み込み+注入
└── tests/
    └── test_llm_client.py           # 変更: 新テスト追加

build123d-readthedocs-io-en-latest.epub  # ソース（既存）
```

## Phase 2 への拡張パス

Phase 1で生成した `build123d_api_reference.md` と `build123d_examples.md` は、Phase 2のRAGソースとしてそのまま使える:

1. チャンク分割 → ベクトルDB (ChromaDB + Gemini embedding-001 or ruri-v3-310m)
2. プロンプト解析 → 関連チャンク検索 (top-k=5-10)
3. `large_context: False` のモデルでもリファレンス参照可能に
