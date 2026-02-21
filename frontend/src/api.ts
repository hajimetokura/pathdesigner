import type { BrepImportResult } from "./types";

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
