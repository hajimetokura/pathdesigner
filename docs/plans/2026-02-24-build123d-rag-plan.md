# build123d ドキュメント全文注入 実装計画

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** build123dの公式ドキュメント（epub）をパース・フィルタリングし、Gemini Flash Liteの100万トークンコンテキストに全文注入することで、AI CADノードの生成品質を向上させる。

**Architecture:** epub前処理スクリプトで2つのMDファイル（APIリファレンス + コード例）を生成。LLMClientの`_build_system_prompt`を拡張し、`large_context`フラグを持つモデル（Flash Lite）でのみ全文注入を行う。既存チートシートは維持。

**Tech Stack:** Python (zipfile, html.parser), FastAPI, OpenRouter API (openai SDK)

---

### Task 1: epub前処理スクリプトの作成

**Files:**
- Create: `scripts/build_reference.py`

**Step 1: スクリプトを作成**

```python
#!/usr/bin/env python3
"""Parse build123d epub and generate reference files for LLM context injection.

Usage:
    python scripts/build_reference.py

Input:  build123d-readthedocs-io-en-latest.epub (project root)
Output: backend/data/build123d_api_reference.md
        backend/data/build123d_examples.md
"""

import html.parser
import re
import zipfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
EPUB_PATH = PROJECT_ROOT / "build123d-readthedocs-io-en-latest.epub"
DATA_DIR = PROJECT_ROOT / "backend" / "data"

# Files for API reference (classes, methods, parameters)
API_REFERENCE_FILES = [
    "direct_api_reference.xhtml",
    "builder_api_reference.xhtml",
    "objects.xhtml",
    "objects/text.xhtml",
    "operations.xhtml",
    "selectors.xhtml",
    "topology_selection.xhtml",
    "topology_selection/filter_examples.xhtml",
    "topology_selection/group_examples.xhtml",
    "topology_selection/sort_examples.xhtml",
    "key_concepts.xhtml",
    "key_concepts_algebra.xhtml",
    "key_concepts_builder.xhtml",
    "joints.xhtml",
    "assemblies.xhtml",
    "import_export.xhtml",
    "tips.xhtml",
    "debugging_logging.xhtml",
    "algebra_definition.xhtml",
    "algebra_performance.xhtml",
    "location_arithmetic.xhtml",
    "moving_objects.xhtml",
]

# Files for code examples (tutorials, samples, builder guides)
EXAMPLES_FILES = [
    "examples_1.xhtml",
    "introductory_examples.xhtml",
    "build_line.xhtml",
    "build_part.xhtml",
    "build_sketch.xhtml",
    "cheat_sheet.xhtml",
    "tutorial_design.xhtml",
    "tutorial_joints.xhtml",
    "tutorial_lego.xhtml",
    "tutorial_selectors.xhtml",
    "tutorial_spitfire_wing_gordon.xhtml",
    "tutorial_surface_heart_token.xhtml",
    "tutorial_surface_modeling.xhtml",
    "introduction.xhtml",
    "tttt.xhtml",
]

# Excluded files (not in either list)
# installation.xhtml, genindex.xhtml, nav.xhtml, py-modindex.xhtml,
# OpenSCAD.xhtml, advantages.xhtml, index.xhtml, advanced.xhtml,
# center.xhtml, external.xhtml, tutorials.xhtml, builders.xhtml


class HTMLToMarkdown(html.parser.HTMLParser):
    """Simple HTML to Markdown converter preserving code blocks and headers."""

    def __init__(self):
        super().__init__()
        self.output: list[str] = []
        self._tag_stack: list[str] = []
        self._in_code = False
        self._in_pre = False
        self._code_lang = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._tag_stack.append(tag)
        attr_dict = dict(attrs)
        classes = (attr_dict.get("class") or "").split()

        if tag == "pre":
            self._in_pre = True
        elif tag == "code":
            if self._in_pre:
                self._in_code = True
                # Detect language from class
                for c in classes:
                    if c.startswith("language-") or c.startswith("highlight-"):
                        self._code_lang = c.split("-", 1)[1]
                        break
                self.output.append(f"\n```{self._code_lang}\n")
            else:
                self.output.append("`")
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            level = int(tag[1])
            self.output.append(f"\n{'#' * level} ")
        elif tag == "li":
            self.output.append("\n- ")
        elif tag == "p":
            self.output.append("\n\n")
        elif tag == "br":
            self.output.append("\n")
        elif tag == "dt":
            self.output.append("\n\n**")
        elif tag == "dd":
            self.output.append("\n  ")
        elif tag in ("strong", "b"):
            self.output.append("**")
        elif tag in ("em", "i"):
            self.output.append("*")

    def handle_endtag(self, tag: str) -> None:
        if self._tag_stack and self._tag_stack[-1] == tag:
            self._tag_stack.pop()

        if tag == "pre":
            self._in_pre = False
        elif tag == "code":
            if self._in_code:
                self._in_code = False
                self.output.append("\n```\n")
                self._code_lang = ""
            else:
                self.output.append("`")
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.output.append("\n")
        elif tag == "dt":
            self.output.append("**")
        elif tag in ("strong", "b"):
            self.output.append("**")
        elif tag in ("em", "i"):
            self.output.append("*")

    def handle_data(self, data: str) -> None:
        if self._in_code:
            self.output.append(data)
        else:
            # Collapse whitespace for non-code text
            text = re.sub(r"\s+", " ", data)
            self.output.append(text)

    def get_markdown(self) -> str:
        result = "".join(self.output)
        # Clean up excessive newlines
        result = re.sub(r"\n{3,}", "\n\n", result)
        return result.strip()


