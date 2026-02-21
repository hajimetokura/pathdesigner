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
