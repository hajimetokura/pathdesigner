# AI CAD 2ステージパイプライン Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** AI CADノードを2ステージパイプライン（Gemini設計 + Qwen3コード生成）に変更し、SSEでステージ進行を表示する

**Architecture:** Stage 1 (Gemini 2.5 Flash Lite) がリファレンス全文を読んで構造設計+API抽出。Stage 2 (Qwen3 Coder) がコード生成+セルフレビュー。エラー時はGemini再検索+Qwen修正の1回リトライ。フロントエンドはSSEでリアルタイムにステージ進行を表示。

**Tech Stack:** FastAPI StreamingResponse (SSE), OpenAI AsyncClient, React EventSource

---

### Task 1: パイプラインモデル定義とStage 1（設計）のテスト

**Files:**
- Modify: `backend/llm_client.py`
- Test: `backend/tests/test_llm_client.py`

**Step 1: Write the failing test — Stage 1 (design) calls Gemini with reference**

```python
# backend/tests/test_llm_client.py に追加

@pytest.mark.asyncio
async def test_design_with_context_calls_designer_model():
    """_design_with_context calls Gemini with full reference."""
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = "DESIGN: box from 6 panels\nAPPROACH: Builder API"

    mock_client = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

    client = LLMClient(api_key="test-key")
    client._client = mock_client

    result = await client._design_with_context("300x300x300の箱を板で組んで", profile="general")

    assert "DESIGN" in result or "box" in result.lower()
    call_kwargs = mock_client.chat.completions.create.call_args[1]
    assert call_kwargs["model"] == "google/gemini-2.5-flash-lite"
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner && uv run pytest backend/tests/test_llm_client.py::test_design_with_context_calls_designer_model -v`
Expected: FAIL — `_design_with_context` does not exist

**Step 3: Add PIPELINE_MODELS and implement `_design_with_context`**

```python
# backend/llm_client.py — トップレベルに追加

PIPELINE_MODELS = {
    "designer": "google/gemini-2.5-flash-lite",
    "coder": "qwen/qwen3-coder",
}
```

```python
# LLMClient クラスに追加

async def _design_with_context(
    self,
    prompt: str,
    profile: str = "general",
) -> str:
    """Stage 1: Use Gemini to analyze prompt and extract relevant API/examples."""
    designer_model = PIPELINE_MODELS["designer"]
    reference_content = _build_system_prompt(profile, include_reference=True)

    design_prompt = (
        "以下のユーザー要求を分析し、build123dで実装するための設計を出力してください。\n\n"
        f"ユーザー要求: {prompt}\n\n"
        "出力形式:\n"
        "1. DESIGN: 構造の分解（パーツ数、各サイズ、組み立て方法）\n"
        "2. APPROACH: Builder API か Algebra API か、主要な手法\n"
        "3. RELEVANT_API: この設計に必要なAPIと使い方\n"
        "4. RELEVANT_EXAMPLES: 参考になるコード例\n"
    )

    response = await self._client.chat.completions.create(
        model=designer_model,
        messages=[
            {"role": "system", "content": reference_content},
            {"role": "user", "content": design_prompt},
        ],
    )
    return response.choices[0].message.content or ""
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner && uv run pytest backend/tests/test_llm_client.py::test_design_with_context_calls_designer_model -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/llm_client.py backend/tests/test_llm_client.py
git commit -m "Add PIPELINE_MODELS and _design_with_context for Stage 1"
```

---

### Task 2: Stage 2（コード生成）のテストと実装

**Files:**
- Modify: `backend/llm_client.py`
- Test: `backend/tests/test_llm_client.py`

**Step 1: Write the failing test — Stage 2 calls Qwen3 Coder**

```python
@pytest.mark.asyncio
async def test_generate_code_calls_coder_model():
    """_generate_code calls Qwen3 Coder with design context."""
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = "result = Box(100, 100, 100)"

    mock_client = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

    client = LLMClient(api_key="test-key")
    client._client = mock_client

    design = "DESIGN: single box 100x100x100\nAPPROACH: Algebra API"
    code = await client._generate_code("100mmの立方体", design, profile="general")

    assert "Box" in code
    call_kwargs = mock_client.chat.completions.create.call_args[1]
    assert call_kwargs["model"] == "qwen/qwen3-coder"
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner && uv run pytest backend/tests/test_llm_client.py::test_generate_code_calls_coder_model -v`
Expected: FAIL

