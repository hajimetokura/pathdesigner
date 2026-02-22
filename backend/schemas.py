"""Pydantic schemas for PathDesigner node data."""

from __future__ import annotations

from pydantic import BaseModel, field_validator


# --- Node 1: BREP Import ---


class BoundingBox(BaseModel):
    x: float
    y: float
    z: float


class Origin(BaseModel):
    position: list[float]  # [x, y, z]
    reference: str  # "bounding_box_min" | "bounding_box_center" | "model_origin"
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
    unit: str  # "mm"
    is_closed: bool
    is_planar: bool
    machining_type: str  # "2d" | "2.5d" | "double_sided" | "3d"
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
    thickness: float  # object thickness from bounding box (mm)
    contours: list[Contour]
    offset_applied: OffsetApplied


# --- Node 2b: Stock Settings ---


class StockMaterial(BaseModel):
    material_id: str
    label: str = ""
    width: float = 600        # mm (X)
    depth: float = 400        # mm (Y)
    thickness: float = 18     # mm (Z)
    x_position: float = 0     # position on CNC bed
    y_position: float = 0


class StockSettings(BaseModel):
    materials: list[StockMaterial]


# --- Node 3: Machining Settings ---


class Tool(BaseModel):
    diameter: float  # mm
    type: str  # "endmill" | "ballnose" | "v_bit"
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
    operation_type: str  # "contour" | "pocket" | "drill" | "engrave"
    tool: Tool
    feed_rate: FeedRate
    jog_speed: float  # mm/s
    spindle_speed: int  # RPM
    depth_per_pass: float  # mm
    total_depth: float  # mm
    direction: str  # "climb" | "conventional"
    offset_side: str  # "outside" | "inside" | "none"
    tabs: TabSettings


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


class OperationGeometry(BaseModel):
    contours: list[Contour]
    offset_applied: OffsetApplied
    depth: float  # cutting depth for this operation (mm)


class DetectedOperation(BaseModel):
    operation_id: str
    object_id: str
    operation_type: str  # "contour" | "pocket" | "drill" | "engrave"
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


class OperationEditResult(BaseModel):
    assignments: list[OperationAssignment]


# --- Node 5: Post Processor Settings ---


class PostProcessorSettings(BaseModel):
    machine_name: str = "ShopBot PRS-alpha 96-48"
    output_format: str = "sbp"
    unit: str = "mm"
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


class ToolpathGenRequest(BaseModel):
    operations: list[OperationAssignment]
    detected_operations: OperationDetectResult
    stock: StockSettings
    placements: list[PlacementItem] = []
    object_origins: dict[str, list[float]] = {}  # object_id → [origin_x, origin_y]
    bounding_boxes: dict[str, BoundingBox] = {}  # object_id → bounding_box


class ToolpathGenResult(BaseModel):
    toolpaths: list[Toolpath]
    stock_width: float | None = None   # mm (X axis)
    stock_depth: float | None = None   # mm (Y axis)


class SbpGenRequest(BaseModel):
    toolpath_result: ToolpathGenResult
    operations: list[OperationAssignment]
    stock: StockSettings
    post_processor: PostProcessorSettings


class OutputResult(BaseModel):
    code: str
    filename: str
    format: str  # "sbp" | "gcode" | ...


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
    x_offset: float = 0       # mm, position on stock
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
    stock: StockSettings
    objects: list[BrepObject]


class ValidatePlacementRequest(BaseModel):
    placements: list[PlacementItem]
    stock: StockSettings
    bounding_boxes: dict[str, BoundingBox]  # object_id -> bounding_box


class ValidatePlacementResponse(BaseModel):
    valid: bool
    warnings: list[str]
