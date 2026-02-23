# AI Thinking Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** LLMに「考えてからコードを書く」思考モードを導入し、AI CADノードの生成品質を向上させる。

**Architecture:** プロンプト誘導思考（非推論モデル）とネイティブ推論（R1, Gemini Flash等）のハイブリッド。`supports_thinking` フラグで自動切替。思考過程をUIに表示。チートシートも拡充。

**Tech Stack:** FastAPI, OpenRouter API (openai SDK), React, TypeScript

---

### Task 1: `_extract_thinking_and_code` ヘルパーの追加

**Files:**
- Modify: `backend/llm_client.py:609-614` (末尾に追加)
- Test: `backend/tests/test_llm_client.py`

**Step 1: Write the failing tests**

```python
# backend/tests/test_llm_client.py に追加

def test_extract_thinking_and_code_with_thinking_tags():
    """<thinking> tags are extracted and separated from code."""
    from llm_client import _extract_thinking_and_code
    raw = "<thinking>\nNeed a box with holes.\nUse Builder API.\n</thinking>\n```python\nresult = Box(100, 50, 10)\n```"
    thinking, code = _extract_thinking_and_code(raw)
    assert "Need a box" in thinking
    assert "Builder API" in thinking
    assert "result = Box(100, 50, 10)" in code
    assert "<thinking>" not in code


def test_extract_thinking_and_code_with_think_tags():
    """<think> tags (DeepSeek R1 format) are extracted."""
    from llm_client import _extract_thinking_and_code
    raw = "<think>\nI should use BuildPart for this.\n</think>\nresult = Cylinder(5, 10)"
    thinking, code = _extract_thinking_and_code(raw)
    assert "BuildPart" in thinking
    assert "result = Cylinder(5, 10)" in code
    assert "<think>" not in code


def test_extract_thinking_and_code_no_thinking():
    """When no thinking tags, thinking is empty and code is returned as-is."""
    from llm_client import _extract_thinking_and_code
    raw = "```python\nresult = Box(10, 10, 10)\n```"
    thinking, code = _extract_thinking_and_code(raw)
    assert thinking == ""
    assert "result = Box(10, 10, 10)" in code


def test_extract_thinking_and_code_plain_code():
    """Plain code without fences or tags."""
    from llm_client import _extract_thinking_and_code
    raw = "result = Box(10, 10, 10)"
    thinking, code = _extract_thinking_and_code(raw)
    assert thinking == ""
    assert code == "result = Box(10, 10, 10)"
```

**Step 2: Run tests to verify they fail**

Run: `cd backend && uv run python -m pytest tests/test_llm_client.py::test_extract_thinking_and_code_with_thinking_tags tests/test_llm_client.py::test_extract_thinking_and_code_with_think_tags tests/test_llm_client.py::test_extract_thinking_and_code_no_thinking tests/test_llm_client.py::test_extract_thinking_and_code_plain_code -v`
Expected: ImportError — `_extract_thinking_and_code` does not exist

**Step 3: Implement `_extract_thinking_and_code`**

Add to `backend/llm_client.py` (after `_strip_code_fences`):

```python
_THINKING_RE = re.compile(r"<think(?:ing)?>(.*?)</think(?:ing)?>", re.DOTALL)


def _extract_thinking_and_code(raw: str) -> tuple[str, str]:
    """Extract thinking section and code from LLM response.

    Handles both <thinking>...</thinking> (prompt-guided) and
    <think>...</think> (DeepSeek R1 native) formats.
    """
    thinking = ""
    match = _THINKING_RE.search(raw)
    if match:
        thinking = match.group(1).strip()
        raw = raw[:match.start()] + raw[match.end():]
    code = _strip_code_fences(raw)
    return thinking, code
```

**Step 4: Run tests to verify they pass**

Run: `cd backend && uv run python -m pytest tests/test_llm_client.py -k "extract_thinking" -v`
Expected: 4 PASSED

