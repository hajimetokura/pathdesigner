# AI CAD Rich Prompt + Auto-Retry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve AI CAD code generation quality with a build123d API cheatsheet in the system prompt and an automatic retry loop on execution failure.

**Architecture:** Replace the minimal system prompt with a comprehensive build123d cheatsheet (~1,500 tokens). Add `generate_and_execute()` method to `LLMClient` that wraps LLM call + `execute_build123d_code()` + retry (max 2, configurable). Endpoints delegate to this new method.

**Tech Stack:** Python, FastAPI, openai SDK, build123d

**Design doc:** `docs/plans/2026-02-23-ai-cad-prompt-retry-design.md`

---

## Task 1: Replace system prompt with rich cheatsheet

**Files:**
- Modify: `backend/llm_client.py:29-61`

**Step 1: Replace `_SYSTEM_PROMPT` with the enriched version**

Replace lines 29-61 of `backend/llm_client.py` (the `_SYSTEM_PROMPT` variable) with:

```python
_SYSTEM_PROMPT = """\
You are a build123d expert generating Python code for CNC sheet parts.

RULES:
- Assign final shape to variable `result` (Solid, Part, or Compound)
- Units: millimeters (mm)
- `from build123d import *` is pre-loaded — do NOT write import statements
- No print(), file I/O, or side effects
- Output ONLY code, no explanations

═══ build123d CHEATSHEET ═══

3D PRIMITIVES (center-aligned by default):
  Box(length, width, height)
  Cylinder(radius, height)
  Cone(bottom_radius, top_radius, height)

2D SKETCH SHAPES (use inside BuildSketch):
  Rectangle(width, height)
  RectangleRounded(width, height, radius)
  Circle(radius)
  Ellipse(x_radius, y_radius)
  RegularPolygon(radius, side_count)
  Polygon(*pts)              # Polygon((0,0), (10,0), (10,5), (0,5))
  SlotOverall(width, height) # stadium/oblong slot
  Spline(*pts)               # smooth curve through points

OPERATIONS:
  extrude(to_extrude, amount)     # sketch → solid
  fillet(objects, radius)          # ONLY inside BuildPart
  chamfer(objects, length)         # ONLY inside BuildPart
  mirror(about=Plane.YZ)

BOOLEAN (Algebra API):
  plate - hole      # subtract
  part1 + part2     # union
  a & b             # intersect

PLACEMENT:
  Pos(x, y, z) * shape     # translate
  Rot(0, 0, 45) * shape    # rotate (degrees)
  Pos(...) * Rot(...) * shape

PATTERNS (inside BuildPart/BuildSketch):
  Locations((x1,y1), (x2,y2), ...)
  GridLocations(x_spacing, y_spacing, x_count, y_count)
  PolarLocations(radius, count)

BUILDER API:
  with BuildPart() as bp:
      Box(200, 100, 6)
      with GridLocations(50, 30, 3, 2):
          Hole(radius, depth)   # auto-subtract
      result = bp.part

═══ PITFALLS — READ CAREFULLY ═══

1. DEFAULT ALIGNMENT IS CENTER — Box(100, 50, 10) spans -50..50, -25..25, -5..5
   Use align=(Align.MIN, Align.MIN, Align.MIN) to place at origin corner

2. FILLET/CHAMFER — ONLY work inside BuildPart context, NOT on Algebra shapes
   WRONG: box.fillet(...)
   RIGHT: with BuildPart() as bp: Box(...); fillet(bp.edges(), radius=3)

3. SKETCH NEEDS EXTRUDE — BuildSketch result is not a solid
   WRONG: result = sk.sketch
   RIGHT: result = extrude(sk.sketch, amount=6)

4. Cylinder height = Box height for clean boolean — if Box height=10, use Cylinder(r, 10)

5. For holes in Algebra API, use Cylinder subtract:
   plate = Box(100, 50, 10) - Pos(20, 0, 0) * Cylinder(5, 10)

═══ PATTERNS ═══

# Simple plate with holes (Algebra — preferred for simple parts):
plate = Box(200, 100, 6)
for x, y in [(30, 20), (170, 20), (30, 80), (170, 80)]:
    plate = plate - Pos(x - 100, y - 50, 0) * Cylinder(4, 6)
result = plate

# Plate with hole pattern (Builder — for repeated patterns):
with BuildPart() as bp:
    Box(200, 100, 6)
    with GridLocations(50, 30, 3, 2):
        Hole(4, 6)
result = bp.part

# Rounded rectangle plate (Sketch + extrude):
with BuildSketch() as sk:
    RectangleRounded(200, 100, radius=10)
    with Locations((50, 0)):
        Circle(15, mode=Mode.SUBTRACT)
result = extrude(sk.sketch, amount=6)

# Curved outline (Spline + extrude):
with BuildSketch() as sk:
    with BuildLine():
        Spline((0, 0), (50, 30), (100, 20), (150, 40), (200, 0))
        Line((200, 0), (200, -50))
        Line((200, -50), (0, -50))
        Line((0, -50), (0, 0))
    make_face()
result = extrude(sk.sketch, amount=6)

# Pocket (partial-depth cut):
with BuildPart() as bp:
    Box(200, 100, 12)
    top = bp.faces().sort_by(Axis.Z)[-1]
    with BuildSketch(top):
        with Locations((0, 0)):
            RectangleRounded(80, 40, radius=5)
    extrude(amount=-4, mode=Mode.SUBTRACT)
result = bp.part
"""
```

