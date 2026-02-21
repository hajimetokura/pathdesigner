# Phase 2: 外形線抽出ノード Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract 2D contours from STEP files at Z=0 bottom slice, apply tool offset, and return coordinate JSON.

**Architecture:** Node 1 saves uploaded STEP files server-side with a `file_id`. Node 2 reads the file by `file_id`, sections at Z=0 using build123d, converts wires to shapely Polygons, applies buffer offset, and returns coordinate arrays. Frontend displays contour count and coordinates summary.

**Tech Stack:** build123d (BREP section), shapely (2D offset), FastAPI, React Flow, TypeScript

---

### Task 1: Setup — Branch and Dependencies

**Step 1: Create feature branch**

```bash
git checkout -b feature/phase-2-contour-extract
```

**Step 2: Install shapely**

```bash
cd backend && uv add shapely
```

**Step 3: Add `uploads/` to .gitignore**

Modify: `.gitignore`

Add this line at the end:

```
# Uploaded files
backend/uploads/
```

**Step 4: Commit setup**

```bash
git add .gitignore backend/pyproject.toml backend/uv.lock
git commit -m "Phase 2: Add shapely dependency and uploads gitignore (#2)"
```

---

### Task 2: Backend — Modify Node 1 for file_id

**Files:**
- Modify: `backend/schemas.py` (line 40-42)
- Modify: `backend/main.py` (line 26-50)

**Step 1: Add `file_id` to BrepImportResult schema**

In `backend/schemas.py`, add `file_id` to `BrepImportResult`:

```python
class BrepImportResult(BaseModel):
    file_id: str
    objects: list[BrepObject]
    object_count: int
```

**Step 2: Modify upload endpoint to save file and return file_id**

In `backend/main.py`, replace the upload endpoint to:
- Save the file to `backend/uploads/` with a UUID filename
- Pass the saved path for analysis (no longer use temp file)
- Return `file_id` in the response

```python
import uuid
from pathlib import Path

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

@app.post("/api/upload-step", response_model=BrepImportResult)
async def upload_step(file: UploadFile):
    """Upload a STEP file and return BREP analysis results."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    suffix = Path(file.filename).suffix.lower()
    if suffix not in (".step", ".stp"):
        raise HTTPException(status_code=400, detail="Only .step/.stp files are accepted")

    file_id = uuid.uuid4().hex[:12]
    saved_path = UPLOAD_DIR / f"{file_id}{suffix}"

    content = await file.read()
    saved_path.write_bytes(content)

    try:
        result = analyze_step_file(saved_path, file_name=file.filename)
    except ValueError as e:
        saved_path.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        saved_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"STEP analysis failed: {e}")

    return BrepImportResult(
        file_id=file_id,
        objects=result.objects,
        object_count=result.object_count,
    )
```

Note: `analyze_step_file` still returns objects/object_count — we wrap it with file_id at the endpoint level.

**Step 3: Verify backend starts**

```bash
cd backend && uv run uvicorn main:app --reload --port 8000
```

Verify: no import errors, `/health` returns OK.

**Step 4: Commit**

```bash
git add backend/main.py backend/schemas.py
git commit -m "Phase 2: Add file_id to upload endpoint for server-side file storage (#2)"
```

---

### Task 3: Backend — Create test STEP fixture

**Files:**
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/fixtures/generate_test_step.py`

**Step 1: Create test fixture generator**

Create `backend/tests/conftest.py`:

```python
"""Test configuration and fixtures."""

import sys
from pathlib import Path

import pytest

# Add backend to path so imports work
sys.path.insert(0, str(Path(__file__).parent.parent))

FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def simple_box_step() -> Path:
    """Path to a simple 100x50x10mm box STEP file."""
    path = FIXTURES_DIR / "simple_box.step"
    if not path.exists():
        _generate_simple_box(path)
    return path


def _generate_simple_box(output_path: Path):
    """Generate a simple box STEP file using build123d."""
    from build123d import Box, export_step

    box = Box(100, 50, 10)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    export_step(box, str(output_path))
```

**Step 2: Generate the fixture file**

```bash
cd backend && uv run python -c "
from tests.conftest import _generate_simple_box
from pathlib import Path
p = Path('tests/fixtures/simple_box.step')
p.parent.mkdir(parents=True, exist_ok=True)
_generate_simple_box(p)
print(f'Generated: {p} ({p.stat().st_size} bytes)')
"
```

**Step 3: Commit**

```bash
git add backend/tests/conftest.py backend/tests/fixtures/simple_box.step
git commit -m "Phase 2: Add test fixtures for contour extraction (#2)"
```

---

### Task 4: Backend — Contour extraction schemas

**Files:**
- Modify: `backend/schemas.py`

**Step 1: Add Node 2 Pydantic schemas**

Append to `backend/schemas.py`:

```python
# --- Node 2: Contour Extract ---