**Step 5: Commit**

```bash
git add backend/llm_client.py backend/tests/test_llm_client.py
git commit -m "Add _extract_thinking_and_code helper for AI thinking mode"
```

---

### Task 2: モデル定義の更新 + `_build_system_prompt` に思考指示追加

**Files:**
- Modify: `backend/llm_client.py:17-30` (AVAILABLE_MODELS), `backend/llm_client.py:32-43` (_BASE_PROMPT), `backend/llm_client.py:446-451` (_build_system_prompt)
- Test: `backend/tests/test_llm_client.py`

**Step 1: Write the failing tests**

```python
def test_available_models_supports_thinking():
    """Each model has supports_thinking flag."""
    from llm_client import AVAILABLE_MODELS
    for mid, info in AVAILABLE_MODELS.items():
        assert "supports_thinking" in info, f"{mid} missing supports_thinking"


def test_system_prompt_includes_thinking_instructions_for_non_thinking_model():
    """Non-thinking model gets THINKING MODE instructions in prompt."""
    from llm_client import _build_system_prompt
    prompt = _build_system_prompt("general", supports_thinking=False)
    assert "<thinking>" in prompt


def test_system_prompt_excludes_thinking_instructions_for_thinking_model():
    """Thinking model does NOT get THINKING MODE instructions."""
    from llm_client import _build_system_prompt
    prompt = _build_system_prompt("general", supports_thinking=True)
    assert "<thinking>" not in prompt
```

**Step 2: Run tests to verify they fail**

Run: `cd backend && uv run python -m pytest tests/test_llm_client.py -k "supports_thinking or thinking_instructions" -v`
Expected: FAIL

**Step 3: Implement changes**

Update `AVAILABLE_MODELS` in `backend/llm_client.py`:

```python
AVAILABLE_MODELS: dict[str, dict] = {
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

Add thinking instructions to `_BASE_PROMPT`:

```python
_THINKING_INSTRUCTIONS = """

THINKING MODE:
Before writing code, analyze the request inside <thinking>...</thinking> tags:
- What shapes and features are needed? List them.
- What build123d approach is best? (Builder API for patterns/holes/fillets, Algebra for simple booleans)
- What are the key dimensions and relationships?
- What pitfalls should you avoid?
Then output ONLY the Python code (no explanation) after the thinking block.
"""
```

Update `_build_system_prompt` signature to accept `supports_thinking`:

```python
def _build_system_prompt(profile: str = "general", supports_thinking: bool = False) -> str:
    """Build system prompt from base + profile cheatsheet + optional thinking instructions."""
    p = _PROFILES.get(profile)
    if p is None:
        p = _PROFILES["general"]
    prompt = _BASE_PROMPT + p["cheatsheet"]
    if not supports_thinking:
        prompt += _THINKING_INSTRUCTIONS
    return prompt
```

**Step 4: Run tests to verify they pass**

Run: `cd backend && uv run python -m pytest tests/test_llm_client.py -v`
Expected: ALL PASSED (including existing tests — update existing tests that call `_build_system_prompt()` without `supports_thinking` arg since default is `False`)

**Step 5: Commit**

```bash
git add backend/llm_client.py backend/tests/test_llm_client.py
git commit -m "Add supports_thinking flag to models and thinking instructions to prompt"
```

---

### Task 3: `generate()` と `generate_with_history()` の戻り値変更

**Files:**
- Modify: `backend/llm_client.py:475-530` (generate, generate_with_history methods)
- Test: `backend/tests/test_llm_client.py`

**Step 1: Update existing tests + add new test**

Update `test_generate_calls_openai_client` to expect tuple return:

```python
@pytest.mark.asyncio
async def test_generate_calls_openai_client():
    """Verify generate() returns (thinking, code) tuple."""
    # ... (existing mock setup, change last part:)
    thinking, code = await client.generate("Make a box 100x50x10mm")
    assert "Box(100, 50, 10)" in code
    assert isinstance(thinking, str)
