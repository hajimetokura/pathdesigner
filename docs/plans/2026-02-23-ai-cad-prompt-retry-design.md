# AI CAD: Rich Prompt + Auto-Retry Design

## Goal

Improve AI CAD code generation quality by:
1. Enriching the LLM system prompt with a build123d API cheatsheet and pitfall guide
2. Adding an automatic retry loop that feeds execution errors back to the LLM

## Current Problem

- System prompt has only 3 examples and no API reference
- LLM has no knowledge of build123d class signatures or pitfalls
- A single execution failure returns an error with no recovery

## Architecture

### System Prompt Structure

```
[Role] CNC sheet-part build123d expert
[Cheatsheet] ~40 key APIs with signatures
  - 3D Primitives: Box, Cylinder, Cone
  - 2D Sketch: Rectangle, RectangleRounded, Circle, SlotOverall,
    RegularPolygon, Polygon, Ellipse, Spline
  - Operations: extrude, fillet, chamfer, mirror
  - Placement: Pos, Rot, Locations, GridLocations, PolarLocations
  - Builder: BuildPart, BuildSketch, BuildLine, Hole
  - Boolean: - (subtract), + (add), & (intersect)
[Pitfalls] Key gotchas (default CENTER align, fillet only in Builder, etc.)
[Patterns] 4-5 examples covering common CNC part types
[Constraints] result variable required, no imports needed, no side effects
```

Target: ~1,500-2,000 tokens. Fits comfortably within cheap model context.

### Auto-Retry Loop

```
User prompt
    |
    v
LLM generates code (attempt 1)
    |
    v
execute_build123d_code()
    |--- success --> return result
    |--- failure
    v
Build retry message:
  "Your code failed: {error}. Fix it."
    |
    v
LLM generates fixed code (attempt 2)
    |
    v
execute_build123d_code()
    |--- success --> return result
    |--- failure
    v
Retry once more (attempt 3 = final)
    |--- success --> return result
    |--- failure --> return error to user
```

- Default max retries: **2** (configurable via `AI_CAD_MAX_RETRIES` env var)
- Retry applies to: `/ai-cad/generate` and `/ai-cad/chat`
- No retry for: `/ai-cad/execute` (manual code — user fixes it themselves)

### New Method: `generate_and_execute()`

Located in `llm_client.py`. Combines LLM call + execution + retry in one method.

```python
async def generate_and_execute(
    self,
    prompt: str,
    *,
    messages: list[dict] | None = None,  # for chat history
    image_base64: str | None = None,
    model: str | None = None,
    max_retries: int | None = None,  # None = use env default
) -> tuple[str, list[BrepObject], bytes | None]:
    """Generate code, execute it, retry on failure.

    Returns: (final_code, objects, step_bytes)
    Raises: CodeExecutionError after all retries exhausted
    """
```

### Retry Feedback Format

```
Your code produced an error:
{error_type}: {error_message}

Failed code:
```python
{code}
```

Fix the code and output only the corrected version.
```

## File Changes

| File | Change |
|------|--------|
| `backend/llm_client.py` | Rich system prompt + `generate_and_execute()` |
| `backend/main.py` | Endpoints call `generate_and_execute()` |
| `backend/tests/test_llm_client.py` | Retry logic tests |
| `.env` | Add `AI_CAD_MAX_RETRIES=2` |

## Not Changed

- `backend/nodes/ai_cad.py` — executor stays as-is
- `/ai-cad/execute` endpoint — no retry (manual code)
- Frontend — no changes needed (retry is backend-internal)
- Schemas — no changes

## Future: Composition with Chat (Task 13)

The retry loop is a **lower layer** that runs inside every LLM-to-execution call.
Chat iteration (Task 13) is a **user-facing layer** on top:

```
Chat history (user-driven refinement)
    |
    v
generate_and_execute() <-- retry loop runs here automatically
```

Both layers compose naturally: user says "add holes" → chat generates new code → if it fails, retry fixes it automatically.

## Configuration

```env
AI_CAD_MAX_RETRIES=2       # 0 to disable retry
AI_CAD_DEFAULT_MODEL=google/gemini-2.5-flash-lite
OPENROUTER_API_KEY=...
```