class ContourExtractRequest(BaseModel):
    file_id: str
    object_id: str
    tool_diameter: float = 6.35  # mm, default 1/4"
    offset_side: str = "outside"  # "outside" | "inside" | "none"


class Contour(BaseModel):
    id: str
    type: str  # "exterior" | "interior"
    coords: list[list[float]]  # [[x, y], ...]
    closed: bool


class OffsetApplied(BaseModel):
    distance: float
    side: str


class ContourExtractResult(BaseModel):
    object_id: str
    slice_z: float
    contours: list[Contour]
    offset_applied: OffsetApplied
```

**Step 2: Commit**

```bash
git add backend/schemas.py
git commit -m "Phase 2: Add Pydantic schemas for contour extraction (#2)"
```

---

### Task 5: Backend — Contour extraction logic (TDD)

**Files:**
- Create: `backend/tests/test_contour_extract.py`
- Create: `backend/nodes/contour_extract.py`

**Step 1: Write the failing test — basic contour extraction**

Create `backend/tests/test_contour_extract.py`:

```python
"""Tests for contour extraction node."""

from pathlib import Path

from nodes.contour_extract import extract_contours
from schemas import ContourExtractResult


def test_extract_contours_simple_box(simple_box_step: Path):
    """A 100x50x10 box should produce one closed exterior contour."""
    result = extract_contours(
        step_path=simple_box_step,
        object_id="obj_001",
        tool_diameter=6.35,
        offset_side="outside",
    )

    assert isinstance(result, ContourExtractResult)
    assert result.object_id == "obj_001"
    assert result.slice_z == 0.0
    assert len(result.contours) >= 1

    exterior = [c for c in result.contours if c.type == "exterior"]
    assert len(exterior) == 1
    assert exterior[0].closed is True
    assert len(exterior[0].coords) >= 4  # At least 4 points for a rectangle

    assert result.offset_applied.distance > 0
    assert result.offset_applied.side == "outside"
```

**Step 2: Run test to verify it fails**

```bash
cd backend && uv run pytest tests/test_contour_extract.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'nodes.contour_extract'`

**Step 3: Write minimal contour extraction implementation**

Create `backend/nodes/contour_extract.py`:

```python
"""Contour Extract Node — slice BREP at Z=0 and extract 2D contours."""

from pathlib import Path

from build123d import Axis, Plane, Solid, import_step
from shapely.geometry import Polygon

from schemas import Contour, ContourExtractResult, OffsetApplied

# Tolerance for Z=0 section retry
SECTION_Z_RETRY_OFFSET = 0.001


def extract_contours(
    step_path: str | Path,
    object_id: str,
    tool_diameter: float = 6.35,
    offset_side: str = "outside",
) -> ContourExtractResult:
    """Extract 2D contours from a STEP file by sectioning at Z=0."""
    compound = import_step(str(step_path))
    solids = compound.solids()
    if not solids:
        raise ValueError("STEP file contains no solids")

    # Use the first solid (multi-object selection by object_id is future work)
    solid = solids[0]
    bb = solid.bounding_box()

    # Section at bottom face (Z = bb.min.Z)
    slice_z = bb.min.Z
    wires = _section_at_z(solid, slice_z)

    # Convert wires to shapely polygons
    raw_contours = _wires_to_polygons(wires)

    # Apply offset
    offset_distance = tool_diameter / 2.0
    if offset_side == "none" or offset_distance == 0:
        offset_contours = raw_contours
        applied_distance = 0.0
        applied_side = "none"
    else:
        offset_contours = _apply_offset(raw_contours, offset_distance, offset_side)
        applied_distance = offset_distance
        applied_side = offset_side

    # Convert to output schema
    contours = []
    for i, poly in enumerate(offset_contours):
        coords = _polygon_to_coords(poly)
        contours.append(
            Contour(
                id=f"contour_{i + 1:03d}",
                type="exterior",
                coords=coords,
                closed=True,
            )
        )

    return ContourExtractResult(
        object_id=object_id,
        slice_z=round(slice_z, 6),
        contours=contours,
        offset_applied=OffsetApplied(distance=applied_distance, side=applied_side),
    )