```

Add test for thinking extraction:

```python
@pytest.mark.asyncio
async def test_generate_extracts_thinking():
    """generate() extracts thinking from response."""
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = (
        "<thinking>\nUse Builder API for this.\n</thinking>\n"
        "```python\nresult = Box(100, 50, 10)\n```"
    )

    mock_client = MagicMock()
    mock_client.chat = MagicMock()
    mock_client.chat.completions = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

    client = LLMClient(api_key="test-key")
    client._client = mock_client

    thinking, code = await client.generate("Make a box")
    assert "Builder API" in thinking
    assert "result = Box(100, 50, 10)" in code
```

**Step 2: Run tests to verify they fail**

Run: `cd backend && uv run python -m pytest tests/test_llm_client.py -k "generate_calls or generate_extracts" -v`
Expected: FAIL (still returns str, not tuple)

**Step 3: Update `generate()` and `generate_with_history()`**

```python
async def generate(
    self,
    prompt: str,
    image_base64: str | None = None,
    model: str | None = None,
    profile: str = "general",
) -> tuple[str, str]:
    """Generate build123d code from a text prompt (+ optional image).

    Returns (thinking, code) tuple.
    """
    use_model = model or self.default_model
    thinking_native = _model_supports_thinking(use_model)
    messages: list[dict] = [
        {"role": "system", "content": _build_system_prompt(profile, supports_thinking=thinking_native)}
    ]

    # Build user message (text or multimodal)
    if image_base64 and _model_supports_vision(use_model):
        user_content: list[dict] = [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": image_base64}},
        ]
        messages.append({"role": "user", "content": user_content})
    else:
        messages.append({"role": "user", "content": prompt})

    response = await self._client.chat.completions.create(
        model=use_model,
        messages=messages,  # type: ignore[arg-type]
    )

    raw = response.choices[0].message.content or ""
    return _extract_thinking_and_code(raw)


async def generate_with_history(
    self,
    messages: list[dict],
    model: str | None = None,
    profile: str = "general",
) -> tuple[str, str]:
    """Generate code with full conversation history.

    Returns (thinking, code) tuple.
    """
    use_model = model or self.default_model
    thinking_native = _model_supports_thinking(use_model)
    full_messages = [
        {"role": "system", "content": _build_system_prompt(profile, supports_thinking=thinking_native)}
    ] + messages

    response = await self._client.chat.completions.create(
        model=use_model,
        messages=full_messages,  # type: ignore[arg-type]
    )

    raw = response.choices[0].message.content or ""
    return _extract_thinking_and_code(raw)
```

Add `_model_supports_thinking` helper:

```python
def _model_supports_thinking(model_id: str) -> bool:
    info = AVAILABLE_MODELS.get(model_id)
    return bool(info and info.get("supports_thinking"))
```

**Step 4: Run all tests, fix existing tests that unpack str**

Run: `cd backend && uv run python -m pytest tests/test_llm_client.py -v`
Expected: ALL PASSED (update all tests that called `generate()` to unpack tuple)

**Step 5: Commit**

```bash
git add backend/llm_client.py backend/tests/test_llm_client.py
git commit -m "Change generate() return type to (thinking, code) tuple"
```

---

### Task 4: `generate_and_execute()` の変更

**Files:**
- Modify: `backend/llm_client.py:532-582` (generate_and_execute)
- Test: `backend/tests/test_llm_client.py`

**Step 1: Update existing tests**

Update `test_generate_and_execute_success_first_try`:

```python
@pytest.mark.asyncio
async def test_generate_and_execute_success_first_try():
    """generate_and_execute returns thinking along with code and objects."""
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = (
        "<thinking>\nSimple box.\n</thinking>\nresult = Box(100, 50, 10)"
    )
    # ... (mock setup same as before)

    thinking, code, objects, step_bytes = await client.generate_and_execute("Make a box")
    assert "Simple box" in thinking
    assert "Box(100, 50, 10)" in code
    assert len(objects) >= 1