def extract_file(z: zipfile.ZipFile, filename: str) -> str | None:
    """Extract and convert a single xhtml file to markdown."""
    # Try exact match first, then search for suffix match
    for name in z.namelist():
        if name == filename or name.endswith("/" + filename):
            content = z.read(name).decode("utf-8", errors="ignore")
            parser = HTMLToMarkdown()
            parser.feed(content)
            return parser.get_markdown()
    return None


def build_reference_files() -> tuple[str, str]:
    """Build the two reference files from the epub."""
    with zipfile.ZipFile(EPUB_PATH, "r") as z:
        # Build API reference
        api_sections: list[str] = []
        for fname in API_REFERENCE_FILES:
            md = extract_file(z, fname)
            if md:
                section_name = fname.replace(".xhtml", "").replace("/", " - ")
                api_sections.append(f"<!-- source: {section_name} -->\n\n{md}")

        # Build examples
        examples_sections: list[str] = []
        for fname in EXAMPLES_FILES:
            md = extract_file(z, fname)
            if md:
                section_name = fname.replace(".xhtml", "").replace("/", " - ")
                examples_sections.append(f"<!-- source: {section_name} -->\n\n{md}")

    api_reference = "\n\n---\n\n".join(api_sections)
    examples = "\n\n---\n\n".join(examples_sections)
    return api_reference, examples


def main() -> None:
    if not EPUB_PATH.exists():
        print(f"ERROR: epub not found at {EPUB_PATH}")
        return

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    print("Parsing epub...")
    api_reference, examples = build_reference_files()

    api_path = DATA_DIR / "build123d_api_reference.md"
    api_path.write_text(api_reference)
    api_chars = len(api_reference)
    print(f"  API reference: {api_chars:,} chars (~{api_chars // 4:,} tokens) → {api_path}")

    examples_path = DATA_DIR / "build123d_examples.md"
    examples_path.write_text(examples)
    ex_chars = len(examples)
    print(f"  Code examples: {ex_chars:,} chars (~{ex_chars // 4:,} tokens) → {examples_path}")

    total = api_chars + ex_chars
    print(f"  Total: {total:,} chars (~{total // 4:,} tokens)")
    print("Done!")


if __name__ == "__main__":
    main()
```

**Step 2: スクリプトを実行してMDファイルを生成**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner && python scripts/build_reference.py`
Expected: `backend/data/build123d_api_reference.md` と `backend/data/build123d_examples.md` が生成される