def _section_at_z(solid: Solid, z: float) -> list:
    """Section a solid at given Z height. Retries with small offset if empty."""
    plane = Plane.XY.offset(z)
    section = solid.section(plane)
    wires = section.wires() if section else []

    if not wires:
        # Retry with small offset (tolerance issue at exact boundary)
        plane = Plane.XY.offset(z + SECTION_Z_RETRY_OFFSET)
        section = solid.section(plane)
        wires = section.wires() if section else []

    if not wires:
        raise ValueError(f"No cross-section found at Z={z}")

    return list(wires)


def _wires_to_polygons(wires) -> list[Polygon]:
    """Convert build123d wires to shapely Polygons."""
    polygons = []
    for wire in wires:
        vertices = wire.vertices()
        if len(vertices) < 3:
            continue
        # Sort vertices by their position along the wire
        coords = [(v.X, v.Y) for v in vertices.sort_by(Axis.X)]
        # Use the wire's edge sampling for smoother curves
        coords = _sample_wire_coords(wire)
        poly = Polygon(coords)
        if poly.is_valid and not poly.is_empty:
            polygons.append(poly)
    return polygons


def _sample_wire_coords(wire, num_points: int = 100) -> list[tuple[float, float]]:
    """Sample evenly-spaced points along a wire for accurate representation."""
    edges = wire.edges()
    coords = []
    for edge in edges:
        # Sample points along each edge
        length = edge.length
        if length < 0.001:
            continue
        n = max(2, int(num_points * length / wire.length))
        for i in range(n):
            t = i / n
            pt = edge.position_at(t)
            coords.append((round(pt.X, 6), round(pt.Y, 6)))
    # Close the polygon
    if coords and coords[0] != coords[-1]:
        coords.append(coords[0])
    return coords


def _apply_offset(
    polygons: list[Polygon], distance: float, side: str
) -> list[Polygon]:
    """Apply offset to polygons. outside=expand, inside=shrink."""
    result = []
    for poly in polygons:
        d = distance if side == "outside" else -distance
        buffered = poly.buffer(d, join_style="mitre")
        if not buffered.is_empty:
            result.append(buffered)
    return result


def _polygon_to_coords(poly: Polygon) -> list[list[float]]:
    """Convert a shapely Polygon exterior to [[x, y], ...] coordinate list."""
    return [[round(x, 4), round(y, 4)] for x, y in poly.exterior.coords]
```

**Step 4: Run test to verify it passes**

```bash
cd backend && uv run pytest tests/test_contour_extract.py -v
```

Expected: PASS

**Step 5: Write additional tests**

Add to `backend/tests/test_contour_extract.py`:

```python
def test_extract_contours_no_offset(simple_box_step: Path):
    """With offset_side='none', raw contour should be returned."""
    result = extract_contours(
        step_path=simple_box_step,
        object_id="obj_001",
        tool_diameter=6.35,
        offset_side="none",
    )

    assert result.offset_applied.distance == 0.0
    assert result.offset_applied.side == "none"
    assert len(result.contours) >= 1


def test_extract_contours_coords_are_2d(simple_box_step: Path):
    """All coordinates should be [x, y] pairs (2D)."""
    result = extract_contours(
        step_path=simple_box_step,
        object_id="obj_001",
        tool_diameter=6.35,
        offset_side="outside",
    )

    for contour in result.contours:
        for coord in contour.coords:
            assert len(coord) == 2, f"Expected 2D coord, got {coord}"


def test_extract_contours_offset_expands_box(simple_box_step: Path):
    """Outside offset should make the bounding region larger than 100x50."""
    result_no_offset = extract_contours(
        step_path=simple_box_step,
        object_id="obj_001",
        tool_diameter=6.35,
        offset_side="none",
    )
    result_with_offset = extract_contours(
        step_path=simple_box_step,
        object_id="obj_001",
        tool_diameter=6.35,
        offset_side="outside",
    )

    from shapely.geometry import Polygon

    poly_raw = Polygon(result_no_offset.contours[0].coords)
    poly_offset = Polygon(result_with_offset.contours[0].coords)

    assert poly_offset.area > poly_raw.area
```

**Step 6: Run all tests**

```bash
cd backend && uv run pytest tests/test_contour_extract.py -v
```

Expected: all PASS

**Step 7: Commit**

```bash
git add backend/nodes/contour_extract.py backend/tests/test_contour_extract.py
git commit -m "Phase 2: Implement contour extraction with build123d section + shapely offset (#2)"
```

---

### Task 6: Backend — API endpoint

**Files:**
- Modify: `backend/main.py`

**Step 1: Add extract-contours endpoint**

Add to `backend/main.py`:

```python
from nodes.contour_extract import extract_contours
from schemas import BrepImportResult, ContourExtractRequest, ContourExtractResult

UPLOAD_DIR = Path(__file__).parent / "uploads"  # already added in Task 2

