/** Node 1: BREP Import types */

export interface BoundingBox {
  x: number;
  y: number;
  z: number;
}

export interface Origin {
  position: [number, number, number];
  reference: "bounding_box_min" | "bounding_box_center" | "model_origin";
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
  unit: "mm" | "inch";
  is_closed: boolean;
  is_planar: boolean;
  machining_type: "2d" | "2.5d" | "double_sided" | "3d";
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
  type: "exterior" | "interior" | "pocket" | "drill_center";
  coords: [number, number][];
  closed: boolean;
}

export interface OffsetApplied {
  distance: number;
  side: "outside" | "inside" | "none";
}

export interface ContourExtractResult {
  object_id: string;
  slice_z: number;
  thickness: number;
  contours: Contour[];
  offset_applied: OffsetApplied;
}

/** Node 2b: Sheet Settings types */

export interface SheetMaterial {
  material_id: string;
  label: string;
  width: number;
  depth: number;
  thickness: number;
  x_position: number;
  y_position: number;
}

export interface SheetSettings {
  materials: SheetMaterial[];
}

/** Node 3: Machining Settings types */

export interface Tool {
  diameter: number;
  type: "endmill" | "ballnose" | "v_bit";
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
  operation_type: "contour" | "pocket" | "drill" | "engrave";
  tool: Tool;
  feed_rate: FeedRate;
  jog_speed: number;
  spindle_speed: number;
  depth_per_pass: number;
  total_depth: number;
  direction: "climb" | "conventional";
  offset_side: "outside" | "inside" | "none";
  tabs: TabSettings;
  // Pocket-specific
  pocket_pattern?: "contour-parallel" | "raster";
  pocket_stepover?: number; // 0-1 ratio of tool diameter
  // Drill-specific
  depth_per_peck?: number; // mm
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
  operation_type: "contour" | "pocket" | "drill" | "engrave";
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
  group_id?: string;
}

export interface SettingsGroup {
  group_id: string;
  label: string;
  operation_type: string;
  settings: MachiningSettings;
  operation_ids: string[];
}

export interface OperationEditResult {
  assignments: OperationAssignment[];
}

/** Node 5: Post Processor Settings types */

export interface PostProcessorSettings {
  machine_name: string;
  output_format: "sbp" | "gcode";
  unit: "mm" | "inch";
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
  object_id: string;
  contour_type: "exterior" | "interior" | "pocket" | "drill";
  passes: ToolpathPass[];
  settings?: MachiningSettings;
}

export interface ToolpathGenResult {
  toolpaths: Toolpath[];
  sheet_width: number | null;
  sheet_depth: number | null;
}

export interface OutputResult {
  code: string;
  filename: string;
  format: "sbp" | "gcode";
}

/** Placement types */

export interface PlacementItem {
  object_id: string;
  material_id: string;
  sheet_id: string;
  x_offset: number;
  y_offset: number;
  rotation: number;
}

export interface PlacementResult {
  placements: PlacementItem[];
  sheet: SheetSettings;
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
  sheet_count: number;
  warnings: string[];
}

/** AI CAD Node types */

export interface AiCadResult extends BrepImportResult {
  generated_code: string;
  generation_id: string;
  prompt_used: string;
  model_used: string;
}

export type AiCadStage = "designing" | "coding" | "reviewing" | "executing" | "retrying";

export interface AiCadStageEvent {
  stage: AiCadStage;
  message: string;
}

export interface GenerationSummary {
  generation_id: string;
  prompt: string;
  model_used: string;
  status: string;
  created_at: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  is_default: boolean;
  supports_vision: boolean;
}

export interface ProfileInfo {
  id: string;
  name: string;
  description: string;
}

/** AI CAD Chat / Refine types */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  code?: string;            // AI response code (for collapsible display)
  result?: AiCadRefineResult; // Execution result if available
}

export interface AiCadRefineResult {
  code: string;
  objects: BrepObject[];
  object_count: number;
  file_id: string;
  generation_id: string;
  ai_message: string;
}

// ── Snippet DB ────────────────────────────────────────────────────────────────

export interface SnippetInfo {
  id: string;
  name: string;
  tags: string[];
  code: string;
  thumbnail_png: string | null;
  source_generation_id: string | null;
  created_at: string;
}

export interface SnippetListResponse {
  snippets: SnippetInfo[];
  total: number;
}

export interface SnippetSaveRequest {
  name: string;
  tags: string[];
  code: string;
  thumbnail_png?: string;
  source_generation_id?: string;
}

/** Sketch data (for API boundary use; also exported from SketchCanvas component) */

export interface SketchData {
  image_base64: string;
  strokes: { points: [number, number][]; color: string; width: number; tool: "pen" | "eraser" }[];
  canvas_width: number;
  canvas_height: number;
}

/** SnippetDbNode の node data */
export interface SnippetDbNodeData extends Record<string, unknown> {
  outputResult: AiCadResult | null;
}