**Step 3: Implement `_generate_code`**

```python
# LLMClient クラスに追加

async def _generate_code(
    self,
    prompt: str,
    design: str,
    profile: str = "general",
) -> str:
    """Stage 2: Use Qwen3 Coder to generate build123d code from design."""
    coder_model = PIPELINE_MODELS["coder"]
    system = _build_system_prompt(profile, include_reference=False)

    user_content = (
        f"ユーザー要求: {prompt}\n\n"
        f"設計:\n{design}\n\n"
        "上記の設計に基づいてbuild123dコードを生成してください。"
    )

    response = await self._client.chat.completions.create(
        model=coder_model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_content},
        ],
    )
    raw = response.choices[0].message.content or ""
    return _strip_code_fences(raw)
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner && uv run pytest backend/tests/test_llm_client.py::test_generate_code_calls_coder_model -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/llm_client.py backend/tests/test_llm_client.py
git commit -m "Add _generate_code for Stage 2 (Qwen3 Coder)"
```

---

### Task 3: Stage 2.5（セルフレビュー）のテストと実装

**Files:**
- Modify: `backend/llm_client.py`
- Test: `backend/tests/test_llm_client.py`

**Step 1: Write the failing test — self review**

```python
@pytest.mark.asyncio
async def test_self_review_calls_coder_model():
    """_self_review sends code back to Qwen3 for review."""
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = "result = Box(100, 100, 100)"

    mock_client = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

    client = LLMClient(api_key="test-key")
    client._client = mock_client

    reviewed = await client._self_review("100mmの立方体", "result = Box(100, 100, 100)", profile="general")

    assert "Box" in reviewed
    call_kwargs = mock_client.chat.completions.create.call_args[1]
    assert call_kwargs["model"] == "qwen/qwen3-coder"
    # System message should contain review instructions
    system_msg = call_kwargs["messages"][0]["content"]
    assert "build123d" in system_msg.lower() or "review" in str(call_kwargs["messages"]).lower()
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner && uv run pytest backend/tests/test_llm_client.py::test_self_review_calls_coder_model -v`
Expected: FAIL

**Step 3: Implement `_self_review`**

```python
# LLMClient クラスに追加

async def _self_review(
    self,
    prompt: str,
    code: str,
    profile: str = "general",
) -> str:
    """Stage 2.5: Self-review generated code before execution."""
    coder_model = PIPELINE_MODELS["coder"]
    system = _build_system_prompt(profile, include_reference=False)

    review_content = (
        "以下のコードをレビューしてください:\n"
        "- ユーザー要求と一致しているか\n"
        "- build123d APIの使い方は正しいか\n"
        "- バグはないか\n"
        "問題があれば修正版のコードのみを出力。問題なければそのまま出力。\n\n"
        f"ユーザー要求: {prompt}\n\n"
        f"コード:\n```python\n{code}\n```"
    )

    response = await self._client.chat.completions.create(
        model=coder_model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": review_content},
        ],
    )
    raw = response.choices[0].message.content or ""
    return _strip_code_fences(raw)
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner && uv run pytest backend/tests/test_llm_client.py::test_self_review_calls_coder_model -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/llm_client.py backend/tests/test_llm_client.py
git commit -m "Add _self_review for Stage 2.5 (self-review before execution)"
```

---

### Task 4: generate_pipeline() — フルパイプライン統合テストと実装

**Files:**
- Modify: `backend/llm_client.py`
- Test: `backend/tests/test_llm_client.py`

**Step 1: Write the failing test — full pipeline success**

