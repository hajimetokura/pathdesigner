# AI CAD Node Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an AI CAD node that generates 3D models from text/image prompts via OpenRouter LLMs, with persistent storage and chat-based iteration.

**Architecture:** New "AI CAD" entry-point node outputs `BrepImportResult` (same type as BREP Import), connecting directly to existing CAM pipeline. Backend uses OpenRouter (OpenAI-compatible) to call cheap coding LLMs (Gemini Flash Lite / DeepSeek R1 / Qwen3 Coder Next). Generated build123d code runs in a sandboxed `exec()`. All generations saved to SQLite + file storage.

**Tech Stack:** FastAPI, OpenRouter API (httpx), SQLite (aiosqlite), build123d, React + React Flow, TypeScript

**Design doc:** `docs/plans/2026-02-23-ai-cad-node-design.md`

---

## Phase 1: Backend MVP — LLM Client + Code Executor + DB

### Task 1: Add dependencies

**Files:**
- Modify: `backend/pyproject.toml`

**Step 1: Add openai and aiosqlite packages**

```toml
dependencies = [
    "build123d>=0.10.0",
    "fastapi>=0.129.0",
    "openai>=1.0.0",
    "aiosqlite>=0.21.0",
    "python-multipart>=0.0.22",
    "pyyaml>=6.0.3",
    "shapely>=2.1.2",
    "uvicorn[standard]>=0.41.0",
]
```

`openai` SDK is used because OpenRouter provides an OpenAI-compatible API. `aiosqlite` for async SQLite.

**Step 2: Install**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv sync`
Expected: packages install successfully

**Step 3: Commit**

```bash
git add backend/pyproject.toml backend/uv.lock
git commit -m "Add openai and aiosqlite dependencies for AI CAD node"
```

---

### Task 2: OpenRouter LLM Client

**Files:**
- Create: `backend/llm_client.py`
- Create: `backend/tests/test_llm_client.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_llm_client.py
"""Tests for OpenRouter LLM client."""

import os
from unittest.mock import AsyncMock, patch, MagicMock

import pytest

# Ensure backend path
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from llm_client import LLMClient, AVAILABLE_MODELS


def test_available_models_has_entries():
    assert len(AVAILABLE_MODELS) >= 3


def test_default_model_exists():
    client = LLMClient(api_key="test-key")
    assert client.default_model in AVAILABLE_MODELS


@pytest.mark.asyncio
async def test_generate_calls_openai_client():
    """Verify generate() calls the OpenAI-compatible API correctly."""
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = 'result = Box(100, 50, 10)'

    mock_client = MagicMock()
    mock_client.chat = MagicMock()
    mock_client.chat.completions = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

    client = LLMClient(api_key="test-key")
    client._client = mock_client

    code = await client.generate("Make a box 100x50x10mm")

    assert "Box(100, 50, 10)" in code
    mock_client.chat.completions.create.assert_called_once()
    call_kwargs = mock_client.chat.completions.create.call_args[1]
    assert call_kwargs["model"] is not None
    assert any("build123d" in str(m) for m in call_kwargs["messages"])


@pytest.mark.asyncio
async def test_generate_with_model_override():
    """Verify model parameter is passed through."""
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = 'result = Cylinder(5, 10)'

    mock_client = MagicMock()
    mock_client.chat = MagicMock()
    mock_client.chat.completions = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

    client = LLMClient(api_key="test-key")
    client._client = mock_client

    await client.generate("Make a cylinder", model="deepseek/deepseek-r1")

    call_kwargs = mock_client.chat.completions.create.call_args[1]
    assert call_kwargs["model"] == "deepseek/deepseek-r1"


@pytest.mark.asyncio
async def test_generate_strips_markdown_fences():
    """If LLM wraps code in ```python ... ```, strip it."""
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = '```python\nresult = Box(10, 10, 10)\n```'

    mock_client = MagicMock()
    mock_client.chat = MagicMock()
    mock_client.chat.completions = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

    client = LLMClient(api_key="test-key")
    client._client = mock_client

    code = await client.generate("box")
    assert "```" not in code
    assert "result = Box(10, 10, 10)" in code
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run python -m pytest tests/test_llm_client.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'llm_client'`

**Step 3: Write minimal implementation**

```python
# backend/llm_client.py
"""OpenRouter LLM client for AI CAD code generation.

Uses the OpenAI-compatible API via the `openai` SDK.
Supports multiple models switchable at runtime.
"""

from __future__ import annotations

import os
import re

from openai import AsyncOpenAI

AVAILABLE_MODELS: dict[str, dict] = {
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

_SYSTEM_PROMPT = """\
You are a build123d 3D modeling expert. Generate Python code using the build123d library.

Rules:
- Assign the final Solid/Part/Compound to a variable called `result`
- Units are millimeters (mm)
- `from build123d import *` is auto-inserted — do NOT write any import statements
- Do NOT write print(), file I/O, or any side effects
- Target: flat sheet parts for CNC cutting (primarily planar shapes)
- Output ONLY the code, no explanations

Example — simple box:
result = Box(100, 50, 10)

Example — box with hole:
box = Box(100, 50, 10)
hole = Pos(30, 0, 0) * Cylinder(10, 10)
result = box - hole

Example — L-shaped part:
from build123d import *
with BuildPart() as p:
    with BuildSketch():
        with BuildLine():
            l1 = Line((0,0), (100,0))
            l2 = Line((100,0), (100,30))
            l3 = Line((100,30), (40,30))
            l4 = Line((40,30), (40,60))
            l5 = Line((40,60), (0,60))
            l6 = Line((0,60), (0,0))
        make_face()
    extrude(amount=10)
result = p.part
"""

_CODE_FENCE_RE = re.compile(r"```(?:python)?\s*\n?(.*?)\n?\s*```", re.DOTALL)


class LLMClient:
    """OpenRouter API client with model switching."""

    def __init__(
        self,
        api_key: str | None = None,
        default_model: str | None = None,
    ):
        key = api_key or os.environ.get("OPENROUTER_API_KEY", "")
        self.default_model = default_model or os.environ.get(
            "AI_CAD_DEFAULT_MODEL", "google/gemini-2.5-flash-lite"
        )
        self._client = AsyncOpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=key,
            default_headers={"HTTP-Referer": "https://pathdesigner.local"},
        )

    async def generate(
        self,
        prompt: str,
        image_base64: str | None = None,
        model: str | None = None,
    ) -> str:
        """Generate build123d code from a text prompt (+ optional image).

        Returns the raw Python code string (no fences).
        """
        use_model = model or self.default_model
        messages: list[dict] = [{"role": "system", "content": _SYSTEM_PROMPT}]

        # Build user message (text or multimodal)
        if image_base64 and _model_supports_vision(use_model):
            user_content: list[dict] = [
                {"type": "text", "text": prompt},
                {
                    "type": "image_url",
                    "image_url": {"url": image_base64},
                },
            ]
            messages.append({"role": "user", "content": user_content})
        else:
            messages.append({"role": "user", "content": prompt})

        response = await self._client.chat.completions.create(
            model=use_model,
            messages=messages,
        )

        raw = response.choices[0].message.content or ""
        return _strip_code_fences(raw)

    def list_models(self) -> list[dict]:
        """Return available models with metadata."""
        return [
            {
                "id": mid,
                "name": info["name"],
                "is_default": mid == self.default_model,
                "supports_vision": info["supports_vision"],
            }
            for mid, info in AVAILABLE_MODELS.items()
        ]