@app.post("/api/extract-contours", response_model=ContourExtractResult)
async def extract_contours_endpoint(req: ContourExtractRequest):
    """Extract 2D contours from a previously uploaded STEP file."""
    # Find the uploaded file by file_id
    matches = list(UPLOAD_DIR.glob(f"{req.file_id}.*"))
    if not matches:
        raise HTTPException(status_code=404, detail=f"File not found: {req.file_id}")

    step_path = matches[0]

    try:
        result = extract_contours(
            step_path=step_path,
            object_id=req.object_id,
            tool_diameter=req.tool_diameter,
            offset_side=req.offset_side,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Contour extraction failed: {e}")

    return result
```

**Step 2: Verify endpoint works**

```bash
cd backend && uv run uvicorn main:app --reload --port 8000
```

Check: `http://localhost:8000/docs` shows the new endpoint.

**Step 3: Commit**

```bash
git add backend/main.py
git commit -m "Phase 2: Add /api/extract-contours endpoint (#2)"
```

---

### Task 7: Frontend — Types and API

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api.ts`

**Step 1: Add TypeScript types**

Append to `frontend/src/types.ts`:

```typescript
/** Node 2: Contour Extract types */

export interface Contour {
  id: string;
  type: string; // "exterior" | "interior"
  coords: [number, number][];
  closed: boolean;
}

export interface OffsetApplied {
  distance: number;
  side: string;
}

export interface ContourExtractResult {
  object_id: string;
  slice_z: number;
  contours: Contour[];
  offset_applied: OffsetApplied;
}
```

Also add `file_id` to `BrepImportResult`:

```typescript
export interface BrepImportResult {
  file_id: string;
  objects: BrepObject[];
  object_count: number;
}
```

**Step 2: Add API function**

Append to `frontend/src/api.ts`:

```typescript
import type { BrepImportResult, ContourExtractResult } from "./types";

export async function extractContours(
  fileId: string,
  objectId: string,
  toolDiameter: number = 6.35,
  offsetSide: string = "outside"
): Promise<ContourExtractResult> {
  const res = await fetch(`${API_URL}/api/extract-contours`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_id: fileId,
      object_id: objectId,
      tool_diameter: toolDiameter,
      offset_side: offsetSide,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Extraction failed" }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }

  return res.json();
}
```

**Step 3: Commit**

```bash
git add frontend/src/types.ts frontend/src/api.ts
git commit -m "Phase 2: Add frontend types and API for contour extraction (#2)"
```

---

### Task 8: Frontend — ContourExtractNode component

**Files:**
- Create: `frontend/src/nodes/ContourExtractNode.tsx`

**Step 1: Create the node component**

Create `frontend/src/nodes/ContourExtractNode.tsx`:

```tsx
import { useCallback, useState } from "react";
import { Handle, Position, type NodeProps, useReactFlow } from "@xyflow/react";
import { extractContours } from "../api";
import type { ContourExtractResult } from "../types";

type Status = "idle" | "loading" | "success" | "error";

export default function ContourExtractNode({ id }: NodeProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<ContourExtractResult | null>(null);
  const [error, setError] = useState("");
  const { getNode, getEdges } = useReactFlow();

  const handleExtract = useCallback(async () => {
    // Find connected BREP Import node to get file_id and object_id
    const edges = getEdges();
    const incomingEdge = edges.find(
      (e) => e.target === id && e.source === "1"
    );
    if (!incomingEdge) {
      setError("Connect BREP Import node first");
      setStatus("error");
      return;
    }

    const sourceNode = getNode(incomingEdge.source);
    const brepData = sourceNode?.data?.brepResult as
      | { file_id: string; objects: { object_id: string }[] }
      | undefined;

    if (!brepData?.file_id) {
      setError("Upload a STEP file in BREP Import first");
      setStatus("error");
      return;
    }

    setStatus("loading");
    setError("");

    try {
      const data = await extractContours(
        brepData.file_id,
        brepData.objects[0].object_id
      );
      setResult(data);
      setStatus("success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed");
      setStatus("error");
    }
  }, [id, getNode, getEdges]);

  return (
    <div style={nodeStyle}>
      <Handle type="target" position={Position.Top} id={`${id}-in`} />

      <div style={headerStyle}>Contour Extract</div>

      <button
        onClick={handleExtract}
        disabled={status === "loading"}
        style={buttonStyle}
      >
        {status === "loading" ? "Extracting..." : "Extract Contours"}
      </button>

      {status === "error" && (
        <div style={{ color: "#d32f2f", fontSize: 11, padding: "4px 0" }}>
          {error}
        </div>
      )}

      {status === "success" && result && (
        <div style={resultStyle}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {result.contours.length} contour
            {result.contours.length > 1 ? "s" : ""}
          </div>
          <div style={{ fontSize: 11, color: "#555" }}>
            Z: {result.slice_z} mm
          </div>
          {result.contours.map((c) => (
            <div key={c.id} style={contourStyle}>
              <div style={{ fontSize: 11 }}>
                {c.id}: {c.type}
              </div>
              <div style={{ fontSize: 10, color: "#777" }}>
                {c.coords.length} points
                {c.closed ? " (closed)" : " (open)"}
              </div>
            </div>
          ))}
          <div style={{ fontSize: 11, marginTop: 4, color: "#555" }}>
            Offset: {result.offset_applied.distance.toFixed(3)} mm{" "}
            ({result.offset_applied.side})
          </div>
        </div>
      )}

      <Handle type="source" position={Position.Bottom} id={`${id}-out`} />
    </div>
  );
}

const nodeStyle: React.CSSProperties = {
  background: "white",
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: 12,
  minWidth: 200,
  maxWidth: 280,
  boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
};

const headerStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 13,
  marginBottom: 8,
  color: "#333",
};

const buttonStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  border: "1px solid #4a90d9",
  borderRadius: 6,
  background: "#4a90d9",
  color: "white",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};

const resultStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 12,
};

const contourStyle: React.CSSProperties = {
  background: "#f5f5f5",
  borderRadius: 4,
  padding: "6px 8px",
  marginTop: 4,
};
```

**Step 2: Commit**

```bash
git add frontend/src/nodes/ContourExtractNode.tsx
git commit -m "Phase 2: Add ContourExtractNode React Flow component (#2)"
```

---

### Task 9: Frontend — Integrate into App.tsx

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/nodes/BrepImportNode.tsx`

**Step 1: Update BrepImportNode to store result in node data**

In `frontend/src/nodes/BrepImportNode.tsx`, the node needs to store `brepResult` in its node data so ContourExtractNode can read it. Modify `handleFile` to use `useReactFlow().setNodes`:

```tsx
import { useReactFlow } from "@xyflow/react";
// ...
const { setNodes } = useReactFlow();

// Inside handleFile, after setResult(data):
setNodes((nds) =>
  nds.map((n) =>
    n.id === id ? { ...n, data: { ...n.data, brepResult: data } } : n
  )
);
```

**Step 2: Register ContourExtractNode in App.tsx**

In `frontend/src/App.tsx`:

```tsx
import ContourExtractNode from "./nodes/ContourExtractNode";

// Update nodeTypes:
const nodeTypes = useMemo(
  () => ({ brepImport: BrepImportNode, contourExtract: ContourExtractNode }),
  []
);

// Update node 2 in initialNodes:
{
  id: "2",
  type: "contourExtract",
  position: { x: 100, y: 350 },
  data: {},
},
```

**Step 3: Verify frontend compiles**

```bash
cd frontend && npm run build
```

Expected: no TypeScript errors

**Step 4: Commit**

```bash
git add frontend/src/App.tsx frontend/src/nodes/BrepImportNode.tsx
git commit -m "Phase 2: Integrate ContourExtractNode into React Flow canvas (#2)"
```

---

### Task 10: Integration Test — End to End

**Step 1: Start dev servers**

```bash
make dev
```

**Step 2: Manual test flow**

1. Open `http://localhost:5173`
2. Drag a STEP file onto the BREP Import node
3. Verify file_id appears in the response (check browser DevTools Network tab)
4. Click "Extract Contours" on the Contour Extract node
5. Verify contour count and point count display
6. Verify offset info displays correctly

**Step 3: Run backend tests**

```bash
cd backend && uv run pytest tests/ -v
```

Expected: all tests PASS

**Step 4: Final commit if any fixes needed**

---

### Task 11: Create PR

**Step 1: Push branch**

```bash
git push -u origin feature/phase-2-contour-extract
```

**Step 2: Create PR**

```bash
gh pr create --title "Phase 2: Contour extraction node (#2)" --body "$(cat <<'EOF'
## Summary
- Add contour extraction node (Node 2) that slices STEP geometry at Z=0 and extracts 2D contours
- Add file_id system for server-side STEP file persistence between nodes
- Apply tool offset using shapely buffer
- ContourExtractNode React Flow component with extract button and result display

Closes #2

## Test plan
- [ ] Upload STEP file → verify file_id in response
- [ ] Click Extract Contours → verify contour coordinates returned
- [ ] Check offset distance matches tool_diameter/2
- [ ] Backend tests: `cd backend && uv run pytest tests/ -v`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
