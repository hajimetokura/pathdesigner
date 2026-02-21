/** Node 1: BREP Import types */

export interface BoundingBox {
  x: number;
  y: number;
  z: number;
}

export interface Origin {
  position: [number, number, number];
  reference: string;
  description: string;
}

export interface FacesAnalysis {
  top_features: boolean;
  bottom_features: boolean;
  freeform_surfaces: boolean;
}

export interface BrepObject {
  object_id: string;
  file_name: string;
  bounding_box: BoundingBox;
  thickness: number;
  origin: Origin;
  unit: string;
  is_closed: boolean;
  is_planar: boolean;
  machining_type: string;
  faces_analysis: FacesAnalysis;
}

export interface BrepImportResult {
  objects: BrepObject[];
  object_count: number;
}
