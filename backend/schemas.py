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
    objects: list[BrepObject]
    object_count: int