```python
@pytest.mark.asyncio
async def test_generate_pipeline_success():
    """generate_pipeline runs all stages and returns result."""
    design_response = MagicMock()
    design_response.choices = [MagicMock()]
    design_response.choices[0].message.content = "DESIGN: single box"

    code_response = MagicMock()
    code_response.choices = [MagicMock()]
    code_response.choices[0].message.content = "result = Box(100, 50, 10)"

    review_response = MagicMock()
    review_response.choices = [MagicMock()]
    review_response.choices[0].message.content = "result = Box(100, 50, 10)"

    mock_client = MagicMock()
    mock_client.chat.completions.create = AsyncMock(
        side_effect=[design_response, code_response, review_response]
    )

    client = LLMClient(api_key="test-key")
    client._client = mock_client

    stages = []
    async def on_stage(stage: str):
        stages.append(stage)

    code, objects, step_bytes = await client.generate_pipeline(
        "Make a box 100x50x10mm",
        on_stage=on_stage,
    )

    assert "Box(100, 50, 10)" in code
    assert len(objects) >= 1
    assert step_bytes is not None
    assert stages == ["designing", "coding", "reviewing", "executing"]
    assert mock_client.chat.completions.create.call_count == 3
```

**Step 2: Write the failing test — pipeline retry with Gemini re-search**

```python
@pytest.mark.asyncio
async def test_generate_pipeline_retries_with_gemini():
    """On execution error, pipeline re-queries Gemini then Qwen."""
    design_response = MagicMock()
    design_response.choices = [MagicMock()]
    design_response.choices[0].message.content = "DESIGN: box"

    bad_code_response = MagicMock()
    bad_code_response.choices = [MagicMock()]
    bad_code_response.choices[0].message.content = "x = Box(100, 50, 10)"  # missing result

    review_response = MagicMock()
    review_response.choices = [MagicMock()]
    review_response.choices[0].message.content = "x = Box(100, 50, 10)"  # still bad

    retry_design_response = MagicMock()
    retry_design_response.choices = [MagicMock()]
    retry_design_response.choices[0].message.content = "DESIGN: assign to result"

    good_code_response = MagicMock()
    good_code_response.choices = [MagicMock()]
    good_code_response.choices[0].message.content = "result = Box(100, 50, 10)"

    mock_client = MagicMock()
    mock_client.chat.completions.create = AsyncMock(
        side_effect=[
            design_response, bad_code_response, review_response,  # initial
            retry_design_response, good_code_response,  # retry
        ]
    )

    client = LLMClient(api_key="test-key")
    client._client = mock_client

    stages = []
    async def on_stage(stage: str):
        stages.append(stage)

    code, objects, step_bytes = await client.generate_pipeline(
        "Make a box",
        on_stage=on_stage,
    )

    assert "result = Box(100, 50, 10)" in code
    assert "retrying" in stages
    assert mock_client.chat.completions.create.call_count == 5
```

**Step 3: Run tests to verify they fail**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner && uv run pytest backend/tests/test_llm_client.py::test_generate_pipeline_success backend/tests/test_llm_client.py::test_generate_pipeline_retries_with_gemini -v`
Expected: FAIL

**Step 4: Implement `generate_pipeline`**

```python
# LLMClient クラスに追加
from typing import Callable, Awaitable

async def generate_pipeline(
    self,
    prompt: str,
    *,
    image_base64: str | None = None,
    profile: str = "general",
    on_stage: Callable[[str], Awaitable[None]] | None = None,
) -> tuple[str, list[BrepObject], bytes | None]:
    """Run 2-stage pipeline: Gemini design → Qwen code → review → execute → retry."""

    async def _notify(stage: str):
        if on_stage:
            await on_stage(stage)

    # Stage 1: Design with Gemini
    await _notify("designing")
    design = await self._design_with_context(prompt, profile=profile)

    # Stage 2: Generate code with Qwen
    await _notify("coding")
    code = await self._generate_code(prompt, design, profile=profile)

    # Stage 2.5: Self-review
    await _notify("reviewing")
    code = await self._self_review(prompt, code, profile=profile)

    # Execute
    await _notify("executing")
    try:
        objects, step_bytes = execute_build123d_code(code)
        return code, objects, step_bytes
    except CodeExecutionError as first_error:
        pass

    # Retry: re-query Gemini with error info, then Qwen
    await _notify("retrying")
    retry_design = await self._design_with_context(
        f"{prompt}\n\n前回のコードでエラーが発生しました:\n{first_error}\n\n"
        f"失敗したコード:\n```python\n{code}\n```\n\n"
        "エラーを修正するために必要なAPIと正しい使い方を提示してください。",
        profile=profile,
    )

    retry_code = await self._generate_code(
        f"{prompt}\n\n前回エラー: {first_error}",
        retry_design,
        profile=profile,
    )

    await _notify("executing")
    objects, step_bytes = execute_build123d_code(retry_code)
    return retry_code, objects, step_bytes
