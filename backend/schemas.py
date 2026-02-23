"""Pydantic schemas for PathDesigner node data."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, field_validator


# --- Node 1: BREP Import ---


class BoundingBox(BaseModel):
    x: float
    y: float
    z: float


class Origin(BaseModel):
    position: list[float]  # [x, y, z]
    reference: Literal["bounding_box_min", "bounding_box_center", "model_origin"]
    description: str


class FacesAnalysis(BaseModel):
    top_features: bool
    bottom_features: bool
    freeform_surfaces: bool


class BrepObject(BaseModel):
    object_id: str
    file_name: str
    bounding_box: BoundingBox
    thickness: float
    origin: Origin
    unit: Literal["mm", "inch"]
    is_closed: bool
    is_planar: bool
    machining_type: Literal["2d", "2.5d", "double_sided", "3d"]
    faces_analysis: FacesAnalysis
    outline: list[list[float]] = []  # [[x, y], ...] bottom-face outline, relative to BB min


class BrepImportResult(BaseModel):
    file_id: str
    objects: list[BrepObject]
    object_count: int


# --- Node 2: Contour Extract ---


class ContourExtractRequest(BaseModel):
    file_id: str
    object_id: str
    tool_diameter: float = 6.35  # mm, default 1/4"
    offset_side: Literal["outside", "inside", "none"] = "outside"


class Contour(BaseModel):
    """A 2D contour extracted from a BREP solid cross-section.

    type values:
      - "exterior": Outer boundary of the object (cut-out profile).
      - "interior": Inner hole or cutout within the object.
      - "pocket":   Closed region for pocket (area-clearing) machining.
      - "drill_center": Single-point marker for a drill hole center.
    """

    id: str
    type: Literal["exterior", "interior", "pocket", "drill_center"]
    coords: list[list[float]]  # [[x, y], ...]
    closed: bool


class OffsetApplied(BaseModel):
    distance: float
    side: Literal["outside", "inside", "none"]


class ContourExtractResult(BaseModel):
    object_id: str
    slice_z: float
    thickness: float  # object thickness from bounding box (mm)
    contours: list[Contour]
    offset_applied: OffsetApplied


# --- Node 2b: Sheet Settings ---


class SheetMaterial(BaseModel):
    material_id: str
    label: str = ""
    width: float = 600        # mm (X)
    depth: float = 400        # mm (Y)
    thickness: float = 18     # mm (Z)
    x_position: float = 0     # position on CNC bed
    y_position: float = 0


class SheetSettings(BaseModel):
    materials: list[SheetMaterial]


# --- Node 3: Machining Settings ---


class Tool(BaseModel):
    diameter: float  # mm
    type: Literal["endmill", "ballnose", "v_bit"]
    flutes: int


class FeedRate(BaseModel):
    xy: float  # mm/s
    z: float  # mm/s


class TabSettings(BaseModel):
    enabled: bool
    height: float  # mm
    width: float  # mm
    count: int


class MachiningSettings(BaseModel):
    """CNC machining parameters for a single operation.

    Field applicability by operation_type:

    +-----------------+---------+--------+-------+---------+
    | Field           | contour | pocket | drill | engrave |
    +-----------------+---------+--------+-------+---------+
    | tool            |    x    |   x    |   x   |    x    |
    | feed_rate       |    x    |   x    |   x   |    x    |
    | jog_speed       |    x    |   x    |   x   |    x    |
    | spindle_speed   |    x    |   x    |   x   |    x    |
    | depth_per_pass  |    x    |   x    |   -   |    x    |
    | total_depth     |    x    |   x    |   x   |    x    |
    | direction       |    x    |   x    |   -   |    x    |
    | offset_side     |    x    |   -    |   -   |    -    |
    | tabs            |    x    |   -    |   -   |    -    |
    | pocket_pattern  |    -    |   x    |   -   |    -    |
    | pocket_stepover |    -    |   x    |   -   |    -    |
    | depth_per_peck  |    -    |   -    |   x   |    -    |
    +-----------------+---------+--------+-------+---------+

    Fields marked '-' are ignored for that operation type but still
    present with default values for serialization simplicity.
    """

    operation_type: Literal["contour", "pocket", "drill", "engrave"]
    tool: Tool
    feed_rate: FeedRate
    jog_speed: float  # mm/s
    spindle_speed: int  # RPM
    depth_per_pass: float  # mm
    total_depth: float  # mm
    direction: Literal["climb", "conventional"]
    offset_side: Literal["outside", "inside", "none"]
    tabs: TabSettings
    # Pocket-specific
    pocket_pattern: Literal["contour-parallel", "raster"] = "contour-parallel"
    pocket_stepover: float = 0.5  # 0-1 ratio of tool diameter
    # Drill-specific
    depth_per_peck: float = 6.0  # mm


_DEFAULT_TOOL = Tool(diameter=6.35, type="endmill", flutes=2)
_DEFAULT_TABS_OFF = TabSettings(enabled=False, height=0, width=0, count=0)

_DEFAULT_SETTINGS: dict[str, dict] = {
    "contour": dict(
        operation_type="contour",
        tool=_DEFAULT_TOOL,
        feed_rate=FeedRate(xy=75, z=25),
        jog_speed=200,
        spindle_speed=18000,
        depth_per_pass=6.0,
        total_depth=18.0,
        direction="climb",
        offset_side="outside",
        tabs=TabSettings(enabled=True, height=8, width=5, count=4),
    ),
    "pocket": dict(
        operation_type="pocket",
        tool=_DEFAULT_TOOL,
        feed_rate=FeedRate(xy=60, z=20),
        jog_speed=200,
        spindle_speed=18000,
        depth_per_pass=3.0,
        total_depth=6.0,
        direction="climb",
        offset_side="none",
        tabs=_DEFAULT_TABS_OFF,
    ),
    "drill": dict(
        operation_type="drill",
        tool=_DEFAULT_TOOL,
        feed_rate=FeedRate(xy=75, z=15),
        jog_speed=200,
        spindle_speed=18000,
        depth_per_pass=6.0,
        total_depth=10.0,
        direction="climb",
        offset_side="none",
        tabs=_DEFAULT_TABS_OFF,
    ),
}


def default_settings_for(operation_type: str) -> MachiningSettings:
    """Return default MachiningSettings for a given operation type."""
    if operation_type not in _DEFAULT_SETTINGS:
        raise ValueError(f"Unknown operation type: {operation_type!r}")
    return MachiningSettings(**_DEFAULT_SETTINGS[operation_type])


class PresetItem(BaseModel):
    id: str
    name: str
    material: str
    settings: MachiningSettings


class ValidateSettingsRequest(BaseModel):
    settings: MachiningSettings


class ValidateSettingsResponse(BaseModel):
    valid: bool
    settings: MachiningSettings
    warnings: list[str]


# --- Node 3b: Operation Detection ---


class DetectOperationsRequest(BaseModel):
    file_id: str
    object_ids: list[str]
    tool_diameter: float = 6.35
    offset_side: str = "outside"


class OperationGeometry(BaseModel):
    contours: list[Contour]
    offset_applied: OffsetApplied
    depth: float  # cutting depth for this operation (mm)


class DetectedOperation(BaseModel):
    operation_id: str
    object_id: str
    operation_type: Literal["contour", "pocket", "drill", "engrave"]
    geometry: OperationGeometry
    suggested_settings: MachiningSettings
    enabled: bool = True


class OperationDetectResult(BaseModel):
    operations: list[DetectedOperation]


# --- Node 4: Operation Editing ---


class OperationAssignment(BaseModel):
    operation_id: str
    material_id: str
    enabled: bool = True
    settings: MachiningSettings
    order: int
    group_id: str | None = None


class OperationEditResult(BaseModel):
    assignments: list[OperationAssignment]


# --- Node 5: Post Processor Settings ---


class PostProcessorSettings(BaseModel):
    machine_name: str = "ShopBot PRS-alpha 96-48"
    output_format: Literal["sbp", "gcode"] = "sbp"
    unit: Literal["mm", "inch"] = "mm"
    bed_size: list[float] = [1220.0, 2440.0]  # [x, y] mm
    safe_z: float = 38.0
    home_position: list[float] = [0.0, 0.0]
    tool_number: int = 3
    warmup_pause: int = 2  # seconds


# --- Node 6: Toolpath Generation ---


class TabSegment(BaseModel):
    start_index: int  # index in path coords where tab starts
    end_index: int  # index where tab ends
    z_tab: float  # Z height at tab top


class ToolpathPass(BaseModel):
    pass_number: int  # 1-based
    z_depth: float  # Z coordinate for this pass
    path: list[list[float]]  # [[x, y], ...]
    tabs: list[TabSegment]  # tabs (only on final pass)


class Toolpath(BaseModel):
    operation_id: str
    passes: list[ToolpathPass]
    settings: MachiningSettings | None = None


class ToolpathGenRequest(BaseModel):
    operations: list[OperationAssignment]
    detected_operations: OperationDetectResult
    sheet: SheetSettings
    placements: list[PlacementItem] = []
    object_origins: dict[str, list[float]] = {}  # object_id → [origin_x, origin_y]
    bounding_boxes: dict[str, BoundingBox] = {}  # object_id → bounding_box


class ToolpathGenResult(BaseModel):
    toolpaths: list[Toolpath]
    sheet_width: float | None = None   # mm (X axis)
    sheet_depth: float | None = None   # mm (Y axis)


class SbpGenRequest(BaseModel):
    toolpath_result: ToolpathGenResult
    operations: list[OperationAssignment]
    sheet: SheetSettings
    post_processor: PostProcessorSettings


class OutputResult(BaseModel):
    code: str
    filename: str
    format: Literal["sbp", "gcode"]


# --- Mesh Data (3D Preview) ---


class ObjectMesh(BaseModel):
    object_id: str
    vertices: list[float]  # flat [x0, y0, z0, x1, ...]
    faces: list[int]       # flat [i0, j0, k0, i1, ...]


class MeshDataRequest(BaseModel):
    file_id: str


class MeshDataResult(BaseModel):
    objects: list[ObjectMesh]


# --- Placement ---


class PlacementItem(BaseModel):
    object_id: str
    material_id: str
    sheet_id: str = "sheet_1"  # physical sheet identifier
    x_offset: float = 0       # mm, position on sheet
    y_offset: float = 0
    rotation: int = 0          # degrees, 0/45/90/135/180/225/270/315

    @field_validator("rotation")
    @classmethod
    def validate_rotation(cls, v):
        if v % 45 != 0 or v < 0 or v >= 360:
            raise ValueError("rotation must be 0, 45, 90, 135, 180, 225, 270, or 315")
        return v


class PlacementResult(BaseModel):
    placements: list[PlacementItem]
    sheet: SheetSettings
    objects: list[BrepObject]


class ValidatePlacementRequest(BaseModel):
    placements: list[PlacementItem]
    sheet: SheetSettings
    bounding_boxes: dict[str, BoundingBox]  # object_id -> bounding_box
    outlines: dict[str, list[list[float]]] = {}  # object_id -> [[x,y], ...]
    tool_diameter: float = 6.35


class ValidatePlacementResponse(BaseModel):
    valid: bool
    warnings: list[str]


# --- Auto Nesting ---


class AutoNestingRequest(BaseModel):
    objects: list[BrepObject]
    sheet: SheetSettings
    tool_diameter: float = 6.35
    clearance: float = 5.0


class AutoNestingResponse(BaseModel):
    placements: list[PlacementItem]
    sheet_count: int
    warnings: list[str] = []


# --- SBP ZIP ---


class SbpZipRequest(BaseModel):
    operations: list[OperationAssignment]
    detected_operations: OperationDetectResult
    sheet: SheetSettings
    placements: list[PlacementItem]
    object_origins: dict[str, list[float]] = {}
    bounding_boxes: dict[str, BoundingBox] = {}
    post_processor: PostProcessorSettings


# --- AI CAD Node ---


class AiCadRequest(BaseModel):
    """Request to generate a 3D model from text/image prompt."""
    prompt: str
    image_base64: str | None = None
    model: str | None = None  # OpenRouter model ID; None = use default
    profile: str = "general"


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


class ProfileInfo(BaseModel):
    """Available prompt profile info."""
    id: str
    name: str
    description: str