**Step 2: Run existing tests to verify no breakage**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run python -m pytest tests/test_llm_client.py -v`
Expected: All 5 tests PASS (prompt content changed but tests check `build123d` in messages, which still matches)

**Step 3: Commit**

```bash
git add backend/llm_client.py
git commit -m "Enrich system prompt with build123d API cheatsheet and pitfall guide"
```

---

## Task 2: Add `generate_and_execute()` method with retry loop

**Files:**
- Modify: `backend/llm_client.py`
- Modify: `backend/nodes/ai_cad.py` (import only)

**Step 1: Add import of executor at top of `llm_client.py`**

Add after the existing imports (after `from openai import AsyncOpenAI`):

```python
from nodes.ai_cad import execute_build123d_code, CodeExecutionError
from schemas import BrepObject
```

**Step 2: Add `max_retries` to `__init__`**

In `LLMClient.__init__`, add after `self.default_model = ...`:

```python
        self.max_retries = int(os.environ.get("AI_CAD_MAX_RETRIES", "2"))
```

**Step 3: Add `generate_and_execute()` method**

Add after the `generate_with_history()` method (before `list_models()`):

```python
    async def generate_and_execute(
        self,
        prompt: str,
        *,
        messages: list[dict] | None = None,
        image_base64: str | None = None,
        model: str | None = None,
        max_retries: int | None = None,
    ) -> tuple[str, list[BrepObject], bytes | None]:
        """Generate code, execute it, retry on failure.

        Returns: (final_code, objects, step_bytes)
        Raises: CodeExecutionError after all retries exhausted
        """
        retries = max_retries if max_retries is not None else self.max_retries

        # Initial generation
        if messages:
            code = await self.generate_with_history(messages, model)
        else:
            code = await self.generate(prompt, image_base64, model)

        # Try execute + retry loop
        last_error: CodeExecutionError | None = None
        retry_messages = list(messages or [])
        if not retry_messages:
            retry_messages.append({"role": "user", "content": prompt})
        retry_messages.append({"role": "assistant", "content": code})

        for attempt in range(1 + retries):
            try:
                objects, step_bytes = execute_build123d_code(code)
                return code, objects, step_bytes
            except CodeExecutionError as e:
                last_error = e
                if attempt >= retries:
                    break
                # Build retry feedback
                retry_messages.append({
                    "role": "user",
                    "content": (
                        f"Your code produced an error:\n{e}\n\n"
                        f"Failed code:\n```python\n{code}\n```\n\n"
                        f"Fix the code and output only the corrected version."
                    ),
                })
                code = await self.generate_with_history(retry_messages, model)
                retry_messages.append({"role": "assistant", "content": code})

        raise last_error  # type: ignore[misc]
```

**Step 4: Run existing tests**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run python -m pytest tests/test_llm_client.py tests/test_ai_cad.py -v`
Expected: All tests still PASS

**Step 5: Commit**

```bash
git add backend/llm_client.py
git commit -m "Add generate_and_execute() with auto-retry loop (max 2, configurable)"
```

---

## Task 3: Add tests for retry logic

**Files:**
- Modify: `backend/tests/test_llm_client.py`

**Step 1: Add retry tests**

Append to `backend/tests/test_llm_client.py`:

```python
from nodes.ai_cad import CodeExecutionError


@pytest.mark.asyncio
async def test_generate_and_execute_success_first_try():
    """generate_and_execute returns on first successful execution."""
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = "result = Box(100, 50, 10)"

    mock_client = MagicMock()
    mock_client.chat = MagicMock()
    mock_client.chat.completions = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

    client = LLMClient(api_key="test-key")
    client._client = mock_client

    code, objects, step_bytes = await client.generate_and_execute("Make a box")

    assert "Box(100, 50, 10)" in code
    assert len(objects) >= 1
    assert step_bytes is not None
    # LLM should only be called once (no retry needed)
    assert mock_client.chat.completions.create.call_count == 1


@pytest.mark.asyncio
async def test_generate_and_execute_retries_on_failure():
    """generate_and_execute retries when execution fails, then succeeds."""
    bad_response = MagicMock()
    bad_response.choices = [MagicMock()]
    bad_response.choices[0].message.content = "x = Box(10, 10, 10)"  # missing result

    good_response = MagicMock()
    good_response.choices = [MagicMock()]
    good_response.choices[0].message.content = "result = Box(10, 10, 10)"

    mock_client = MagicMock()
    mock_client.chat = MagicMock()
    mock_client.chat.completions = MagicMock()
    mock_client.chat.completions.create = AsyncMock(
        side_effect=[bad_response, good_response]
    )

    client = LLMClient(api_key="test-key")
    client._client = mock_client

    code, objects, step_bytes = await client.generate_and_execute("Make a box")

    assert "result = Box(10, 10, 10)" in code
    assert len(objects) >= 1
    # LLM called twice: initial + 1 retry
    assert mock_client.chat.completions.create.call_count == 2


@pytest.mark.asyncio
async def test_generate_and_execute_exhausts_retries():
    """generate_and_execute raises after exhausting retries."""
    bad_response = MagicMock()
    bad_response.choices = [MagicMock()]
    bad_response.choices[0].message.content = "x = 42"  # always bad

    mock_client = MagicMock()
    mock_client.chat = MagicMock()
    mock_client.chat.completions = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=bad_response)

    client = LLMClient(api_key="test-key")
    client._client = mock_client
    client.max_retries = 2

    with pytest.raises(CodeExecutionError):
        await client.generate_and_execute("Make a box")

    # initial + 2 retries = 3 calls
    assert mock_client.chat.completions.create.call_count == 3


@pytest.mark.asyncio
async def test_generate_and_execute_zero_retries():
    """With max_retries=0, no retry is attempted."""
    bad_response = MagicMock()
    bad_response.choices = [MagicMock()]
    bad_response.choices[0].message.content = "x = 42"

    mock_client = MagicMock()
    mock_client.chat = MagicMock()
    mock_client.chat.completions = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=bad_response)

    client = LLMClient(api_key="test-key")
    client._client = mock_client

    with pytest.raises(CodeExecutionError):
        await client.generate_and_execute("Make a box", max_retries=0)

    assert mock_client.chat.completions.create.call_count == 1
```

**Step 2: Run tests**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run python -m pytest tests/test_llm_client.py -v`
Expected: All 9 tests PASS (5 existing + 4 new)

**Step 3: Commit**

```bash
git add backend/tests/test_llm_client.py
git commit -m "Add tests for generate_and_execute retry logic"
```

---

## Task 4: Wire endpoints to `generate_and_execute()`

**Files:**
- Modify: `backend/main.py:436-489`

**Step 1: Simplify `/ai-cad/generate` endpoint**

Replace the `ai_cad_generate` function (lines 436-489) with:

```python
@app.post("/ai-cad/generate", response_model=AiCadResult)
async def ai_cad_generate(req: AiCadRequest):
    """Generate 3D model from text/image prompt via LLM."""
    llm = _get_llm()
    db = await _get_db()
    model_used = req.model or llm.default_model

    try:
        code, objects, step_bytes = await llm.generate_and_execute(
            req.prompt,
            image_base64=req.image_base64,
            model=req.model,
        )
    except CodeExecutionError as e:
        await db.save_generation(
            prompt=req.prompt, code="(failed)", result_json=None,
            model_used=model_used, status="error", error_message=str(e),
        )
        raise HTTPException(status_code=422, detail=f"Code execution failed: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM generation failed: {e}")

    # Save STEP + generation
    file_id = f"ai-cad-{uuid.uuid4().hex[:8]}"
    result = BrepImportResult(
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
        result_json=result.model_dump_json(),
        model_used=model_used, status="success",
        step_path=step_path,
    )

    return AiCadResult(
        file_id=file_id, objects=objects, object_count=len(objects),
        generated_code=code, generation_id=gen_id,
        prompt_used=req.prompt, model_used=model_used,
    )
```

Note: `/ai-cad/execute` stays unchanged (no retry for manual code).

**Step 2: Run API tests**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run python -m pytest tests/test_api_ai_cad.py -v`
Expected: All tests PASS

**Step 3: Run full test suite**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run python -m pytest -v`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add backend/main.py
git commit -m "Wire /ai-cad/generate to generate_and_execute() with auto-retry"
```

---

## Task 5: Add `AI_CAD_MAX_RETRIES` to .env + verify

**Files:**
- Modify: `.env`

**Step 1: Add retry config to .env**

Add this line to `.env`:

```
AI_CAD_MAX_RETRIES=2
```

**Step 2: Run full test suite one final time**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run python -m pytest -v`
Expected: All tests PASS (including 4 new retry tests)

**Step 3: Verify frontend build is unaffected**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/frontend && npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add backend/main.py backend/llm_client.py backend/tests/test_llm_client.py docs/plans/2026-02-23-ai-cad-prompt-retry-design.md
git commit -m "AI CAD: rich prompt + auto-retry complete (max 2 retries, configurable)"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Rich system prompt with build123d cheatsheet | `llm_client.py` |
| 2 | `generate_and_execute()` method with retry loop | `llm_client.py` |
| 3 | Tests for retry logic (4 tests) | `tests/test_llm_client.py` |
| 4 | Wire `/ai-cad/generate` endpoint | `main.py` |
| 5 | Config + final verification | `.env` |