```

**Step 2: Run to verify fail**

Run: `cd backend && uv run python -m pytest tests/test_llm_client.py -k "generate_and_execute" -v`
Expected: FAIL (still returns 3-tuple)

**Step 3: Update `generate_and_execute()`**

Return value changes to `tuple[str, str, list[BrepObject], bytes | None]` — (thinking, code, objects, step_bytes).

Key change: initial generation now returns `(thinking, code)` from `generate()` / `generate_with_history()`. Only the first thinking is kept (retries don't update thinking).

```python
async def generate_and_execute(
    self,
    prompt: str,
    *,
    messages: list[dict] | None = None,
    image_base64: str | None = None,
    model: str | None = None,
    max_retries: int | None = None,
    profile: str = "general",
) -> tuple[str, str, list[BrepObject], bytes | None]:
    """Generate code, execute it, retry on failure.

    Returns: (thinking, final_code, objects, step_bytes)
    """
    retries = max_retries if max_retries is not None else self.max_retries

    if messages:
        thinking, code = await self.generate_with_history(messages, model, profile=profile)
    else:
        thinking, code = await self.generate(prompt, image_base64, model, profile=profile)

    # Try execute + retry loop
    last_error: CodeExecutionError | None = None
    retry_messages = list(messages or [])
    if not retry_messages:
        retry_messages.append({"role": "user", "content": prompt})
    retry_messages.append({"role": "assistant", "content": code})

    for attempt in range(1 + retries):
        try:
            objects, step_bytes = execute_build123d_code(code)
            return thinking, code, objects, step_bytes
        except CodeExecutionError as e:
            last_error = e
            if attempt >= retries:
                break
            retry_messages.append({
                "role": "user",
                "content": (
                    f"Your code produced an error:\n{e}\n\n"
                    f"Failed code:\n```python\n{code}\n```\n\n"
                    f"Fix the code and output only the corrected version."
                ),
            })
            _, code = await self.generate_with_history(retry_messages, model, profile=profile)
            retry_messages.append({"role": "assistant", "content": code})

    raise last_error  # type: ignore[misc]
```

**Step 4: Run all tests**

Run: `cd backend && uv run python -m pytest tests/test_llm_client.py -v`
Expected: ALL PASSED

**Step 5: Commit**

```bash
git add backend/llm_client.py backend/tests/test_llm_client.py
git commit -m "Return thinking from generate_and_execute()"
```

---

### Task 5: スキーマ + APIエンドポイント更新

**Files:**
- Modify: `backend/schemas.py:447-469` (AiCadResult, ModelInfo)
- Modify: `backend/main.py:442-491` (ai_cad_generate endpoint)
- Modify: `backend/main.py:546-569` (ai_cad_load endpoint)
- Test: `backend/tests/test_api_ai_cad.py`

**Step 1: Update schemas**

`backend/schemas.py` — AiCadResult:

```python
class AiCadResult(BrepImportResult):
    """AI CAD output — extends BrepImportResult with generation metadata."""
    generated_code: str
    generation_id: str
    prompt_used: str
    model_used: str
    thinking: str = ""
```

ModelInfo:

```python
class ModelInfo(BaseModel):
    """Available LLM model info."""
    id: str
    name: str
    is_default: bool
    supports_vision: bool
    supports_thinking: bool = False
```

**Step 2: Update `list_models()` in LLMClient**

```python
def list_models(self) -> list[dict]:
    return [
        {
            "id": mid,
            "name": info["name"],
            "is_default": mid == self.default_model,
            "supports_vision": info["supports_vision"],
            "supports_thinking": info.get("supports_thinking", False),
        }
        for mid, info in AVAILABLE_MODELS.items()
    ]