```

**Step 5: Run tests to verify they pass**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner && uv run pytest backend/tests/test_llm_client.py::test_generate_pipeline_success backend/tests/test_llm_client.py::test_generate_pipeline_retries_with_gemini -v`
Expected: PASS

**Step 6: Commit**

```bash
git add backend/llm_client.py backend/tests/test_llm_client.py
git commit -m "Add generate_pipeline with full 2-stage flow and retry"
```

---

### Task 5: SSEエンドポイント — main.py の変更

**Files:**
- Modify: `backend/main.py`
- Test: `backend/tests/test_llm_client.py` (エンドポイントテストを追加)

**Step 1: Write the failing test — SSE endpoint streams stages**

```python
# backend/tests/test_llm_client.py に追加
import json
from unittest.mock import patch, AsyncMock, MagicMock
from fastapi.testclient import TestClient

def test_ai_cad_generate_sse_streams_stages():
    """POST /ai-cad/generate returns SSE stream with stage events."""
    from main import app

    mock_objects = [MagicMock()]
    mock_objects[0].model_dump.return_value = {
        "object_id": "test-0", "file_name": "ai_generated.step",
        "bounding_box": {"x": 100, "y": 50, "z": 10},
        "thickness": 10, "origin": {"position": [0, 0, 0], "reference": "bounding_box_min", "description": ""},
        "unit": "mm", "is_closed": True, "is_planar": True,
        "machining_type": "2d", "faces_analysis": {"top_features": False, "bottom_features": False, "freeform_surfaces": False},
        "outline": [],
    }

    async def mock_pipeline(prompt, *, image_base64=None, profile="general", on_stage=None):
        if on_stage:
            await on_stage("designing")
            await on_stage("coding")
            await on_stage("reviewing")
            await on_stage("executing")
        return "result = Box(100, 50, 10)", mock_objects, b"STEP data"

    with patch("main._get_llm") as mock_get_llm, \
         patch("main._get_db") as mock_get_db:
        mock_llm = MagicMock()
        mock_llm.generate_pipeline = mock_pipeline
        mock_get_llm.return_value = mock_llm

        mock_db = AsyncMock()
        mock_db.save_generation = AsyncMock(return_value="gen-123")
        mock_get_db.return_value = mock_db

        client = TestClient(app)
        response = client.post(
            "/ai-cad/generate",
            json={"prompt": "Make a box"},
            headers={"Accept": "text/event-stream"},
        )

        assert response.status_code == 200
        text = response.text
        assert "event: stage" in text
        assert '"designing"' in text
        assert "event: result" in text
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner && uv run pytest backend/tests/test_llm_client.py::test_ai_cad_generate_sse_streams_stages -v`
Expected: FAIL (current endpoint returns JSON, not SSE)

**Step 3: Modify `/ai-cad/generate` in main.py to SSE**

`backend/main.py` の `ai_cad_generate` を変更:

```python
import asyncio
import json

@app.post("/ai-cad/generate")
async def ai_cad_generate(req: AiCadRequest):
    """Generate 3D model from text/image prompt via LLM pipeline (SSE stream)."""
    llm = _get_llm()

    async def event_stream():
        stages_seen = []

        async def on_stage(stage: str):
            stages_seen.append(stage)
            messages = {
                "designing": "設計中...",
                "coding": "コーディング中...",
                "reviewing": "レビュー中...",
                "executing": "実行中...",
                "retrying": "リトライ中...",
            }
            data = json.dumps({"stage": stage, "message": messages.get(stage, stage)})
            yield f"event: stage\ndata: {data}\n\n"

        # We need to collect yields from on_stage inside generate_pipeline.
        # Use an asyncio.Queue to bridge callback → async generator.
        stage_queue: asyncio.Queue[str | None] = asyncio.Queue()

        async def queue_stage(stage: str):
            await stage_queue.put(stage)

        result_holder: dict = {}

        async def run_pipeline():
            try:
                code, objects, step_bytes = await llm.generate_pipeline(
                    req.prompt,
                    image_base64=req.image_base64,
                    profile=req.profile,
                    on_stage=queue_stage,
                )
                result_holder["code"] = code
                result_holder["objects"] = objects
                result_holder["step_bytes"] = step_bytes
            except Exception as e:
                result_holder["error"] = str(e)
            finally:
                await stage_queue.put(None)  # sentinel

        task = asyncio.create_task(run_pipeline())

        messages = {
            "designing": "設計中...",
            "coding": "コーディング中...",
            "reviewing": "レビュー中...",
            "executing": "実行中...",
            "retrying": "リトライ中...",
        }

        while True:
            stage = await stage_queue.get()
            if stage is None:
                break
            data = json.dumps({"stage": stage, "message": messages.get(stage, stage)})
            yield f"event: stage\ndata: {data}\n\n"

        await task

        if "error" in result_holder:
            data = json.dumps({"message": result_holder["error"]})
            yield f"event: error\ndata: {data}\n\n"
            return

        code = result_holder["code"]
        objects = result_holder["objects"]
        step_bytes = result_holder["step_bytes"]

        # Save STEP + generation (same logic as before)
        db = await _get_db()
        file_id = f"ai-cad-{uuid.uuid4().hex[:8]}"
        brep_result = BrepImportResult(
            file_id=file_id, objects=objects, object_count=len(objects),
        )

        step_path = None
        if step_bytes:
            gen_dir = GENERATIONS_DIR / file_id
            gen_dir.mkdir(exist_ok=True)
            step_file = gen_dir / "model.step"
            step_file.write_bytes(step_bytes)
            step_path = str(step_file)
            (UPLOAD_DIR / f"{file_id}.step").write_bytes(step_bytes)

        gen_id = await db.save_generation(
            prompt=req.prompt, code=code,
            result_json=brep_result.model_dump_json(),
            model_used="pipeline", status="success",
            step_path=step_path,
        )

        result = AiCadResult(
            file_id=file_id, objects=objects, object_count=len(objects),
            generated_code=code, generation_id=gen_id,
            prompt_used=req.prompt, model_used="pipeline",
        )
        data = result.model_dump_json()
        yield f"event: result\ndata: {data}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner && uv run pytest backend/tests/test_llm_client.py::test_ai_cad_generate_sse_streams_stages -v`
Expected: PASS

**Step 5: Run all backend tests**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner && uv run pytest backend/tests/ -v --timeout=60`
Expected: All pass

**Step 6: Commit**

```bash
git add backend/main.py backend/tests/test_llm_client.py
git commit -m "Convert /ai-cad/generate to SSE streaming with stage progress"
```

---

### Task 6: フロントエンド — SSEクライアントと進行表示

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/nodes/AiCadNode.tsx`
- Modify: `frontend/src/types.ts`

**Step 1: api.ts — SSE版 generateAiCad を追加**

`frontend/src/api.ts` の `generateAiCad` を置き換え:

```typescript
// types.ts に追加
export type AiCadStage = "designing" | "coding" | "reviewing" | "executing" | "retrying";

export interface AiCadStageEvent {
  stage: AiCadStage;
  message: string;
}
```

