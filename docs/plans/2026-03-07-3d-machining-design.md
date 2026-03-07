# 3D Machining Design

## Overview

PathDesignerに3軸3D曲面切削機能を追加する。
ボールエンドミルによる荒削り（Waterline等高線）→ 仕上げ（ラスター走査）の2段階加工。
両面加工（ダボ穴方式/クレードル方式）と治具データ自動生成にも対応。

## Requirements

| Item | Detail |
|------|--------|
| Machining | 3-axis 3D surface milling (ballnose endmill) |
| Roughing | Waterline (Z-level) strategy |
| Finishing | Raster scan (ballnose) |
| Input | STEP (auto-convert to STL) + STL direct import |
| Double-sided | Dowel pin + Cradle fixture, user selectable |
| Fixture data | Auto-generate CNC-ready fixture toolpaths |
| Engine | opencamlib (future: custom implementation) |

## Approach

A1: Extend existing pipeline with 3D branch nodes. OperationDetector auto-classifies
2D/3D operations. 3D-specific nodes generate toolpaths that merge back into the
existing output pipeline via MergeNode.

## Architecture

### Node Graph

```
STEP/STL -> Placement -> Operation(ext) -+-> ToolpathGen(2D) --+
Sheet --/                                +-> 3DMilling(new) --+-+-> Merge(toolpath) -> Preview
PostProcessor --------------------------------/                |                     -> CncCode
                                                               |
                              DoubleSidedSetup(new) ----------+
                              FixtureGen(new) ----------------+
```

- 2D only: ToolpathGen -> Preview/CncCode (direct, no merge needed)
- 3D involved: MergeNode combines 2D + 3D toolpaths
- Double-sided: DoubleSidedSetupNode splits front/back, FixtureGenNode generates jig data

### New Nodes (4)

| Node | Role | Input | Output |
|------|------|-------|--------|
| MeshImportNode | STL/OBJ import + analysis | file drop | `BrepObject` compatible data (geometry) |
| 3DMillingNode | Roughing/finishing params + opencamlib execution | 3D operations from OperationNode | `roughing` + `finishing` toolpath pins |
| DoubleSidedSetupNode | Front/back split, flip axis, fixture config | BREP/mesh geometry | `front side` + `back side` + `fixture` |
| FixtureGenNode | Dowel board / cradle mold generation | DoubleSidedSetup config | `toolpaths` (fixture machining) |

### Modified Nodes

| Node | Change |
|------|--------|
| OperationNode | Add `3d_roughing` / `3d_finishing` operation types |
| MergeNode | Add toolpath merge support (auto-detect by dataType) |
| SBP Writer | Handle `[[x,y,z]]` paths + tool change between merged toolpaths |

### Node NOT modified

| Node | Reason |
|------|--------|
| BREPインポート | STEP-only. Internal STL conversion handled by backend utility |
| ToolpathGenNode | Remains 2D/2.5D specific |
| PlacementNode | Already accepts `BrepObject` — MeshImport outputs compatible data |
| PostProcessorNode | Unchanged — SBP/Gcode settings apply to both 2D and 3D |

## Schema Changes

### ToolpathPass (existing, extended)

```python
class ToolpathPass(BaseModel):
    pass_number: int
    z_depth: float          # 2D: uniform Z / 3D: reference (deepest Z)
    path: list[list[float]] # [[x,y]] (2D) or [[x,y,z]] (3D)
    tabs: list[TabSegment]
```

SBP Writer: `len(point) == 2` -> use z_depth, `len(point) == 3` -> use point[2].

### MeshImportResult (new)

```python
class MeshImportResult(BaseModel):
    file_id: str
    objects: list[BrepObject]  # Compatible subset (machining_type="3d" fixed)
    mesh_file_path: str        # STL path for opencamlib
```

### ThreeDMillingSettings (new)

```python
class ThreeDMillingSettings(BaseModel):
    # Roughing (Waterline)
    z_step: float = 3.0              # mm
    roughing_tool: Tool
    roughing_feedrate: FeedRate
    roughing_spindle: int = 18000
    stock_to_leave: float = 0.5      # mm
    # Finishing (Raster)
    finishing_tool: Tool
    finishing_feedrate: FeedRate
    finishing_spindle: int = 18000
    stepover: float = 0.15           # ratio of tool diameter
    scan_angle: float = 0.0          # degrees
```

### Operation type extension

```python
operation_type: Literal[
    "contour", "pocket", "drill", "engrave",     # existing
    "3d_roughing", "3d_finishing",                 # new
]
```

### DoubleSidedConfig (new)

```python
class DoubleSidedConfig(BaseModel):
    enabled: bool = False
    split_z: float
    flip_axis: Literal["x", "y"]
    fixture_type: Literal["dowel", "cradle"]
    dowel_diameter: float = 8.0
    dowel_positions: list[list[float]] = []
    cradle_stock_thickness: float = 18.0
    cradle_clearance: float = 0.5
```

### FixtureResult (new)

```python
class FixtureResult(BaseModel):
    fixture_type: Literal["dowel", "cradle"]
    toolpaths: list[Toolpath]
    dowel_drill_points: list[list[float]] = []
```

## Backend Processing

### opencamlib Integration