```

**Step 3: Update `ai_cad_generate` endpoint**

Change the unpacking line:

```python
thinking, code, objects, step_bytes = await llm.generate_and_execute(...)
```

Add `thinking` to the AiCadResult return:

```python
return AiCadResult(
    file_id=file_id, objects=objects, object_count=len(objects),
    generated_code=code, generation_id=gen_id,
    prompt_used=req.prompt, model_used=model_used,
    thinking=thinking,
)
```

**Step 4: Update `ai_cad_load` endpoint**

Add `thinking=""` (library loads don't have thinking stored yet — could add DB column later):

```python
return AiCadResult(
    ...,
    thinking="",
)
```

**Step 5: Run full test suite**

Run: `cd backend && uv run python -m pytest tests/ -v`
Expected: ALL PASSED

**Step 6: Commit**

```bash
git add backend/schemas.py backend/main.py backend/llm_client.py
git commit -m "Add thinking field to AiCadResult and supports_thinking to ModelInfo"
```

---

### Task 6: フロントエンド型更新

**Files:**
- Modify: `frontend/src/types.ts:259-264` (AiCadResult), `frontend/src/types.ts:274-279` (ModelInfo)

**Step 1: Update TypeScript types**

```typescript
export interface AiCadResult extends BrepImportResult {
  generated_code: string;
  generation_id: string;
  prompt_used: string;
  model_used: string;
  thinking: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  is_default: boolean;
  supports_vision: boolean;
  supports_thinking: boolean;
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add frontend/src/types.ts
git commit -m "Add thinking and supports_thinking to frontend types"
```

---

### Task 7: AiCadPanel に思考過程表示

**Files:**
- Modify: `frontend/src/components/AiCadPanel.tsx`

**Step 1: Update Props and component**

Add `thinking` prop and collapsible section:

```typescript
interface Props {
  code: string;
  prompt: string;
  model: string;
  thinking: string;
  onRerun: (code: string) => void;
}

export default function AiCadPanel({ code, prompt, model, thinking, onRerun }: Props) {
  const [editedCode, setEditedCode] = useState(code);
  const [isEditing, setIsEditing] = useState(false);
  const [showThinking, setShowThinking] = useState(false);

  // ... existing handleRerun

  return (
    <div style={panelStyle}>
      <div style={metaStyle}>
        <div style={metaRow}>
          <span style={metaLabel}>Prompt:</span>
          <span>{prompt}</span>
        </div>
        <div style={metaRow}>
          <span style={metaLabel}>Model:</span>
          <span>{model}</span>
        </div>
      </div>

      {thinking && (
        <div style={thinkingSection}>
          <button
            onClick={() => setShowThinking(!showThinking)}
            style={thinkingToggle}
          >
            {showThinking ? "▼" : "▶"} Thinking
          </button>
          {showThinking && (
            <pre style={thinkingPre}>{thinking}</pre>
          )}
        </div>
      )}

      {/* ... existing code section unchanged ... */}
    </div>
  );
}
```

Add styles:

```typescript
const thinkingSection: React.CSSProperties = {
  padding: "8px 16px", borderBottom: "1px solid #f0f0f0",
};
const thinkingToggle: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  fontSize: 12, color: "#888", padding: 0, fontWeight: 600,
};
const thinkingPre: React.CSSProperties = {
  background: "#f8f8f0", padding: 12, borderRadius: 6,
  fontSize: 12, lineHeight: 1.5, margin: "8px 0 0",
  whiteSpace: "pre-wrap", color: "#555",
  maxHeight: 200, overflow: "auto",
};
```

**Step 2: Update AiCadNode to pass thinking**

Modify `frontend/src/nodes/AiCadNode.tsx:118`:

```typescript
<AiCadPanel
  code={result.generated_code}
  prompt={result.prompt_used}
  model={result.model_used}
  thinking={result.thinking || ""}
  onRerun={handleCodeRerun}
/>
```

**Step 3: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add frontend/src/components/AiCadPanel.tsx frontend/src/nodes/AiCadNode.tsx
git commit -m "Show AI thinking process in collapsible panel section"
```