```typescript
// api.ts — generateAiCad を置き換え

export async function generateAiCadStream(
  prompt: string,
  profile?: string,
  onStage?: (event: AiCadStageEvent) => void,
): Promise<AiCadResult> {
  const response = await fetch(`${API_BASE_URL}/ai-cad/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ prompt, profile }),
  });

  if (!response.ok) {
    throw new Error(`AI generation failed: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let result: AiCadResult | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    let eventType = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        const data = JSON.parse(line.slice(6));
        if (eventType === "stage" && onStage) {
          onStage(data);
        } else if (eventType === "result") {
          result = data;
        } else if (eventType === "error") {
          throw new Error(data.message);
        }
        eventType = "";
      }
    }
  }

  if (!result) throw new Error("No result received");
  return result;
}
```

**Step 2: AiCadNode.tsx — モデル選択を削除、ステージ表示を追加**

```tsx
// frontend/src/nodes/AiCadNode.tsx — 変更点

// imports: generateAiCad → generateAiCadStream, AiCadStageEvent を追加
// ModelInfo を削除

// state:
// 削除: models, selectedModel
// 追加: const [stage, setStage] = useState<string>("");

// useEffect: fetchAiCadModels() の呼び出しを削除

// handleGenerate:
const handleGenerate = useCallback(async () => {
  if (!prompt.trim()) return;
  setStatus("generating");
  setError("");
  setStage("");
  try {
    const data = await generateAiCadStream(
      prompt,
      selectedProfile || undefined,
      (evt) => setStage(evt.message),
    );
    setResult(data);
    setStatus("success");
    setStage("");
    // ... setNodes と fetchMeshData は同じ
  } catch (e) {
    setError(e instanceof Error ? e.message : "Generation failed");
    setStatus("error");
    setStage("");
  }
}, [id, prompt, selectedProfile, setNodes]);

// JSX: モデル選択 <select> を削除、ステージ表示を追加
// Generate ボタンの下に:
{status === "generating" && stage && (
  <div style={{ fontSize: 11, color: "#666", padding: "4px 0" }}>
    {stage}
  </div>
)}
```

**Step 3: api.ts — fetchAiCadModels を削除（または残しておく）**

`fetchAiCadModels` はAiCadNodeから呼ばれなくなるが、ライブラリ等で使う可能性があるので残してもよい。

**Step 4: types.ts — ModelInfo の `large_context` フィールドは既に不要だが型定義は残す**

`types.ts` に `AiCadStage` と `AiCadStageEvent` を追加。

**Step 5: 動作確認**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner && make dev`
- AI CADノードでプロンプトを入力
- 「設計中...」→「コーディング中...」→「レビュー中...」→「実行中...」が表示されるか確認
- 結果が表示されるか確認

**Step 6: Commit**

```bash
git add frontend/src/api.ts frontend/src/nodes/AiCadNode.tsx frontend/src/types.ts
git commit -m "Update frontend: SSE streaming with stage progress display"
```

---

### Task 7: 既存テスト修正と全体テスト

**Files:**
- Modify: `backend/tests/test_llm_client.py`

**Step 1: 既存の generate_and_execute テストが引き続き動くか確認**

`generate_and_execute` は残しておく（`/ai-cad/execute` で手動コード実行時に使われうる）。
パイプラインは新しい `generate_pipeline` が担う。

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner && uv run pytest backend/tests/ -v --timeout=60`

**Step 2: 壊れたテストがあれば修正**

- `test_ai_cad_generate_sse_streams_stages` がmain.pyのSSE変更で壊れていないか確認
- 既存の `test_generate_and_execute_*` はそのまま動くはず

**Step 3: Commit**

```bash
git add -A
git commit -m "Fix tests for pipeline integration"
```

---

### Task 8: `/ai-cad/models` エンドポイントの扱い

**Files:**
- Modify: `backend/main.py`

**Step 1: `/ai-cad/models` をパイプライン情報に変更**

ユーザーはモデルを選べなくなったが、デバッグ用にパイプライン構成を返すのは有用:

```python
@app.get("/ai-cad/models", response_model=list[ModelInfo])
def get_ai_cad_models():
    """Return pipeline model configuration."""
    from llm_client import PIPELINE_MODELS, AVAILABLE_MODELS
    result = []
    for role, model_id in PIPELINE_MODELS.items():
        info = AVAILABLE_MODELS.get(model_id, {})
        result.append({
            "id": model_id,
            "name": f"{role}: {info.get('name', model_id)}",
            "is_default": False,
            "supports_vision": info.get("supports_vision", False),
            "large_context": info.get("large_context", False),
        })
    return result
```

**Step 2: Commit**

```bash
git add backend/main.py
git commit -m "Update /ai-cad/models to return pipeline configuration"
```

---

### Task 9: クリーンアップとPR準備

**Files:**
- All modified files

**Step 1: 全テスト実行**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner && uv run pytest backend/tests/ -v --timeout=60`
Expected: All pass

**Step 2: フロントエンドビルド確認**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/frontend && npm run build`
Expected: Build succeeds

**Step 3: 動作確認**

Run: `make dev`
- AI CADノードで「300x300x300の18mm板で組まれた箱をつくって」を入力
- ステージ表示が正しく進行するか確認
- 結果が板1枚ではなく箱になっているか確認

**Step 4: PR作成**

```bash
gh pr create --title "AI CAD 2-stage pipeline (Gemini + Qwen3)" --body "..."
```
