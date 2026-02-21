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
  file_id: string;
  objects: BrepObject[];
  object_count: number;
}

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

/** Node 3: Machining Settings types */

export interface Tool {
  diameter: number;
  type: string; // "endmill" | "ballnose" | "v_bit"
  flutes: number;
}

export interface FeedRate {
  xy: number; // mm/s
  z: number;  // mm/s
}

export interface TabSettings {
  enabled: boolean;
  height: number; // mm
  width: number;  // mm
  count: number;
}

export interface MachiningSettings {
  operation_type: string; // "contour" | "pocket" | "drill" | "engrave"
  tool: Tool;
  feed_rate: FeedRate;
  jog_speed: number;
  spindle_speed: number;
  depth_per_pass: number;
  total_depth: number;
  direction: string; // "climb" | "conventional"
  offset_side: string; // "outside" | "inside" | "none"
  tabs: TabSettings;
}

export interface PresetItem {
  id: string;
  name: string;
  material: string;
  settings: MachiningSettings;
}

export interface ValidateSettingsResponse {
  valid: boolean;
  settings: MachiningSettings;
  warnings: string[];
}
