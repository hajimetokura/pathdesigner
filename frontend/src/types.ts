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
  outline: [number, number][];  // bottom-face outline, relative to BB min
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

/** Node 2b: Stock Settings types */

export interface StockMaterial {
  material_id: string;
  label: string;
  width: number;
  depth: number;
  thickness: number;
  x_position: number;
  y_position: number;
}

export interface StockSettings {
  materials: StockMaterial[];
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

/** Node 3b: Operation Detection types */

export interface OperationGeometry {
  contours: Contour[];
  offset_applied: OffsetApplied;
  depth: number;
}

export interface DetectedOperation {
  operation_id: string;
  object_id: string;
  operation_type: string;
  geometry: OperationGeometry;
  suggested_settings: MachiningSettings;
  enabled: boolean;
}

export interface OperationDetectResult {
  operations: DetectedOperation[];
}

/** Node 4: Operation Editing types */

export interface OperationAssignment {
  operation_id: string;
  material_id: string;
  enabled: boolean;
  settings: MachiningSettings;
  order: number;
}

export interface OperationEditResult {
  assignments: OperationAssignment[];
}

/** Node 5: Post Processor Settings types */

export interface PostProcessorSettings {
  machine_name: string;
  output_format: string;
  unit: string;
  bed_size: [number, number];
  safe_z: number;
  home_position: [number, number];
  tool_number: number;
  warmup_pause: number;
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

export interface Toolpath {
  operation_id: string;
  passes: ToolpathPass[];
  settings?: MachiningSettings;
}

export interface ToolpathGenResult {
  toolpaths: Toolpath[];
  stock_width: number | null;
  stock_depth: number | null;
}

export interface OutputResult {
  code: string;
  filename: string;
  format: string;
}

/** Placement types */

export interface PlacementItem {
  object_id: string;
  material_id: string;
  stock_id: string;
  x_offset: number;
  y_offset: number;
  rotation: number;
}

export interface PlacementResult {
  placements: PlacementItem[];
  stock: StockSettings;
  objects: BrepObject[];
}

/** Mesh data for 3D preview */

export interface ObjectMesh {
  object_id: string;
  vertices: number[];  // flat [x0, y0, z0, x1, ...]
  faces: number[];     // flat [i0, j0, k0, i1, ...]
}

export interface MeshDataResult {
  objects: ObjectMesh[];
}

/** Auto Nesting types */

export interface AutoNestingResponse {
  placements: PlacementItem[];
  stock_count: number;
  warnings: string[];
}