**Step 3: 生成されたファイルの品質確認**

Run: `wc -l backend/data/build123d_api_reference.md backend/data/build123d_examples.md`
Expected: 両ファイルにコンテンツがある（0行ではない）

Run: `head -50 backend/data/build123d_api_reference.md` — APIクラスの記述があること確認
Run: `head -50 backend/data/build123d_examples.md` — コードブロックがあること確認
Run: `grep -c '```' backend/data/build123d_examples.md` — コードブロックが複数存在すること

**Step 4: .gitignore に生成ファイルを追加**

`backend/data/build123d_api_reference.md` と `backend/data/build123d_examples.md` はepubから再生成可能なので `.gitignore` に追加:

```
# Generated reference files (regenerate with: python scripts/build_reference.py)
backend/data/build123d_api_reference.md
backend/data/build123d_examples.md
```

**Step 5: コミット**

```bash
git add scripts/build_reference.py .gitignore
git commit -m "Add epub-to-markdown reference generation script"
```

---

### Task 2: LLMClient にリファレンス読み込み機能を追加

**Files:**
- Modify: `backend/llm_client.py:7-10` (imports)
- Modify: `backend/llm_client.py:446-451` (_build_system_prompt)
- Test: `backend/tests/test_llm_client.py`

**Step 1: テストを書く**

`backend/tests/test_llm_client.py` に追加:

```python
def test_load_reference_file_returns_content(tmp_path):
    """_load_reference_file reads content from file."""
    from llm_client import _load_reference_file, _REFERENCE_CACHE
    # Clear cache
    _REFERENCE_CACHE.clear()
    ref_file = tmp_path / "test_ref.md"
    ref_file.write_text("# Test Reference\nSome API content")
    content = _load_reference_file(str(ref_file))
    assert "Test Reference" in content
    assert "Some API content" in content
    _REFERENCE_CACHE.clear()


def test_load_reference_file_caches(tmp_path):
    """_load_reference_file caches content after first read."""
    from llm_client import _load_reference_file, _REFERENCE_CACHE
    _REFERENCE_CACHE.clear()
    ref_file = tmp_path / "cached_ref.md"
    ref_file.write_text("original content")
    content1 = _load_reference_file(str(ref_file))
    ref_file.write_text("modified content")
    content2 = _load_reference_file(str(ref_file))
    assert content1 == content2  # cached, not re-read
    _REFERENCE_CACHE.clear()


def test_load_reference_file_missing_returns_empty():
    """_load_reference_file returns empty string for missing file."""
    from llm_client import _load_reference_file, _REFERENCE_CACHE
    _REFERENCE_CACHE.clear()
    content = _load_reference_file("/nonexistent/path/missing.md")
    assert content == ""
    _REFERENCE_CACHE.clear()


def test_build_system_prompt_with_reference(tmp_path):
    """_build_system_prompt includes reference content when include_reference=True."""
    from llm_client import _build_system_prompt, _REFERENCE_CACHE, _REF_PATHS
    _REFERENCE_CACHE.clear()
    # Create temp reference files
    api_ref = tmp_path / "build123d_api_reference.md"
    api_ref.write_text("# API Reference\nBox(length, width, height)")
    examples = tmp_path / "build123d_examples.md"
    examples.write_text("# Examples\nresult = Box(10, 10, 10)")
    # Temporarily override reference paths
    original_paths = _REF_PATHS.copy()
    _REF_PATHS["api_reference"] = str(api_ref)
    _REF_PATHS["examples"] = str(examples)
    try:
        prompt = _build_system_prompt("general", include_reference=True)
        assert "API Reference" in prompt
        assert "Examples" in prompt
        assert "CODE EXAMPLES" in prompt
        assert "API REFERENCE" in prompt
    finally:
        _REF_PATHS.update(original_paths)
        _REFERENCE_CACHE.clear()


def test_build_system_prompt_without_reference():
    """_build_system_prompt excludes reference when include_reference=False."""
    from llm_client import _build_system_prompt
    prompt = _build_system_prompt("general", include_reference=False)
    assert "CODE EXAMPLES" not in prompt
    assert "API REFERENCE" not in prompt
    # But cheatsheet should still be there
    assert "CHEATSHEET" in prompt
```