def _model_supports_vision(model_id: str) -> bool:
    info = AVAILABLE_MODELS.get(model_id)
    return bool(info and info.get("supports_vision"))


def _strip_code_fences(text: str) -> str:
    """Remove markdown code fences if present."""
    match = _CODE_FENCE_RE.search(text)
    if match:
        return match.group(1).strip()
    return text.strip()
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run python -m pytest tests/test_llm_client.py -v`
Expected: All 5 tests PASS

Note: `pytest-asyncio` is needed. If not installed:
Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv add --dev pytest-asyncio`

**Step 5: Commit**

```bash
git add backend/llm_client.py backend/tests/test_llm_client.py
git commit -m "Add OpenRouter LLM client with model switching and code fence stripping"
```

---

### Task 3: build123d Code Executor (Sandbox)

**Files:**
- Create: `backend/nodes/ai_cad.py`
- Create: `backend/tests/test_ai_cad.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_ai_cad.py
"""Tests for AI CAD code execution sandbox."""

import pytest

from nodes.ai_cad import execute_build123d_code, CodeExecutionError


def test_simple_box():
    """Execute simple box code and get BrepObject list."""
    code = "result = Box(100, 50, 10)"
    objects, step_bytes = execute_build123d_code(code)
    assert len(objects) >= 1
    obj = objects[0]
    assert abs(obj.bounding_box.x - 100) < 0.1
    assert abs(obj.bounding_box.y - 50) < 0.1
    assert abs(obj.bounding_box.z - 10) < 0.1
    assert step_bytes is not None
    assert len(step_bytes) > 100  # STEP file has content


def test_box_with_hole():
    """Execute code with boolean subtraction."""
    code = """\
box = Box(100, 50, 10)
hole = Pos(30, 0, 0) * Cylinder(10, 10)
result = box - hole
"""
    objects, step_bytes = execute_build123d_code(code)
    assert len(objects) >= 1
    assert objects[0].machining_type in ("2d", "2.5d")


def test_missing_result_raises():
    """Code without `result` variable should raise."""
    code = "x = Box(10, 10, 10)"
    with pytest.raises(CodeExecutionError, match="result"):
        execute_build123d_code(code)


def test_syntax_error_raises():
    """Invalid Python should raise CodeExecutionError."""
    code = "result = Box(10, 10,"
    with pytest.raises(CodeExecutionError):
        execute_build123d_code(code)


def test_forbidden_import_raises():
    """Importing os/subprocess should raise."""
    code = "import os; result = Box(10, 10, 10)"
    with pytest.raises(CodeExecutionError):
        execute_build123d_code(code)


def test_multiple_solids():
    """Compound with multiple solids returns multiple objects."""
    code = """\
from build123d import Compound
b1 = Pos(-60, 0, 0) * Box(50, 30, 10)
b2 = Pos(60, 0, 0) * Box(50, 30, 10)
result = Compound(children=[b1, b2])
"""
    objects, _ = execute_build123d_code(code)
    assert len(objects) == 2


def test_tessellate_returns_mesh():
    """Verify mesh data is generated alongside objects."""
    code = "result = Box(100, 50, 10)"
    objects, step_bytes = execute_build123d_code(code)
    # mesh generation is tested separately; just ensure objects are valid
    assert all(obj.outline for obj in objects)
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run python -m pytest tests/test_ai_cad.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'nodes.ai_cad'`

**Step 3: Write implementation**

```python
# backend/nodes/ai_cad.py
"""AI CAD — execute LLM-generated build123d code in a sandbox."""

from __future__ import annotations

import io
import re
import tempfile
from pathlib import Path

from build123d import Compound, Part, Solid, export_step, import_step

from nodes.brep_import import _analyze_solid
from schemas import BrepObject


class CodeExecutionError(Exception):
    """Raised when user-generated code fails to execute."""


# Imports that are forbidden in generated code
_FORBIDDEN_PATTERNS = re.compile(
    r"\b(import\s+os|import\s+sys|import\s+subprocess|import\s+shutil"
    r"|__import__|exec\s*\(|eval\s*\(|open\s*\()",
)


def execute_build123d_code(code: str) -> tuple[list[BrepObject], bytes | None]:
    """Execute build123d code and return analyzed objects + STEP bytes.

    The code MUST assign a Solid/Part/Compound to a variable named `result`.

    Returns:
        (objects, step_bytes) — list of BrepObject + STEP file as bytes
    Raises:
        CodeExecutionError on any failure
    """
    # 1. Security check
    if _FORBIDDEN_PATTERNS.search(code):
        raise CodeExecutionError(
            "Forbidden pattern detected (os/sys/subprocess/open/exec/eval)"
        )

    # 2. Build execution namespace with build123d imports
    exec_globals = _build_exec_globals()

    # 3. Execute
    try:
        exec(code, exec_globals)
    except SyntaxError as e:
        raise CodeExecutionError(f"Syntax error: {e}") from e
    except Exception as e:
        raise CodeExecutionError(f"Execution error: {e}") from e

    # 4. Extract result
    result = exec_globals.get("result")
    if result is None:
        raise CodeExecutionError(
            "Code must assign a Solid/Part/Compound to variable `result`"
        )

    # 5. Export to STEP (in memory via temp file)
    step_bytes = _export_to_step_bytes(result)

    # 6. Analyze solids
    solids = _extract_solids(result)
    if not solids:
        raise CodeExecutionError("Result contains no solid objects")

    objects = [
        _analyze_solid(solid, index=i, file_name="ai_generated.step")
        for i, solid in enumerate(solids)
    ]

    return objects, step_bytes


def _build_exec_globals() -> dict:
    """Build a globals dict with build123d available."""
    import build123d

    g: dict = {"__builtins__": __builtins__}
    # Import everything from build123d (same as `from build123d import *`)
    for name in dir(build123d):
        if not name.startswith("_"):
            g[name] = getattr(build123d, name)
    return g


def _extract_solids(result) -> list[Solid]:
    """Extract Solid objects from the result."""
    if isinstance(result, Solid):
        return [result]
    if isinstance(result, Part):
        return result.solids() if hasattr(result, "solids") else [result]
    if isinstance(result, Compound):
        return list(result.solids())
    # Try treating as a generic shape
    if hasattr(result, "solids"):
        solids = list(result.solids())
        if solids:
            return solids
    # Last resort: try wrapping
    if isinstance(result, Solid):
        return [result]
    raise CodeExecutionError(
        f"Result type {type(result).__name__} is not a Solid/Part/Compound"
    )


def _export_to_step_bytes(result) -> bytes | None:
    """Export the result to STEP format, returning bytes."""
    try:
        with tempfile.NamedTemporaryFile(suffix=".step", delete=False) as f:
            tmp_path = f.name
        export_step(result, tmp_path)
        step_bytes = Path(tmp_path).read_bytes()
        Path(tmp_path).unlink(missing_ok=True)
        return step_bytes
    except Exception:
        return None
```

