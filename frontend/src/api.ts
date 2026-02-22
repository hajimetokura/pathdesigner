import type { BrepImportResult, ContourExtractResult, PresetItem, ValidateSettingsResponse, MachiningSettings, PostProcessorSettings, ToolpathGenResult, SbpGenResult } from "./types";

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

export async function generateToolpath(
  contourResult: ContourExtractResult,
  machiningSettings: MachiningSettings
): Promise<ToolpathGenResult> {
  const res = await fetch(`${API_URL}/api/generate-toolpath`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contour_result: contourResult,
      machining_settings: machiningSettings,
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
  machiningSettings: MachiningSettings,
  postProcessor: PostProcessorSettings
): Promise<SbpGenResult> {
  const res = await fetch(`${API_URL}/api/generate-sbp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      toolpath_result: toolpathResult,
      machining_settings: machiningSettings,
      post_processor: postProcessor,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "SBP generation failed" }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}