```python
# backend/nodes/three_d_milling.py

def generate_waterline_roughing(stl_path, settings) -> list[Toolpath]:
    # 1. ocl.STLSurf load mesh
    # 2. WaterlineCutter with z_step intervals
    # 3. stock_to_leave offset
    # 4. Convert to Toolpath with [[x,y,z]] paths

def generate_raster_finishing(stl_path, settings) -> list[Toolpath]:
    # 1. BallCutter(finishing_tool.diameter)
    # 2. Generate raster lines at scan_angle with stepover spacing
    # 3. DropCutter along each line -> surface Z values
    # 4. Convert to Toolpath with [[x,y,z]] paths
```

### STEP -> STL conversion

```python
# build123d Solid.export_stl() -> temp file
```

### STL Import

```python
# backend/nodes/mesh_import.py
def analyze_stl_file(filepath, file_name) -> MeshImportResult:
    # trimesh/numpy-stl: load, compute bounding_box
    # Output BrepObject with machining_type="3d", is_planar=False
```

### Double-sided Processing

1. DoubleSidedSetupNode splits model at split_z
2. Front side: 3D rough -> finish as-is
3. Back side: flip around flip_axis -> 3D rough -> finish
4. FixtureGenNode:
   - Dowel: generate common drill holes on workpiece + sacrifice board
   - Cradle: invert front surface + clearance -> pocket toolpath for receiving mold

### API Endpoints (new)

```
POST /api/mesh-import         — STL upload + analysis
POST /api/3d-roughing         — Waterline roughing toolpath
POST /api/3d-finishing        — Raster finishing toolpath
POST /api/double-sided-split  — Model front/back separation
POST /api/fixture-generate    — Fixture toolpath generation
```

## Frontend Node UI

### MeshImportNode
- Drop zone for .stl/.obj files
- Display: filename, bounding box, triangle count
- Output: `out` (dataType: "geometry") -> PlacementNode

### 3DMillingNode
- Input: `3d ops` (dataType: "geometry") <- OperationNode
- Roughing section: tool, z_step, stock_to_leave, feed/speed
- Finishing section: tool, stepover, scan_angle, feed/speed
- Manual trigger: [Generate] button + progress bar
- Output: `roughing` + `finishing` (dataType: "toolpath")
- Separate or combined via MergeNode (tool change auto-inserted)

### DoubleSidedSetupNode
- Input: `brep/mesh` (dataType: "geometry")
- Split Z slider with cross-section preview
- Flip axis: X / Y radio
- Fixture type: Dowel / Cradle radio + type-specific settings
- Output: `front side` + `back side` + `fixture` (3 pins)

### FixtureGenNode
- Input: `fixture config` from DoubleSidedSetupNode
- Stock thickness, clearance settings
- Manual trigger: [Generate] button
- Output: `toolpaths` (dataType: "toolpath") -> MergeNode

### MergeNode (extended)
- Auto-detect input dataType: geometry -> BREP merge, toolpath -> path merge
- Toolpath merge: concatenate in connection order
- SBP Writer emits tool change commands when settings differ between merged paths

## Implementation Phases

### Phase 1: Foundation (STL import + opencamlib)
- MeshImportNode (frontend + backend)
- opencamlib Python binding (`uv add opencamlib`)
- STEP -> STL conversion utility
- ToolpathPass.path 2D/3D dual support (SBP Writer update)
- Goal: Import STL, display bounding box

### Phase 2: 3D Roughing (Waterline)
- `3d_roughing` operation type (schema + OperationDetector)
- 3DMillingNode frontend (roughing section only)
- Waterline engine (backend/nodes/three_d_milling.py)
- `/api/3d-roughing` endpoint
- Goal: Generate roughing toolpath from STL/STEP, preview it

### Phase 3: 3D Finishing (Raster) + MergeNode
- `3d_finishing` operation type
- 3DMillingNode finishing section + dual output pins
- Raster finishing engine (DropCutter)
- MergeNode toolpath merge support
- SBP Writer tool change verification
- Goal: Output roughing -> finishing SBP with tool change

### Phase 4: Double-sided + Fixtures
- DoubleSidedSetupNode (frontend + backend)
- Model split API (split_z)
- FixtureGenNode (frontend + backend)
- Dowel: auto drill hole positions
- Cradle: inverted surface pocket toolpath
- Goal: Output front/back/fixture SBP set

### Phase 5: Testing + Polish
- Unit tests per node
- E2E test (STEP -> SBP full pipeline)
- 3D toolpath visualization in ToolpathPreviewNode
- Machining time estimation

## Reference

- Bark Beetle (Grasshopper CAM): https://github.com/fellesverkstedet/Bark-beetle-parametric-toolpaths
  - Surface 3D mill: iso-curve extraction from BREP surfaces
  - Horizontal 3D mill: mesh slicing with surface angle analysis
  - Make pass depths: Z step-down roughing from 3D curves
  - Automill: auto-classify 2D/3D geometry -> appropriate strategies
- opencamlib: https://github.com/aewallin/opencamlib
  - WaterlineCutter: Z-level contouring
  - DropCutter: surface Z sampling along raster lines
  - BallCutter, CylCutter, BullCutter support