---

### Task 8: モデル選択UIに思考バッジ追加

**Files:**
- Modify: `frontend/src/nodes/AiCadNode.tsx:154-166`

**Step 1: Update model selector**

```typescript
{models.length > 1 && (
  <select
    value={selectedModel}
    onChange={(e) => setSelectedModel(e.target.value)}
    style={selectStyle}
  >
    {models.map((m) => (
      <option key={m.id} value={m.id}>
        {m.name}{m.supports_thinking ? " (thinking)" : ""}
      </option>
    ))}
  </select>
)}
```

**Step 2: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add frontend/src/nodes/AiCadNode.tsx
git commit -m "Show thinking badge in model selector"
```

---

### Task 9: チートシート拡充（general プロファイル）

**Files:**
- Modify: `backend/llm_client.py:45-188` (_GENERAL_CHEATSHEET)
- Test: `backend/tests/test_llm_client.py`

**Step 1: Expand general cheatsheet**

以下を追加:
- 引数の型情報
- よくあるランタイムエラーと対処法
- 複合パターン（sketch-on-face → pocket, 穴パターン + フィレットの組み合わせ等）

具体的な追加内容:

```python
# _GENERAL_CHEATSHEET の ═══ PITFALLS の後に追加:

═══ COMMON RUNTIME ERRORS ═══

1. "Objects do not intersect" — Boolean operands must overlap
   Check dimensions and positions before subtract/intersect

2. "TopologyError" — Fillet/chamfer radius too large
   Use radius < smallest_edge_length / 2

3. "No result produced" — BuildPart context may be empty
   Ensure at least one 3D shape exists before fillet/chamfer

4. Multiple BuildSketch contexts — each must produce geometry
   Check that Circle/Rectangle/etc. is inside the with block

═══ COMPOUND PATTERNS ═══

# Pocket on top face:
with BuildPart() as bp:
    Box(200, 100, 12)
    top = bp.faces().sort_by(Axis.Z)[-1]
    with BuildSketch(top):
        RectangleRounded(80, 40, radius=5)
    extrude(amount=-4, mode=Mode.SUBTRACT)
result = bp.part

# Multiple features (holes + fillet):
with BuildPart() as bp:
    Box(200, 100, 12)
    with BuildSketch(bp.faces().sort_by(Axis.Z)[-1]):
        with GridLocations(40, 30, 4, 2):
            Circle(4)
    extrude(amount=-12, mode=Mode.SUBTRACT)
    fillet(bp.edges().group_by(Axis.Z)[-1], radius=2)
result = bp.part

# Rounded outline with holes:
with BuildPart() as bp:
    with BuildSketch():
        RectangleRounded(200, 100, radius=15)
    extrude(amount=10)
    with BuildSketch(bp.faces().sort_by(Axis.Z)[-1]):
        with Locations((50, 0), (-50, 0)):
            Circle(8)
    extrude(amount=-10, mode=Mode.SUBTRACT)
result = bp.part
```

**Step 2: Run existing cheatsheet tests**

Run: `cd backend && uv run python -m pytest tests/test_llm_client.py -v`
Expected: ALL PASSED

**Step 3: Commit**

```bash
git add backend/llm_client.py
git commit -m "Expand general cheatsheet with error patterns and compound examples"
```

---

### Task 10: 全体テスト + 最終確認

**Step 1: Run full backend test suite**

Run: `cd backend && uv run python -m pytest tests/ -v`
Expected: ALL PASSED

**Step 2: Run frontend type check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: Manual test (make dev)**

Run: `make dev`
- Flash Lite モデルでプロンプトを送信 → 思考 + コードが返ること確認
- View Code → 思考過程が折りたたみ表示されること確認
- モデル選択で "(thinking)" バッジが表示されること確認

**Step 4: Final commit (if any cleanup needed)**

```bash
git add -A
git commit -m "AI thinking mode: final cleanup"
```