**Step 2: テストが失敗することを確認**

Run: `cd backend && uv run python -m pytest tests/test_llm_client.py -k "load_reference or with_reference or without_reference" -v`
Expected: FAIL — `_load_reference_file`, `_REFERENCE_CACHE`, `_REF_PATHS` が存在しない

**Step 3: 実装**

`backend/llm_client.py` に以下を追加:

imports セクション (L7-10) に `from pathlib import Path` を追加。

`_build_system_prompt` の前（L444あたり）に:

```python
_DATA_DIR = Path(__file__).parent / "data"

_REF_PATHS: dict[str, str] = {
    "api_reference": str(_DATA_DIR / "build123d_api_reference.md"),
    "examples": str(_DATA_DIR / "build123d_examples.md"),
}

_REFERENCE_CACHE: dict[str, str] = {}


def _load_reference_file(path: str) -> str:
    """Load a reference file with caching. Returns empty string if missing."""
    if path not in _REFERENCE_CACHE:
        p = Path(path)
        _REFERENCE_CACHE[path] = p.read_text() if p.exists() else ""
    return _REFERENCE_CACHE[path]
```

`_build_system_prompt` を更新:

```python
def _build_system_prompt(
    profile: str = "general",
    include_reference: bool = False,
) -> str:
    """Build system prompt from base + profile cheatsheet + optional full reference."""
    p = _PROFILES.get(profile)
    if p is None:
        p = _PROFILES["general"]
    prompt = _BASE_PROMPT + p["cheatsheet"]

    if include_reference:
        examples = _load_reference_file(_REF_PATHS["examples"])
        if examples:
            prompt += "\n\n═══ CODE EXAMPLES ═══\n" + examples
        api_ref = _load_reference_file(_REF_PATHS["api_reference"])
        if api_ref:
            prompt += "\n\n═══ API REFERENCE ═══\n" + api_ref

    return prompt
```

**Step 4: テストがパスすることを確認**

Run: `cd backend && uv run python -m pytest tests/test_llm_client.py -v`
Expected: ALL PASSED（既存テストも含めて）

**Step 5: コミット**

```bash
git add backend/llm_client.py backend/tests/test_llm_client.py
git commit -m "Add reference file loading and include_reference param to system prompt"
```

---

### Task 3: AVAILABLE_MODELS に `large_context` フラグ追加

**Files:**
- Modify: `backend/llm_client.py:17-30` (AVAILABLE_MODELS)
- Modify: `backend/llm_client.py:591-601` (list_models)
- Modify: `backend/schemas.py` (ModelInfo)
- Test: `backend/tests/test_llm_client.py`

**Step 1: テストを書く**

```python
def test_available_models_have_large_context():
    """Each model has large_context flag."""
    for mid, info in AVAILABLE_MODELS.items():
        assert "large_context" in info, f"{mid} missing large_context"


def test_flash_lite_is_large_context():
    """Gemini Flash Lite has large_context=True."""
    assert AVAILABLE_MODELS["google/gemini-2.5-flash-lite"]["large_context"] is True


def test_list_models_includes_large_context():
    """list_models() output includes large_context field."""
    client = LLMClient(api_key="test-key")
    models = client.list_models()
    for m in models:
        assert "large_context" in m
```

**Step 2: テストが失敗することを確認**

Run: `cd backend && uv run python -m pytest tests/test_llm_client.py -k "large_context" -v`
Expected: FAIL

**Step 3: 実装**

`AVAILABLE_MODELS` (L17-30) を更新:

```python
AVAILABLE_MODELS: dict[str, dict] = {
    "google/gemini-2.5-flash-lite": {
        "name": "Gemini 2.5 Flash Lite",
        "supports_vision": True,
        "large_context": True,
    },
    "deepseek/deepseek-r1": {
        "name": "DeepSeek R1",
        "supports_vision": False,
        "large_context": False,
    },
    "qwen/qwen3-coder-next": {
        "name": "Qwen3 Coder Next",
        "supports_vision": False,
        "large_context": False,
    },
}
```

