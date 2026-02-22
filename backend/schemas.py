"""Pydantic schemas for PathDesigner node data."""

from pydantic import BaseModel


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


# --- Node 5: Post Processor Settings ---


class SpindleWarmup(BaseModel):
    initial_rpm: int = 5000
    wait_seconds: int = 2


class MaterialSettings(BaseModel):
    width: float = 600
    depth: float = 400
    thickness: float = 18
    x_offset: float = 0
    y_offset: float = 0


class PostProcessorSettings(BaseModel):
    machine: str = "shopbot"
    output_format: str = "sbp"
    unit: str = "mm"
    safe_z: float = 38.0
    home_position: list[float] = [0.0, 0.0]
    tool_number: int = 3
    spindle_warmup: SpindleWarmup = SpindleWarmup()
    material: MaterialSettings = MaterialSettings()


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
    contour_result: ContourExtractResult
    machining_settings: MachiningSettings


class ToolpathGenResult(BaseModel):
    toolpaths: list[Toolpath]


class SbpGenRequest(BaseModel):
    toolpath_result: ToolpathGenResult
    machining_settings: MachiningSettings
    post_processor: PostProcessorSettings


class SbpGenResult(BaseModel):
    sbp_code: str
    filename: str