**Step 4: Run tests**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run python -m pytest tests/test_ai_cad.py -v`
Expected: All tests PASS (some may need adjustment based on build123d Compound behavior — fix as needed)

**Step 5: Commit**

```bash
git add backend/nodes/ai_cad.py backend/tests/test_ai_cad.py
git commit -m "Add build123d code executor with sandbox and security checks"
```

---

### Task 4: SQLite Database Layer

**Files:**
- Create: `backend/db.py`
- Create: `backend/tests/test_db.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_db.py
"""Tests for SQLite generation storage."""

import pytest

from db import GenerationDB


@pytest.fixture
async def db(tmp_path):
    """Create a temporary database."""
    db = GenerationDB(tmp_path / "test.db")
    await db.init()
    yield db
    await db.close()


@pytest.mark.asyncio
async def test_save_and_load(db):
    gen_id = await db.save_generation(
        prompt="Make a box",
        code="result = Box(10,10,10)",
        result_json='{"file_id":"ai-123","objects":[],"object_count":0}',
        model_used="google/gemini-2.5-flash-lite",
        status="success",
    )
    assert gen_id

    row = await db.get_generation(gen_id)
    assert row is not None
    assert row["prompt"] == "Make a box"
    assert row["code"] == "result = Box(10,10,10)"
    assert row["status"] == "success"
    assert row["model_used"] == "google/gemini-2.5-flash-lite"


@pytest.mark.asyncio
async def test_list_generations(db):
    await db.save_generation(
        prompt="box1", code="c1", result_json="{}", model_used="m1", status="success",
    )
    await db.save_generation(
        prompt="box2", code="c2", result_json="{}", model_used="m1", status="success",
    )

    items = await db.list_generations()
    assert len(items) == 2
    # Most recent first
    assert items[0]["prompt"] == "box2"


@pytest.mark.asyncio
async def test_list_generations_search(db):
    await db.save_generation(
        prompt="wooden shelf", code="c1", result_json="{}", model_used="m1", status="success",
    )
    await db.save_generation(
        prompt="metal bracket", code="c2", result_json="{}", model_used="m1", status="success",
    )

    items = await db.list_generations(search="shelf")
    assert len(items) == 1
    assert items[0]["prompt"] == "wooden shelf"


@pytest.mark.asyncio
async def test_delete_generation(db):
    gen_id = await db.save_generation(
        prompt="tmp", code="c", result_json="{}", model_used="m1", status="success",
    )
    await db.delete_generation(gen_id)
    assert await db.get_generation(gen_id) is None


@pytest.mark.asyncio
async def test_save_with_error(db):
    gen_id = await db.save_generation(
        prompt="bad code", code="invalid", result_json=None,
        model_used="m1", status="error", error_message="SyntaxError",
    )
    row = await db.get_generation(gen_id)
    assert row["status"] == "error"
    assert row["error_message"] == "SyntaxError"
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run python -m pytest tests/test_db.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'db'`

**Step 3: Write implementation**

```python
# backend/db.py
"""SQLite database for AI CAD generation history."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite

_SCHEMA = """\
CREATE TABLE IF NOT EXISTS generations (
    id TEXT PRIMARY KEY,
    prompt TEXT NOT NULL,
    image_path TEXT,
    code TEXT NOT NULL,
    result_json TEXT,
    step_path TEXT,
    model_used TEXT NOT NULL,
    status TEXT NOT NULL,
    error_message TEXT,
    tags TEXT,
    created_at TEXT NOT NULL
);
"""


class GenerationDB:
    """Async SQLite wrapper for generation storage."""

    def __init__(self, db_path: str | Path):
        self._db_path = str(db_path)
        self._conn: aiosqlite.Connection | None = None

    async def init(self):
        """Open connection and create tables."""
        self._conn = await aiosqlite.connect(self._db_path)
        self._conn.row_factory = aiosqlite.Row
        await self._conn.executescript(_SCHEMA)
        await self._conn.commit()

    async def close(self):
        if self._conn:
            await self._conn.close()

    async def save_generation(
        self,
        prompt: str,
        code: str,
        result_json: str | None,
        model_used: str,
        status: str,
        image_path: str | None = None,
        step_path: str | None = None,
        error_message: str | None = None,
        tags: str | None = None,
    ) -> str:
        """Save a generation record. Returns the generation ID."""
        gen_id = uuid.uuid4().hex[:12]
        now = datetime.now(timezone.utc).isoformat()
        await self._conn.execute(
            """INSERT INTO generations
               (id, prompt, image_path, code, result_json, step_path,
                model_used, status, error_message, tags, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (gen_id, prompt, image_path, code, result_json, step_path,
             model_used, status, error_message, tags, now),
        )
        await self._conn.commit()
        return gen_id

    async def get_generation(self, gen_id: str) -> dict | None:
        """Get a single generation by ID."""
        cursor = await self._conn.execute(
            "SELECT * FROM generations WHERE id = ?", (gen_id,)
        )
        row = await cursor.fetchone()
        return dict(row) if row else None

    async def list_generations(
        self,
        search: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict]:
        """List generations, most recent first."""
        if search:
            cursor = await self._conn.execute(
                """SELECT id, prompt, model_used, status, created_at
                   FROM generations
                   WHERE prompt LIKE ?
                   ORDER BY created_at DESC LIMIT ? OFFSET ?""",
                (f"%{search}%", limit, offset),
            )
        else:
            cursor = await self._conn.execute(
                """SELECT id, prompt, model_used, status, created_at
                   FROM generations
                   ORDER BY created_at DESC LIMIT ? OFFSET ?""",
                (limit, offset),
            )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]

    async def delete_generation(self, gen_id: str):
        """Delete a generation record."""
        await self._conn.execute(
            "DELETE FROM generations WHERE id = ?", (gen_id,)
        )
        await self._conn.commit()
```

**Step 4: Run tests**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run python -m pytest tests/test_db.py -v`
Expected: All 5 tests PASS

**Step 5: Commit**

```bash
git add backend/db.py backend/tests/test_db.py
git commit -m "Add SQLite database layer for AI CAD generation history"
```

---

### Task 5: Pydantic Schemas for AI CAD

**Files:**
- Modify: `backend/schemas.py`

**Step 1: Add AI CAD schemas at end of file**

Append after the `SbpZipRequest` class:

