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

/** Node 5: Post Processor Settings types */

export interface SpindleWarmup {
  initial_rpm: number;
  wait_seconds: number;
}

export interface MaterialSettings {
  width: number;
  depth: number;
  thickness: number;
  x_offset: number;
  y_offset: number;
}

export interface PostProcessorSettings {
  machine: string;
  output_format: string;
  unit: string;
  safe_z: number;
  home_position: [number, number];
  tool_number: number;
  spindle_warmup: SpindleWarmup;
  material: MaterialSettings;
}

/** Node 6: Toolpath Generation types */

export interface TabSegment {
  start_index: number;
  end_index: number;
  z_tab: number;
}

export interface ToolpathPass {
  pass_number: number;
  z_depth: number;
  path: [number, number][];
  tabs: TabSegment[];
}

export interface ToolpathResult {
  operation_id: string;
  passes: ToolpathPass[];
}

export interface ToolpathGenResult {
  toolpaths: ToolpathResult[];
}

export interface SbpGenResult {
  sbp_code: string;
  filename: string;
}
