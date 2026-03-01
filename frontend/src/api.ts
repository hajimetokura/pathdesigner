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
  AiCadStageEvent,
  AiCadRefineResult,
  GenerationSummary,
  ModelInfo,
  ProfileInfo,
  SnippetInfo,
  SnippetListResponse,
  SnippetSaveRequest,
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

export async function alignParts(fileId: string): Promise<BrepImportResult> {
  return requestJson<BrepImportResult>(
    `${API_BASE_URL}/api/align-parts`,
    jsonPost({ file_id: fileId }),
    "Align failed",
  );
}

export async function mergeBReps(fileIds: string[]): Promise<BrepImportResult> {
  return requestJson<BrepImportResult>(
    `${API_BASE_URL}/api/merge-breps`,
    jsonPost({ file_ids: fileIds }),
    "Merge failed",
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

import { parseSSEStream } from "./utils/parseSSEStream";

export interface SketchDetailEvent {
  key: string;
  value: string;
}

export interface CoderModelInfo {
  id: string;
  name: string;
  is_default: boolean;
}

export async function generateAiCadStream(
  prompt: string,
  profile?: string,
  onStage?: (event: AiCadStageEvent) => void,
  imageBase64?: string,
  coderModel?: string,
  onDetail?: (event: SketchDetailEvent) => void,
): Promise<AiCadResult> {
  const body: Record<string, string | undefined> = { prompt, profile };
  if (imageBase64) body.image_base64 = imageBase64;
  if (coderModel) body.coder_model = coderModel;

  const response = await fetch(`${API_BASE_URL}/ai-cad/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`AI generation failed: ${response.status}`);
  }

  return parseSSEStream<AiCadResult>(response, {
    onStage: onStage as (data: { stage: string; message: string }) => void,
    onDetail: onDetail,
  });
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

export async function refineAiCadStream(
  generationId: string,
  message: string,
  history: { role: string; content: string }[],
  currentCode: string,
  profile?: string,
  onStage?: (event: AiCadStageEvent) => void,
): Promise<AiCadRefineResult> {
  const response = await fetch(`${API_BASE_URL}/ai-cad/refine`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      generation_id: generationId,
      message,
      history,
      current_code: currentCode,
      profile,
    }),
  });

  if (!response.ok) {
    throw new Error(`Refine failed: ${response.status}`);
  }

  return parseSSEStream<AiCadRefineResult>(response, {
    onStage: onStage as (data: { stage: string; message: string }) => void,
  });
}

// ── Snippet DB ────────────────────────────────────────────────────────────────

export async function saveSnippet(req: SnippetSaveRequest): Promise<SnippetInfo> {
  const res = await fetch(`${API_BASE_URL}/snippets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listSnippets(q?: string): Promise<SnippetListResponse> {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  const res = await fetch(`${API_BASE_URL}/snippets?${params}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteSnippet(id: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/snippets/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}

export async function executeSnippet(id: string): Promise<AiCadResult> {
  const res = await fetch(`${API_BASE_URL}/snippets/${id}/execute`, { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchCoderModels(): Promise<CoderModelInfo[]> {
  const models = await fetchAiCadModels();
  return models.map((m) => ({ id: m.id, name: m.name, is_default: m.is_default }));
}