`list_models()` (L591-601) を更新:

```python
def list_models(self) -> list[dict]:
    """Return available models with metadata."""
    return [
        {
            "id": mid,
            "name": info["name"],
            "is_default": mid == self.default_model,
            "supports_vision": info["supports_vision"],
            "large_context": info.get("large_context", False),
        }
        for mid, info in AVAILABLE_MODELS.items()
    ]
```

`backend/schemas.py` の `ModelInfo` に追加:

```python
class ModelInfo(BaseModel):
    """Available LLM model info."""
    id: str
    name: str
    is_default: bool
    supports_vision: bool
    large_context: bool = False
```

**Step 4: テストがパスすることを確認**

Run: `cd backend && uv run python -m pytest tests/test_llm_client.py -v`
Expected: ALL PASSED

**Step 5: コミット**

```bash
git add backend/llm_client.py backend/tests/test_llm_client.py backend/schemas.py
git commit -m "Add large_context flag to models for reference injection control"
```

---

### Task 4: `generate()` と `generate_with_history()` でモデル別リファレンス注入

**Files:**
- Modify: `backend/llm_client.py:475-530` (generate, generate_with_history)
- Test: `backend/tests/test_llm_client.py`

**Step 1: テストを書く**

```python
def test_model_has_large_context_helper():
    """_model_has_large_context returns correct values."""
    from llm_client import _model_has_large_context
    assert _model_has_large_context("google/gemini-2.5-flash-lite") is True
    assert _model_has_large_context("deepseek/deepseek-r1") is False
    assert _model_has_large_context("unknown/model") is False


@pytest.mark.asyncio
async def test_generate_includes_reference_for_large_context_model(tmp_path):
    """generate() includes reference for large_context models."""
    from llm_client import _REFERENCE_CACHE, _REF_PATHS
    _REFERENCE_CACHE.clear()
    # Create temp reference files
    api_ref = tmp_path / "build123d_api_reference.md"
    api_ref.write_text("UNIQUE_API_MARKER_12345")
    examples = tmp_path / "build123d_examples.md"
    examples.write_text("UNIQUE_EXAMPLES_MARKER_67890")
    original_paths = _REF_PATHS.copy()
    _REF_PATHS["api_reference"] = str(api_ref)
    _REF_PATHS["examples"] = str(examples)

    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = "result = Box(10, 10, 10)"

    mock_client = MagicMock()
    mock_client.chat = MagicMock()
    mock_client.chat.completions = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

    client = LLMClient(api_key="test-key")
    client._client = mock_client

    try:
        # Flash Lite is large_context=True
        await client.generate("box", model="google/gemini-2.5-flash-lite")
        call_kwargs = mock_client.chat.completions.create.call_args[1]
        system_msg = call_kwargs["messages"][0]["content"]
        assert "UNIQUE_API_MARKER_12345" in system_msg
        assert "UNIQUE_EXAMPLES_MARKER_67890" in system_msg
    finally:
        _REF_PATHS.update(original_paths)
        _REFERENCE_CACHE.clear()


@pytest.mark.asyncio
async def test_generate_excludes_reference_for_small_context_model(tmp_path):
    """generate() excludes reference for non-large_context models."""
    from llm_client import _REFERENCE_CACHE, _REF_PATHS
    _REFERENCE_CACHE.clear()
    api_ref = tmp_path / "build123d_api_reference.md"
    api_ref.write_text("UNIQUE_API_MARKER_12345")
    examples = tmp_path / "build123d_examples.md"
    examples.write_text("UNIQUE_EXAMPLES_MARKER_67890")
    original_paths = _REF_PATHS.copy()
    _REF_PATHS["api_reference"] = str(api_ref)
    _REF_PATHS["examples"] = str(examples)

    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = "result = Box(10, 10, 10)"

    mock_client = MagicMock()
    mock_client.chat = MagicMock()
    mock_client.chat.completions = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

    client = LLMClient(api_key="test-key")
    client._client = mock_client

    try:
        # DeepSeek R1 is large_context=False
        await client.generate("box", model="deepseek/deepseek-r1")
        call_kwargs = mock_client.chat.completions.create.call_args[1]
        system_msg = call_kwargs["messages"][0]["content"]
        assert "UNIQUE_API_MARKER_12345" not in system_msg
        assert "UNIQUE_EXAMPLES_MARKER_67890" not in system_msg
    finally:
        _REF_PATHS.update(original_paths)
        _REFERENCE_CACHE.clear()
```

