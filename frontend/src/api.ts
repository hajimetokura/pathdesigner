import type {
  BrepImportResult,
  BrepObject,
  BoundingBox,
  ContourExtractResult,
  PresetItem,
  ValidateSettingsResponse,
  MachiningSettings,
  OperationDetectResult,
  OperationAssignment,
  SheetSettings,
  PostProcessorSettings,
  ToolpathGenResult,
  OutputResult,
  MeshDataResult,
  PlacementItem,
  AutoNestingResponse,
  AiCadResult,
  GenerationSummary,
  ModelInfo,
  ProfileInfo,
} from "./types";
import { API_BASE_URL } from "./config";
import { DEFAULT_TOOL_DIAMETER_MM, DEFAULT_OFFSET_SIDE, DEFAULT_CLEARANCE_MM } from "./constants";

async function requestJson<T>(
  url: string,
  init?: RequestInit,
  errorMsg = "Request failed"
): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: errorMsg }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

async function requestBlob(
  url: string,
  init: RequestInit,
  errorMsg = "Request failed"
): Promise<Blob> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: errorMsg }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.blob();
}

function jsonPost(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export async function uploadStepFile(file: File): Promise<BrepImportResult> {
  const formData = new FormData();
  formData.append("file", file);
  return requestJson<BrepImportResult>(
    `${API_BASE_URL}/api/upload-step`,
    { method: "POST", body: formData },
    "Upload failed"
  );
}

export async function extractContours(
  fileId: string,
  objectId: string,
  toolDiameter: number = DEFAULT_TOOL_DIAMETER_MM,
  offsetSide: string = DEFAULT_OFFSET_SIDE
): Promise<ContourExtractResult> {
  return requestJson<ContourExtractResult>(
    `${API_BASE_URL}/api/extract-contours`,
    jsonPost({
      file_id: fileId,
      object_id: objectId,
      tool_diameter: toolDiameter,
      offset_side: offsetSide,
    }),
    "Extraction failed"
  );
}

export async function fetchPresets(): Promise<PresetItem[]> {
  return requestJson<PresetItem[]>(
    `${API_BASE_URL}/api/presets`,
    undefined,
    "Failed to fetch presets"
  );
}

export async function validateSettings(
  settings: MachiningSettings
): Promise<ValidateSettingsResponse> {
  return requestJson<ValidateSettingsResponse>(
    `${API_BASE_URL}/api/validate-settings`,
    jsonPost({ settings }),
    "Validation failed"
  );
}

export async function detectOperations(
  fileId: string,
  objectIds: string[],
  toolDiameter: number = DEFAULT_TOOL_DIAMETER_MM,
  offsetSide: string = DEFAULT_OFFSET_SIDE
): Promise<OperationDetectResult> {
  return requestJson<OperationDetectResult>(
    `${API_BASE_URL}/api/detect-operations`,
    jsonPost({
      file_id: fileId,
      object_ids: objectIds,
      tool_diameter: toolDiameter,
      offset_side: offsetSide,
    }),
    "Detection failed"
  );
}

export async function generateToolpath(
  operations: OperationAssignment[],
  detectedOperations: OperationDetectResult,
  sheet: SheetSettings,
  placements: PlacementItem[] = [],
  objectOrigins: Record<string, [number, number]> = {},
  boundingBoxes: Record<string, { x: number; y: number; z: number }> = {}
): Promise<ToolpathGenResult> {
  return requestJson<ToolpathGenResult>(
    `${API_BASE_URL}/api/generate-toolpath`,
    jsonPost({
      operations,
      detected_operations: detectedOperations,
      sheet,
      placements,
      object_origins: objectOrigins,
      bounding_boxes: boundingBoxes,
    }),
    "Toolpath generation failed"
  );
}

export async function generateSbp(
  toolpathResult: ToolpathGenResult,
  operations: OperationAssignment[],
  sheet: SheetSettings,
  postProcessor: PostProcessorSettings
): Promise<OutputResult> {
  return requestJson<OutputResult>(
    `${API_BASE_URL}/api/generate-sbp`,
    jsonPost({
      toolpath_result: toolpathResult,
      operations,
      sheet,
      post_processor: postProcessor,
    }),
    "SBP generation failed"
  );
}

export async function fetchMeshData(
  fileId: string
): Promise<MeshDataResult> {
  return requestJson<MeshDataResult>(
    `${API_BASE_URL}/api/mesh-data`,
    jsonPost({ file_id: fileId }),
    "Mesh data fetch failed"
  );
}

export async function validatePlacement(
  placements: PlacementItem[],
  sheet: SheetSettings,
  boundingBoxes: Record<string, BoundingBox>,
  outlines?: Record<string, number[][]>,
  toolDiameter?: number,
): Promise<{ valid: boolean; warnings: string[] }> {
  const body: Record<string, unknown> = {
    placements,
    sheet,
    bounding_boxes: boundingBoxes,
  };
  if (outlines) body.outlines = outlines;
  if (toolDiameter !== undefined) body.tool_diameter = toolDiameter;
  return requestJson<{ valid: boolean; warnings: string[] }>(
    `${API_BASE_URL}/api/validate-placement`,
    jsonPost(body),
    "Validation failed"
  );
}

export async function autoNesting(
  objects: BrepObject[],
  sheet: SheetSettings,
  toolDiameter: number = DEFAULT_TOOL_DIAMETER_MM,
  clearance: number = DEFAULT_CLEARANCE_MM,
): Promise<AutoNestingResponse> {
  return requestJson<AutoNestingResponse>(
    `${API_BASE_URL}/api/auto-nesting`,
    jsonPost({
      objects,
      sheet,
      tool_diameter: toolDiameter,
      clearance,
    }),
    "Auto nesting failed"
  );
}

export async function generateSbpZip(
  operations: OperationAssignment[],
  detectedOperations: OperationDetectResult,
  sheet: SheetSettings,
  placements: PlacementItem[],
  objectOrigins: Record<string, [number, number]>,
  boundingBoxes: Record<string, BoundingBox>,
  postProcessor: PostProcessorSettings,
): Promise<Blob> {
  return requestBlob(
    `${API_BASE_URL}/api/generate-sbp-zip`,
    jsonPost({
      operations,
      detected_operations: detectedOperations,
      sheet,
      placements,
      object_origins: objectOrigins,
      bounding_boxes: boundingBoxes,
      post_processor: postProcessor,
    }),
    "ZIP generation failed"
  );
}

/** AI CAD API */

export async function generateAiCad(
  prompt: string,
  imageBase64?: string,
  model?: string,
  profile?: string,
): Promise<AiCadResult> {
  return requestJson<AiCadResult>(
    `${API_BASE_URL}/ai-cad/generate`,
    jsonPost({ prompt, image_base64: imageBase64, model, profile }),
    "AI generation failed"
  );
}

export async function executeAiCadCode(code: string): Promise<AiCadResult> {
  return requestJson<AiCadResult>(
    `${API_BASE_URL}/ai-cad/execute`,
    jsonPost({ code }),
    "Code execution failed"
  );
}

export async function fetchAiCadModels(): Promise<ModelInfo[]> {
  return requestJson<ModelInfo[]>(
    `${API_BASE_URL}/ai-cad/models`,
    undefined,
    "Failed to fetch models"
  );
}

export async function fetchAiCadProfiles(): Promise<ProfileInfo[]> {
  return requestJson<ProfileInfo[]>(
    `${API_BASE_URL}/ai-cad/profiles`,
    undefined,
    "Failed to fetch profiles"
  );
}

export async function fetchAiCadLibrary(
  search?: string,
): Promise<GenerationSummary[]> {
  const params = search ? `?search=${encodeURIComponent(search)}` : "";
  return requestJson<GenerationSummary[]>(
    `${API_BASE_URL}/ai-cad/library${params}`,
    undefined,
    "Failed to fetch library"
  );
}

export async function loadAiCadGeneration(
  genId: string,
): Promise<AiCadResult> {
  return requestJson<AiCadResult>(
    `${API_BASE_URL}/ai-cad/library/${genId}`,
    undefined,
    "Failed to load generation"
  );
}