```python
# --- AI CAD Node ---


class AiCadRequest(BaseModel):
    """Request to generate a 3D model from text/image prompt."""
    prompt: str
    image_base64: str | None = None
    model: str | None = None  # OpenRouter model ID; None = use default


class AiCadCodeRequest(BaseModel):
    """Request to execute manually-edited build123d code."""
    code: str


class AiCadResult(BrepImportResult):
    """AI CAD output — extends BrepImportResult with generation metadata."""
    generated_code: str
    generation_id: str
    prompt_used: str
    model_used: str


class GenerationSummary(BaseModel):
    """Summary for library listing."""
    generation_id: str
    prompt: str
    model_used: str
    status: str
    created_at: str


class ModelInfo(BaseModel):
    """Available LLM model info."""
    id: str
    name: str
    is_default: bool
    supports_vision: bool
```

**Step 2: Run existing tests to ensure no breakage**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run python -m pytest tests/test_schemas.py -v`
Expected: PASS (no regressions)

**Step 3: Commit**

```bash
git add backend/schemas.py
git commit -m "Add Pydantic schemas for AI CAD node (AiCadResult, GenerationSummary, ModelInfo)"
```

---

### Task 6: FastAPI Endpoints for AI CAD

**Files:**
- Modify: `backend/main.py`

**Step 1: Write integration test**

Create: `backend/tests/test_api_ai_cad.py`

```python
# backend/tests/test_api_ai_cad.py
"""Integration tests for AI CAD API endpoints."""

import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from main import app

client = TestClient(app)


def test_get_models():
    """GET /ai-cad/models returns model list."""
    resp = client.get("/ai-cad/models")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 3
    assert any(m["is_default"] for m in data)