**Step 2: テストが失敗することを確認**

Run: `cd backend && uv run python -m pytest tests/test_llm_client.py -k "large_context_model or _model_has_large" -v`
Expected: FAIL

**Step 3: 実装**

ヘルパー関数を追加（`_model_supports_vision` の近くに）:

```python
def _model_has_large_context(model_id: str) -> bool:
    info = AVAILABLE_MODELS.get(model_id)
    return bool(info and info.get("large_context"))
```

`generate()` の L487 を変更:

```python
# Before:
messages: list[dict] = [{"role": "system", "content": _build_system_prompt(profile)}]

# After:
use_reference = _model_has_large_context(use_model)
messages: list[dict] = [
    {"role": "system", "content": _build_system_prompt(profile, include_reference=use_reference)}
]
```

`generate_with_history()` の L522 を変更:

```python
# Before:
full_messages = [{"role": "system", "content": _build_system_prompt(profile)}] + messages

# After:
use_reference = _model_has_large_context(use_model)
full_messages = [
    {"role": "system", "content": _build_system_prompt(profile, include_reference=use_reference)}
] + messages
```

**Step 4: テストがパスすることを確認**

Run: `cd backend && uv run python -m pytest tests/test_llm_client.py -v`
Expected: ALL PASSED

**Step 5: コミット**

```bash
git add backend/llm_client.py backend/tests/test_llm_client.py
git commit -m "Inject full reference into system prompt for large-context models"
```

---

### Task 5: フロントエンド型更新

**Files:**
- Modify: `frontend/src/types.ts` (ModelInfo)

**Step 1: ModelInfo に `large_context` を追加**

`frontend/src/types.ts` の `ModelInfo` インターフェースに追加:

```typescript
export interface ModelInfo {
  id: string;
  name: string;
  is_default: boolean;
  supports_vision: boolean;
  large_context: boolean;
}
```

**Step 2: モデルセレクタにバッジ追加（任意）**

`frontend/src/nodes/AiCadNode.tsx` のモデル選択で、`large_context` モデルに "(full docs)" 表示:

```typescript
{models.map((m) => (
  <option key={m.id} value={m.id}>
    {m.name}{m.large_context ? " (full docs)" : ""}
  </option>
))}
```

**Step 3: TypeScriptコンパイル確認**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 4: コミット**

```bash
git add frontend/src/types.ts frontend/src/nodes/AiCadNode.tsx
git commit -m "Add large_context badge to model selector UI"
```

---

### Task 6: 全体テスト + 品質確認

**Step 1: バックエンド全テスト実行**

Run: `cd backend && uv run python -m pytest tests/ -v`
Expected: ALL PASSED

**Step 2: フロントエンド型チェック**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: 生成されたリファレンスの内容品質チェック**

Run:
```bash
# コードブロックが保持されているか
grep -c '```' backend/data/build123d_examples.md

# 主要APIが含まれているか
grep -c 'Box\|Cylinder\|BuildPart\|BuildSketch\|extrude\|fillet\|revolve\|loft\|sweep' backend/data/build123d_api_reference.md

# トークン数見積もり
wc -c backend/data/build123d_api_reference.md backend/data/build123d_examples.md
```
Expected: コードブロック10+、主要API 50+ヒット

**Step 4: コミット（必要な場合のみ）**

```bash
git add -A
git commit -m "build123d full document injection: complete implementation"
```
