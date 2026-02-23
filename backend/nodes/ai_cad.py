"""AI CAD — execute LLM-generated build123d code in a sandbox."""

from __future__ import annotations

import re
import tempfile
from pathlib import Path

from build123d import Compound, Part, Solid, export_step

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
        return list(result.solids()) if hasattr(result, "solids") else [result]
    if isinstance(result, Compound):
        return list(result.solids())
    # Try treating as a generic shape
    if hasattr(result, "solids"):
        solids = list(result.solids())
        if solids:
            return solids
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