def test_execute_code_simple_box():
    """POST /ai-cad/execute with valid build123d code."""
    resp = client.post("/ai-cad/execute", json={"code": "result = Box(100, 50, 10)"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["object_count"] >= 1
    assert data["generated_code"] == "result = Box(100, 50, 10)"
    assert data["generation_id"]
    assert len(data["objects"]) >= 1


def test_execute_code_syntax_error():
    """POST /ai-cad/execute with invalid code returns 422."""
    resp = client.post("/ai-cad/execute", json={"code": "result = Box(10,"})
    assert resp.status_code == 422


def test_execute_code_no_result():
    """POST /ai-cad/execute without `result` returns 422."""
    resp = client.post("/ai-cad/execute", json={"code": "x = Box(10,10,10)"})
    assert resp.status_code == 422


def test_library_list_empty():
    """GET /ai-cad/library returns empty list initially."""
    resp = client.get("/ai-cad/library")
    assert resp.status_code == 200
    # May or may not be empty depending on prior test runs


def test_generate_requires_api_key(monkeypatch):
    """POST /ai-cad/generate without API key returns 500 or appropriate error."""
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    resp = client.post("/ai-cad/generate", json={"prompt": "a box"})
    # Without API key, should fail gracefully
    assert resp.status_code in (500, 422)
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run python -m pytest tests/test_api_ai_cad.py -v`
Expected: FAIL — endpoints don't exist yet

**Step 3: Add endpoints to main.py**

Add these imports at top of `backend/main.py`:

```python
import json
from nodes.ai_cad import execute_build123d_code, CodeExecutionError
from nodes.mesh_export import tessellate_step_file  # already imported above if needed
from llm_client import LLMClient
from db import GenerationDB
from schemas import (
    # ... existing imports ...
    AiCadRequest, AiCadCodeRequest, AiCadResult,
    GenerationSummary, ModelInfo,
)
```

Add data directory and DB initialization:

```python
DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)
GENERATIONS_DIR = DATA_DIR / "generations"
GENERATIONS_DIR.mkdir(exist_ok=True)

_db: GenerationDB | None = None
_llm: LLMClient | None = None


def _get_db() -> GenerationDB:
    global _db
    if _db is None:
        _db = GenerationDB(DATA_DIR / "pathdesigner.db")
    return _db


def _get_llm() -> LLMClient:
    global _llm
    if _llm is None:
        _llm = LLMClient()
    return _llm


@app.on_event("startup")
async def startup():
    await _get_db().init()


@app.on_event("shutdown")
async def shutdown():
    db = _get_db()
    await db.close()
```

Add the endpoints:

```python
@app.get("/ai-cad/models", response_model=list[ModelInfo])
def get_ai_cad_models():
    """Return available LLM models."""
    return _get_llm().list_models()


@app.post("/ai-cad/generate", response_model=AiCadResult)
async def ai_cad_generate(req: AiCadRequest):
    """Generate 3D model from text/image prompt via LLM."""
    llm = _get_llm()
    db = _get_db()

    # 1. Call LLM
    try:
        code = await llm.generate(req.prompt, req.image_base64, req.model)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM generation failed: {e}")

    model_used = req.model or llm.default_model

    # 2. Execute code
    try:
        objects, step_bytes = execute_build123d_code(code)
    except CodeExecutionError as e:
        # Save failed generation for learning
        await db.save_generation(
            prompt=req.prompt, code=code, result_json=None,
            model_used=model_used, status="error", error_message=str(e),
        )
        raise HTTPException(status_code=422, detail=f"Code execution failed: {e}")

    # 3. Save generation
    file_id = f"ai-cad-{uuid.uuid4().hex[:8]}"
    result = BrepImportResult(
        file_id=file_id, objects=objects, object_count=len(objects),
    )

    # Save STEP file
    step_path = None
    if step_bytes:
        gen_dir = GENERATIONS_DIR / file_id
        gen_dir.mkdir(exist_ok=True)
        step_file = gen_dir / "model.step"
        step_file.write_bytes(step_bytes)
        step_path = str(step_file)
        # Also save to uploads dir so downstream nodes can find it
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


@app.post("/ai-cad/execute", response_model=AiCadResult)
async def ai_cad_execute(req: AiCadCodeRequest):
    """Execute manually-edited build123d code."""
    db = _get_db()

    try:
        objects, step_bytes = execute_build123d_code(req.code)
    except CodeExecutionError as e:
        raise HTTPException(status_code=422, detail=str(e))

    file_id = f"ai-cad-{uuid.uuid4().hex[:8]}"
    result = BrepImportResult(
        file_id=file_id, objects=objects, object_count=len(objects),
    )

    # Save STEP to uploads for downstream compatibility
    if step_bytes:
        (UPLOAD_DIR / f"{file_id}.step").write_bytes(step_bytes)
        gen_dir = GENERATIONS_DIR / file_id
        gen_dir.mkdir(exist_ok=True)
        (gen_dir / "model.step").write_bytes(step_bytes)

    gen_id = await db.save_generation(
        prompt="(manual code)", code=req.code,
        result_json=result.model_dump_json(),
        model_used="manual", status="success",
    )

    return AiCadResult(
        file_id=file_id, objects=objects, object_count=len(objects),
        generated_code=req.code, generation_id=gen_id,
        prompt_used="(manual code)", model_used="manual",
    )


@app.get("/ai-cad/library", response_model=list[GenerationSummary])
async def ai_cad_library(search: str | None = None, limit: int = 50, offset: int = 0):
    """List past generations."""
    db = _get_db()
    rows = await db.list_generations(search=search, limit=limit, offset=offset)
    return [
        GenerationSummary(
            generation_id=r["id"],
            prompt=r["prompt"],
            model_used=r["model_used"],
            status=r["status"],
            created_at=r["created_at"],
        )
        for r in rows
    ]


@app.get("/ai-cad/library/{gen_id}", response_model=AiCadResult)
async def ai_cad_load(gen_id: str):
    """Load a specific generation from library."""
    db = _get_db()
    row = await db.get_generation(gen_id)
    if not row:
        raise HTTPException(status_code=404, detail="Generation not found")

    if row["status"] != "success" or not row["result_json"]:
        raise HTTPException(status_code=422, detail="Generation was not successful")

    import json
    result_data = json.loads(row["result_json"])

    return AiCadResult(
        file_id=result_data["file_id"],
        objects=result_data["objects"],
        object_count=result_data["object_count"],
        generated_code=row["code"],
        generation_id=row["id"],
        prompt_used=row["prompt"],
        model_used=row["model_used"],
    )


@app.delete("/ai-cad/library/{gen_id}")
async def ai_cad_delete(gen_id: str):
    """Delete a generation."""
    db = _get_db()
    await db.delete_generation(gen_id)
    return {"deleted": gen_id}
```

**Step 4: Run tests**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run python -m pytest tests/test_api_ai_cad.py -v`
Expected: All tests PASS

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run python -m pytest -v`
Expected: All existing tests still PASS

**Step 5: Commit**

```bash
git add backend/main.py backend/tests/test_api_ai_cad.py
git commit -m "Add AI CAD API endpoints (generate, execute, library, models)"
```

---

## Phase 2: Frontend — AI CAD Node + Code Panel

### Task 7: TypeScript Types + API Client

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api.ts`

**Step 1: Add types to `types.ts`**

Append:

```typescript
/** AI CAD Node types */

export interface AiCadResult extends BrepImportResult {
  generated_code: string;
  generation_id: string;
  prompt_used: string;
  model_used: string;
}

export interface GenerationSummary {
  generation_id: string;
  prompt: string;
  model_used: string;
  status: string;
  created_at: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  is_default: boolean;
  supports_vision: boolean;
}
```

**Step 2: Add API functions to `api.ts`**

Add imports at top:

```typescript
import type {
  // ... existing imports ...
  AiCadResult,
  GenerationSummary,
  ModelInfo,
} from "./types";
```

Append functions:

```typescript
export async function generateAiCad(
  prompt: string,
  imageBase64?: string,
  model?: string,
): Promise<AiCadResult> {
  return requestJson<AiCadResult>(
    `${API_BASE_URL}/ai-cad/generate`,
    jsonPost({ prompt, image_base64: imageBase64, model }),
    "AI generation failed"
  );
}

export async function executeAiCadCode(code: string): Promise<AiCadResult> {
  return requestJson<AiCadResult>(
    `${API_BASE_URL}/ai-cad/execute`,
    jsonPost({ code }),
    "Code execution failed"
  );
}

export async function fetchAiCadModels(): Promise<ModelInfo[]> {
  return requestJson<ModelInfo[]>(
    `${API_BASE_URL}/ai-cad/models`,
    undefined,
    "Failed to fetch models"
  );
}

export async function fetchAiCadLibrary(
  search?: string,
): Promise<GenerationSummary[]> {
  const params = search ? `?search=${encodeURIComponent(search)}` : "";
  return requestJson<GenerationSummary[]>(
    `${API_BASE_URL}/ai-cad/library${params}`,
    undefined,
    "Failed to fetch library"
  );
}

export async function loadAiCadGeneration(
  genId: string,
): Promise<AiCadResult> {
  return requestJson<AiCadResult>(
    `${API_BASE_URL}/ai-cad/library/${genId}`,
    undefined,
    "Failed to load generation"
  );
}
```

**Step 3: Commit**

```bash
git add frontend/src/types.ts frontend/src/api.ts
git commit -m "Add AI CAD TypeScript types and API client functions"
```

---

### Task 8: AI CAD Node Component

**Files:**
- Create: `frontend/src/nodes/AiCadNode.tsx`
- Modify: `frontend/src/nodeRegistry.ts`

**Step 1: Create the node component**

```tsx
// frontend/src/nodes/AiCadNode.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { Position, type NodeProps, useReactFlow } from "@xyflow/react";
import LabeledHandle from "./LabeledHandle";
import NodeShell from "../components/NodeShell";
import {
  generateAiCad,
  executeAiCadCode,
  fetchAiCadModels,
  fetchMeshData,
} from "../api";
import type { AiCadResult, ModelInfo, ObjectMesh } from "../types";
import BrepImportPanel from "../components/BrepImportPanel";
import AiCadPanel from "../components/AiCadPanel";
import { usePanelTabs } from "../contexts/PanelTabsContext";

type Status = "idle" | "generating" | "success" | "error";

export default function AiCadNode({ id, selected }: NodeProps) {
  const { openTab } = usePanelTabs();
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<AiCadResult | null>(null);
  const [error, setError] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [meshes, setMeshes] = useState<ObjectMesh[]>([]);
  const { setNodes } = useReactFlow();

  // Load available models on mount
  useEffect(() => {
    fetchAiCadModels()
      .then((ms) => {
        setModels(ms);
        const def = ms.find((m) => m.is_default);
        if (def) setSelectedModel(def.id);
      })
      .catch(() => {});
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    setStatus("generating");
    setError("");
    try {
      const data = await generateAiCad(
        prompt,
        undefined, // image — Phase 2
        selectedModel || undefined,
      );
      setResult(data);
      setStatus("success");
      // Store result in node data for downstream
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, brepResult: data } } : n,
        ),
      );
      // Fetch mesh for 3D preview
      try {
        const meshData = await fetchMeshData(data.file_id);
        setMeshes(meshData.objects);
      } catch {
        // non-critical
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
      setStatus("error");
    }
  }, [id, prompt, selectedModel, setNodes]);

  const handleCodeRerun = useCallback(
    async (code: string) => {
      setStatus("generating");
      setError("");
      try {
        const data = await executeAiCadCode(code);
        setResult(data);
        setStatus("success");
        setNodes((nds) =>
          nds.map((n) =>
            n.id === id ? { ...n, data: { ...n.data, brepResult: data } } : n,
          ),
        );
        try {
          const meshData = await fetchMeshData(data.file_id);
          setMeshes(meshData.objects);
        } catch {}
      } catch (e) {
        setError(e instanceof Error ? e.message : "Execution failed");
        setStatus("error");
      }
    },
    [id, setNodes],
  );

  const handleView3D = useCallback(() => {
    if (!result) return;
    openTab({
      id: `ai-cad-3d-${id}`,
      label: "3D View",
      icon: "🤖",
      content: <BrepImportPanel brepResult={result} meshes={meshes} />,
    });
  }, [id, result, meshes, openTab]);

  const handleViewCode = useCallback(() => {
    if (!result) return;
    openTab({
      id: `ai-cad-code-${id}`,
      label: "Code",
      icon: "📝",
      content: (
        <AiCadPanel
          code={result.generated_code}
          prompt={result.prompt_used}
          model={result.model_used}
          onRerun={handleCodeRerun}
        />
      ),
    });
  }, [id, result, openTab, handleCodeRerun]);

  return (
    <NodeShell category="cad" selected={selected}>
      <div style={headerStyle}>AI CAD</div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe the part to generate..."
        style={textareaStyle}
        rows={3}
      />

      {models.length > 1 && (
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          style={selectStyle}
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      )}

      <button
        onClick={handleGenerate}
        disabled={status === "generating" || !prompt.trim()}
        style={{
          ...generateBtnStyle,
          opacity: status === "generating" || !prompt.trim() ? 0.5 : 1,
        }}
      >
        {status === "generating" ? "Generating..." : "Generate"}
      </button>

      {status === "error" && (
        <div style={{ color: "#d32f2f", fontSize: 11, padding: "4px 0" }}>
          {error}
        </div>
      )}

      {status === "success" && result && (
        <div style={resultStyle}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {result.object_count} object{result.object_count > 1 ? "s" : ""}
          </div>
          {result.objects.map((obj) => (
            <div key={obj.object_id} style={objStyle}>
              <div style={{ fontSize: 11 }}>
                {obj.bounding_box.x.toFixed(1)} x {obj.bounding_box.y.toFixed(1)} x{" "}
                {obj.bounding_box.z.toFixed(1)} mm
              </div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
            {meshes.length > 0 && (
              <button onClick={handleView3D} style={viewBtnStyle}>
                View 3D
              </button>
            )}
            <button onClick={handleViewCode} style={viewBtnStyle}>
              View Code
            </button>
          </div>
        </div>
      )}

      <LabeledHandle
        type="source"
        position={Position.Bottom}
        id={`${id}-out`}
        label="out"
        dataType="geometry"
      />
    </NodeShell>
  );
}

const headerStyle: React.CSSProperties = {
  fontWeight: 700, fontSize: 13, marginBottom: 8, color: "#333",
};
const textareaStyle: React.CSSProperties = {
  width: "100%", border: "1px solid #ddd", borderRadius: 6,
  padding: "8px", fontSize: 12, resize: "vertical",
  fontFamily: "inherit", boxSizing: "border-box",
};
const selectStyle: React.CSSProperties = {
  width: "100%", padding: "4px 8px", border: "1px solid #ddd",
  borderRadius: 6, fontSize: 11, marginTop: 4,
  boxSizing: "border-box",
};
const generateBtnStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", border: "none", borderRadius: 6,
  background: "#e65100", color: "white", cursor: "pointer",
  fontSize: 12, fontWeight: 600, marginTop: 6,
};
const resultStyle: React.CSSProperties = {
  marginTop: 8, fontSize: 12,
};
const objStyle: React.CSSProperties = {
  background: "#f5f5f5", borderRadius: 4, padding: "4px 8px", marginTop: 4,
};
const viewBtnStyle: React.CSSProperties = {
  flex: 1, padding: "6px 12px", border: "1px solid #ddd", borderRadius: 6,
  background: "white", color: "#333", cursor: "pointer", fontSize: 11,
};
```

**Step 2: Register in nodeRegistry.ts**

Add import:
```typescript
import AiCadNode from "./nodes/AiCadNode";
```

Add to `NODE_REGISTRY` (after `brepImport`):
```typescript
  aiCad: { component: AiCadNode, label: "AI CAD", category: "cad" },
```

**Step 3: Commit**

```bash
git add frontend/src/nodes/AiCadNode.tsx frontend/src/nodeRegistry.ts
git commit -m "Add AI CAD node component with prompt input, model selector, and 3D preview"
```

---

### Task 9: Code Editor Side Panel

**Files:**
- Create: `frontend/src/components/AiCadPanel.tsx`

**Step 1: Create the panel**

```tsx
// frontend/src/components/AiCadPanel.tsx
import { useState } from "react";

interface Props {
  code: string;
  prompt: string;
  model: string;
  onRerun: (code: string) => void;
}

export default function AiCadPanel({ code, prompt, model, onRerun }: Props) {
  const [editedCode, setEditedCode] = useState(code);
  const [isEditing, setIsEditing] = useState(false);

  const handleRerun = () => {
    onRerun(editedCode);
  };

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

      <div style={codeSection}>
        <div style={codeLabelRow}>
          <span style={metaLabel}>build123d Code</span>
          <button
            onClick={() => setIsEditing(!isEditing)}
            style={toggleBtn}
          >
            {isEditing ? "Cancel Edit" : "Edit"}
          </button>
        </div>

        {isEditing ? (
          <>
            <textarea
              value={editedCode}
              onChange={(e) => setEditedCode(e.target.value)}
              style={editorStyle}
              rows={20}
              spellCheck={false}
            />
            <button onClick={handleRerun} style={rerunBtn}>
              Re-run Code
            </button>
          </>
        ) : (
          <pre style={preStyle}>{code}</pre>
        )}
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", height: "100%",
  overflow: "hidden",
};
const metaStyle: React.CSSProperties = {
  padding: "12px 16px", borderBottom: "1px solid #f0f0f0",
};
const metaRow: React.CSSProperties = {
  fontSize: 12, padding: "2px 0", color: "#555",
};
const metaLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: "#888",
  textTransform: "uppercase", letterSpacing: 1, marginRight: 8,
};
const codeSection: React.CSSProperties = {
  flex: 1, display: "flex", flexDirection: "column",
  padding: "12px 16px", overflow: "hidden",
};
const codeLabelRow: React.CSSProperties = {
  display: "flex", justifyContent: "space-between",
  alignItems: "center", marginBottom: 8,
};
const toggleBtn: React.CSSProperties = {
  padding: "4px 12px", border: "1px solid #ddd", borderRadius: 4,
  background: "white", cursor: "pointer", fontSize: 11,
};
const preStyle: React.CSSProperties = {
  flex: 1, overflow: "auto", background: "#1e1e1e", color: "#d4d4d4",
  padding: 16, borderRadius: 8, fontSize: 13,
  fontFamily: "'SF Mono', 'Fira Code', monospace",
  lineHeight: 1.5, margin: 0, whiteSpace: "pre-wrap",
};
const editorStyle: React.CSSProperties = {
  flex: 1, background: "#1e1e1e", color: "#d4d4d4",
  padding: 16, borderRadius: 8, fontSize: 13,
  fontFamily: "'SF Mono', 'Fira Code', monospace",
  lineHeight: 1.5, border: "2px solid #e65100",
  resize: "none", boxSizing: "border-box",
};
const rerunBtn: React.CSSProperties = {
  padding: "8px 16px", border: "none", borderRadius: 6,
  background: "#e65100", color: "white", cursor: "pointer",
  fontSize: 12, fontWeight: 600, marginTop: 8,
};
```

**Step 2: Verify build**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/frontend && npm run build`
Expected: Build succeeds with no errors

**Step 3: Commit**

```bash
git add frontend/src/components/AiCadPanel.tsx
git commit -m "Add AI CAD code editor side panel with edit and re-run support"
```

---

### Task 10: Add .gitignore for data directory

**Files:**
- Create: `backend/data/.gitignore`

**Step 1: Create gitignore**

```
# AI CAD generated data — not committed
*
!.gitignore
```

**Step 2: Commit**

```bash
git add backend/data/.gitignore
git commit -m "Add .gitignore for AI CAD data directory"
```

---

### Task 11: Manual E2E Test

**Step 1: Start backend + frontend**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner && make dev`

**Step 2: Verify**

1. Open browser → `http://localhost:5173`
2. Drag "AI CAD" from sidebar onto canvas
3. Type "Make a rectangular plate 200x100x12mm"
4. Click "Generate" (requires `OPENROUTER_API_KEY` in env)
5. If no API key: test "View Code" by manually entering code via `/ai-cad/execute` endpoint
6. Verify: node shows object summary, "View 3D" and "View Code" buttons work
7. Connect AI CAD → Sheet → Placement → ... and verify downstream pipeline works

**Step 3: Fix any issues found during manual testing**

---

## Phase 3: Image Input + Chat Iteration + Library UI

### Task 12: Image Drop Input

**Files:**
- Modify: `frontend/src/nodes/AiCadNode.tsx`

**Step 1: Add image state and drop handler**

Add to AiCadNode state:
```typescript
const [imageBase64, setImageBase64] = useState<string | null>(null);
const [imagePreview, setImagePreview] = useState<string | null>(null);
const imageInputRef = useRef<HTMLInputElement>(null);
```

Add image handler:
```typescript
const handleImage = useCallback((file: File) => {
  const reader = new FileReader();
  reader.onload = () => {
    const base64 = reader.result as string;
    setImageBase64(base64);
    setImagePreview(base64);
  };
  reader.readAsDataURL(file);
}, []);
```

Update `handleGenerate` to pass `imageBase64`:
```typescript
const data = await generateAiCad(prompt, imageBase64 || undefined, selectedModel || undefined);
```

Add image drop zone in JSX (after textarea):
```tsx
<div
  style={{
    ...imageDropStyle,
    borderColor: imagePreview ? "#4a90d9" : "#ddd",
  }}
  onClick={() => imageInputRef.current?.click()}
  onDrop={(e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith("image/")) handleImage(file);
  }}
  onDragOver={(e) => e.preventDefault()}
>
  <input
    ref={imageInputRef}
    type="file"
    accept="image/*"
    style={{ display: "none" }}
    onChange={(e) => {
      const file = e.target.files?.[0];
      if (file) handleImage(file);
    }}
  />
  {imagePreview ? (
    <img src={imagePreview} alt="sketch" style={{ maxWidth: "100%", maxHeight: 80, borderRadius: 4 }} />
  ) : (
    <span style={{ color: "#aaa", fontSize: 11 }}>Drop sketch image (optional)</span>
  )}
</div>
```

```typescript
const imageDropStyle: React.CSSProperties = {
  border: "1px dashed #ddd", borderRadius: 6,
  padding: "8px", textAlign: "center", cursor: "pointer",
  marginTop: 4, minHeight: 40, display: "flex",
  alignItems: "center", justifyContent: "center",
};
```

**Step 2: Verify build**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/frontend && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add frontend/src/nodes/AiCadNode.tsx
git commit -m "Add image drop input to AI CAD node for sketch-based generation"
```

---

### Task 13: Chat-like Iteration (Conversation History)

**Files:**
- Modify: `backend/llm_client.py`
- Modify: `backend/schemas.py`
- Modify: `backend/main.py`
- Modify: `frontend/src/nodes/AiCadNode.tsx`
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/types.ts`

**Step 1: Update LLMClient to accept message history**

Add method to `llm_client.py`:

```python
async def generate_with_history(
    self,
    messages: list[dict],
    model: str | None = None,
) -> str:
    """Generate code with full conversation history.

    messages should be list of {"role": "user"|"assistant", "content": str}
    System prompt is prepended automatically.
    """
    use_model = model or self.default_model
    full_messages = [{"role": "system", "content": _SYSTEM_PROMPT}] + messages

    response = await self._client.chat.completions.create(
        model=use_model,
        messages=full_messages,
    )

    raw = response.choices[0].message.content or ""
    return _strip_code_fences(raw)
```

**Step 2: Add chat schemas**

Add to `schemas.py`:

```python
class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AiCadChatRequest(BaseModel):
    """Request with conversation history for iterative refinement."""
    messages: list[ChatMessage]
    image_base64: str | None = None
    model: str | None = None
```

**Step 3: Add chat endpoint to main.py**

```python
@app.post("/ai-cad/chat", response_model=AiCadResult)
async def ai_cad_chat(req: AiCadChatRequest):
    """Generate/refine model using chat history for iterative improvement."""
    llm = _get_llm()
    db = _get_db()

    messages = [{"role": m.role, "content": m.content} for m in req.messages]
    model_used = req.model or llm.default_model

    try:
        code = await llm.generate_with_history(messages, req.model)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM generation failed: {e}")

    try:
        objects, step_bytes = execute_build123d_code(code)
    except CodeExecutionError as e:
        last_prompt = req.messages[-1].content if req.messages else "(chat)"
        await db.save_generation(
            prompt=last_prompt, code=code, result_json=None,
            model_used=model_used, status="error", error_message=str(e),
        )
        raise HTTPException(status_code=422, detail=f"Code execution failed: {e}")

    file_id = f"ai-cad-{uuid.uuid4().hex[:8]}"
    result = BrepImportResult(
        file_id=file_id, objects=objects, object_count=len(objects),
    )

    if step_bytes:
        gen_dir = GENERATIONS_DIR / file_id
        gen_dir.mkdir(exist_ok=True)
        (gen_dir / "model.step").write_bytes(step_bytes)
        (UPLOAD_DIR / f"{file_id}.step").write_bytes(step_bytes)

    last_prompt = req.messages[-1].content if req.messages else "(chat)"
    gen_id = await db.save_generation(
        prompt=last_prompt, code=code,
        result_json=result.model_dump_json(),
        model_used=model_used, status="success",
    )

    return AiCadResult(
        file_id=file_id, objects=objects, object_count=len(objects),
        generated_code=code, generation_id=gen_id,
        prompt_used=last_prompt, model_used=model_used,
    )
```

**Step 4: Add frontend chat API**

Add to `api.ts`:
```typescript
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function chatAiCad(
  messages: ChatMessage[],
  imageBase64?: string,
  model?: string,
): Promise<AiCadResult> {
  return requestJson<AiCadResult>(
    `${API_BASE_URL}/ai-cad/chat`,
    jsonPost({ messages, image_base64: imageBase64, model }),
    "Chat generation failed"
  );
}
```

**Step 5: Update AiCadNode for chat history**

Add state:
```typescript
const [chatHistory, setChatHistory] = useState<{role: "user" | "assistant"; content: string}[]>([]);
```

Update `handleGenerate`:
```typescript
const handleGenerate = useCallback(async () => {
  if (!prompt.trim()) return;
  setStatus("generating");
  setError("");

  // Build new history
  const newHistory = [
    ...chatHistory,
    { role: "user" as const, content: prompt },
  ];

  try {
    let data: AiCadResult;
    if (chatHistory.length === 0) {
      // First message: use simple generate
      data = await generateAiCad(prompt, imageBase64 || undefined, selectedModel || undefined);
    } else {
      // Follow-up: use chat with history
      data = await chatAiCad(newHistory, imageBase64 || undefined, selectedModel || undefined);
    }

    setChatHistory([
      ...newHistory,
      { role: "assistant", content: data.generated_code },
    ]);
    setResult(data);
    setStatus("success");
    setPrompt(""); // Clear for next message
    // ... rest same as before (setNodes, fetchMeshData)
  } catch (e) {
    // ... error handling
  }
}, [id, prompt, selectedModel, imageBase64, chatHistory, setNodes]);
```

Show chat history in node:
```tsx
{chatHistory.length > 0 && (
  <div style={{ fontSize: 11, color: "#888", padding: "4px 0" }}>
    {Math.floor(chatHistory.length / 2)} turn{chatHistory.length > 2 ? "s" : ""}
    <button
      onClick={() => { setChatHistory([]); setResult(null); }}
      style={{ marginLeft: 8, fontSize: 10, color: "#d32f2f", cursor: "pointer", border: "none", background: "none" }}
    >
      Reset
    </button>
  </div>
)}
```

**Step 6: Verify build**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/frontend && npm run build`

**Step 7: Commit**

```bash
git add backend/llm_client.py backend/schemas.py backend/main.py frontend/src/nodes/AiCadNode.tsx frontend/src/api.ts frontend/src/types.ts
git commit -m "Add chat-based iterative refinement for AI CAD node"
```

---

### Task 14: Library Side Panel

**Files:**
- Create: `frontend/src/components/AiCadLibraryPanel.tsx`
- Modify: `frontend/src/nodes/AiCadNode.tsx`

**Step 1: Create library panel**

```tsx
// frontend/src/components/AiCadLibraryPanel.tsx
import { useCallback, useEffect, useState } from "react";
import { fetchAiCadLibrary, loadAiCadGeneration } from "../api";
import type { GenerationSummary, AiCadResult } from "../types";

interface Props {
  onLoad: (result: AiCadResult) => void;
}

export default function AiCadLibraryPanel({ onLoad }: Props) {
  const [items, setItems] = useState<GenerationSummary[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAiCadLibrary(search || undefined);
      setItems(data);
    } catch {}
    setLoading(false);
  }, [search]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleLoad = useCallback(
    async (genId: string) => {
      try {
        const result = await loadAiCadGeneration(genId);
        onLoad(result);
      } catch {}
    },
    [onLoad],
  );

  return (
    <div style={panelStyle}>
      <div style={searchRow}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search prompts..."
          style={searchInput}
        />
      </div>
      {loading && <div style={{ padding: 16, color: "#888" }}>Loading...</div>}
      <div style={listStyle}>
        {items.map((item) => (
          <div
            key={item.generation_id}
            style={itemStyle}
            onClick={() => handleLoad(item.generation_id)}
          >
            <div style={{ fontSize: 12, fontWeight: 500 }}>
              {item.prompt.slice(0, 60)}
              {item.prompt.length > 60 ? "..." : ""}
            </div>
            <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>
              {item.model_used} &middot;{" "}
              {new Date(item.created_at).toLocaleString()}
            </div>
          </div>
        ))}
        {!loading && items.length === 0 && (
          <div style={{ padding: 16, color: "#aaa", textAlign: "center" }}>
            No generations yet
          </div>
        )}
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", height: "100%",
};
const searchRow: React.CSSProperties = {
  padding: "12px 16px", borderBottom: "1px solid #f0f0f0",
};
const searchInput: React.CSSProperties = {
  width: "100%", padding: "6px 10px", border: "1px solid #ddd",
  borderRadius: 6, fontSize: 12, boxSizing: "border-box",
};
const listStyle: React.CSSProperties = {
  flex: 1, overflowY: "auto",
};
const itemStyle: React.CSSProperties = {
  padding: "10px 16px", borderBottom: "1px solid #f5f5f5",
  cursor: "pointer",
};
```

**Step 2: Add Library button to AiCadNode**

In `AiCadNode.tsx`, add a "Library" button that opens this panel:

```typescript
const handleLibrary = useCallback(() => {
  openTab({
    id: `ai-cad-library-${id}`,
    label: "Library",
    icon: "📚",
    content: (
      <AiCadLibraryPanel
        onLoad={(loaded) => {
          setResult(loaded);
          setStatus("success");
          setNodes((nds) =>
            nds.map((n) =>
              n.id === id ? { ...n, data: { ...n.data, brepResult: loaded } } : n,
            ),
          );
        }}
      />
    ),
  });
}, [id, openTab, setNodes]);
```

Add button in the buttons row:
```tsx
<button onClick={handleLibrary} style={viewBtnStyle}>
  Library
</button>
```

**Step 3: Verify build**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/frontend && npm run build`

**Step 4: Commit**

```bash
git add frontend/src/components/AiCadLibraryPanel.tsx frontend/src/nodes/AiCadNode.tsx
git commit -m "Add generation library panel with search and load support"
```

---

### Task 15: Full Test Suite Run + Final Verification

**Step 1: Run all backend tests**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend && uv run python -m pytest -v`
Expected: All tests PASS (no regressions)

**Step 2: Run frontend build**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/frontend && npm run build`
Expected: Build succeeds

**Step 3: Manual E2E test with `make dev`**

1. Start: `make dev`
2. Test: AI CAD node with text prompt
3. Test: Code editing + re-run
4. Test: Image drop (Phase 2)
5. Test: Chat iteration (Phase 3) — "add a hole" after initial generation
6. Test: Library panel — view past generations, load one
7. Test: Connect AI CAD → Sheet → Placement → Operation → Toolpath Gen → verify full pipeline

**Step 4: Fix any issues, commit fixes**

**Step 5: Final commit with all Phase 1-3 complete**

```bash
git add -A
git commit -m "AI CAD node Phase 1-3 complete: LLM generation, code editing, image input, chat iteration, library"
```

---

## Summary

| Task | Description | Phase |
|------|-------------|-------|
| 1 | Add dependencies (openai, aiosqlite) | 1 |
| 2 | OpenRouter LLM Client | 1 |
| 3 | build123d Code Executor (sandbox) | 1 |
| 4 | SQLite Database Layer | 1 |
| 5 | Pydantic Schemas | 1 |
| 6 | FastAPI Endpoints | 1 |
| 7 | TypeScript Types + API Client | 2 |
| 8 | AI CAD Node Component | 2 |
| 9 | Code Editor Side Panel | 2 |
| 10 | .gitignore for data | 2 |
| 11 | Manual E2E Test (Phase 1+2) | 2 |
| 12 | Image Drop Input | 3 |
| 13 | Chat-like Iteration | 3 |
| 14 | Library Side Panel | 3 |
| 15 | Full Test Suite + Verification | 3 |
