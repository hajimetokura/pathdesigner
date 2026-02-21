import type { BrepImportResult, ContourExtractResult } from "./types";

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
