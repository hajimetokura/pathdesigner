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
  StockSettings,
  PostProcessorSettings,
  ToolpathGenResult,
  OutputResult,
  MeshDataResult,
  PlacementItem,
  AutoNestingResponse,
} from "./types";

const API_URL = "http://localhost:8000";

export async function uploadStepFile(file: File): Promise<BrepImportResult> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_URL}/api/upload-step`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Upload failed" }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }

  return res.json();
}

export async function extractContours(
  fileId: string,
  objectId: string,
  toolDiameter: number = 6.35,
  offsetSide: string = "outside"
): Promise<ContourExtractResult> {
  const res = await fetch(`${API_URL}/api/extract-contours`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_id: fileId,
      object_id: objectId,
      tool_diameter: toolDiameter,
      offset_side: offsetSide,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Extraction failed" }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }

  return res.json();
}

export async function fetchPresets(): Promise<PresetItem[]> {
  const res = await fetch(`${API_URL}/api/presets`);
  if (!res.ok) {
    throw new Error(`Failed to fetch presets: HTTP ${res.status}`);
  }
  return res.json();
}

export async function validateSettings(
  settings: MachiningSettings
): Promise<ValidateSettingsResponse> {
  const res = await fetch(`${API_URL}/api/validate-settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Validation failed" }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function detectOperations(
  fileId: string,
  objectIds: string[],
  toolDiameter: number = 6.35,
  offsetSide: string = "outside"
): Promise<OperationDetectResult> {
  const res = await fetch(`${API_URL}/api/detect-operations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_id: fileId,
      object_ids: objectIds,
      tool_diameter: toolDiameter,
      offset_side: offsetSide,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Detection failed" }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function generateToolpath(
  operations: OperationAssignment[],
  detectedOperations: OperationDetectResult,
  stock: StockSettings,
  placements: PlacementItem[] = [],
  objectOrigins: Record<string, [number, number]> = {}
): Promise<ToolpathGenResult> {
  const res = await fetch(`${API_URL}/api/generate-toolpath`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operations,
      detected_operations: detectedOperations,
      stock,
      placements,
      object_origins: objectOrigins,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Toolpath generation failed" }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function generateSbp(
  toolpathResult: ToolpathGenResult,
  operations: OperationAssignment[],
  stock: StockSettings,
  postProcessor: PostProcessorSettings
): Promise<OutputResult> {
  const res = await fetch(`${API_URL}/api/generate-sbp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      toolpath_result: toolpathResult,
      operations,
      stock,
      post_processor: postProcessor,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "SBP generation failed" }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchMeshData(
  fileId: string
): Promise<MeshDataResult> {
  const res = await fetch(`${API_URL}/api/mesh-data`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Mesh data fetch failed" }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function validatePlacement(
  placements: PlacementItem[],
  stock: StockSettings,
  boundingBoxes: Record<string, BoundingBox>,
  outlines?: Record<string, number[][]>,
  toolDiameter?: number,
): Promise<{ valid: boolean; warnings: string[] }> {
  const body: Record<string, unknown> = {
    placements,
    stock,
    bounding_boxes: boundingBoxes,
  };
  if (outlines) body.outlines = outlines;
  if (toolDiameter !== undefined) body.tool_diameter = toolDiameter;
  const res = await fetch(`${API_URL}/api/validate-placement`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Validation failed" }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function autoNesting(
  objects: BrepObject[],
  stock: StockSettings,
  toolDiameter: number = 6.35,
  clearance: number = 5.0,
): Promise<AutoNestingResponse> {
  const res = await fetch(`${API_URL}/api/auto-nesting`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      objects,
      stock,
      tool_diameter: toolDiameter,
      clearance,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Auto nesting failed" }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function generateSbpZip(
  operations: OperationAssignment[],
  detectedOperations: OperationDetectResult,
  stock: StockSettings,
  placements: PlacementItem[],
  objectOrigins: Record<string, [number, number]>,
  boundingBoxes: Record<string, BoundingBox>,
  postProcessor: PostProcessorSettings,
): Promise<Blob> {
  const res = await fetch(`${API_URL}/api/generate-sbp-zip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operations,
      detected_operations: detectedOperations,
      stock,
      placements,
      object_origins: objectOrigins,
      bounding_boxes: boundingBoxes,
      post_processor: postProcessor,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "ZIP generation failed" }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.blob();
}
