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
