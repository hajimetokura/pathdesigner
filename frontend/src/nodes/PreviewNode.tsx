import { memo, useState, useEffect, useCallback } from "react";
import { type NodeProps, useReactFlow } from "@xyflow/react";
import LabeledHandle from "./LabeledHandle";
import { useUpstreamData } from "../hooks/useUpstreamData";
import { usePanelTabs } from "../contexts/PanelTabsContext";
import MeshViewer from "../components/MeshViewer";
import BrepImportPanel from "../components/BrepImportPanel";
import { fetchMeshData } from "../api";
import type { BrepImportResult, ObjectMesh } from "../types";

function PreviewNodeInner({ id }: NodeProps) {
  const { setNodes } = useReactFlow();
  const { openTab } = usePanelTabs();

  const brepResult = useUpstreamData<BrepImportResult>(
    id,
    `${id}-brep`,
    (d) => d.brepResult as BrepImportResult | undefined,
  );

  const [meshes, setMeshes] = useState<ObjectMesh[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch mesh data when brepResult changes
  useEffect(() => {
    // Clear previous meshes immediately on any upstream change
    setMeshes([]);
    if (!brepResult?.file_id) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchMeshData(brepResult.file_id)
      .then((data) => {
        if (!cancelled) setMeshes(data.objects);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Mesh fetch failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [brepResult]);

  // Pass-through brepResult to downstream
  useEffect(() => {
    setNodes((nodes) =>
      nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, brepResult: brepResult ?? null } } : n,
      ),
    );
  }, [id, brepResult, setNodes]);

  // Open side panel with full 3D view
  const handleExpand = useCallback(() => {
    if (!brepResult) return;
    openTab({
      id: `preview-3d-${id}`,
      label: "3D View",
      icon: "📦",
      content: <BrepImportPanel brepResult={brepResult} meshes={meshes} />,
    });
  }, [id, brepResult, meshes, openTab]);

  return (
    <div style={{ background: "#1e1e1e", borderRadius: 8, padding: 8, width: 220 }}>
      <LabeledHandle type="target" id={`${id}-brep`} label="brep" dataType="geometry" />

      <div style={{ fontSize: 11, color: "#ccc", marginBottom: 4, fontWeight: 600 }}>
        3D Preview
      </div>

      <div
        className="nodrag nopan nowheel"
        style={{ width: 200, height: 150, borderRadius: 4, overflow: "hidden", background: "#111", cursor: brepResult ? "pointer" : "default" }}
        onClick={handleExpand}
      >
        {!brepResult && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#666", fontSize: 11 }}>
            Connect upstream node
          </div>
        )}
        {brepResult && loading && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#888", fontSize: 11 }}>
            Loading...
          </div>
        )}
        {brepResult && error && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#f44", fontSize: 11 }}>
            {error}
          </div>
        )}
        {brepResult && !loading && !error && meshes.length > 0 && (
          <MeshViewer meshes={meshes} style={{ width: 200, height: 150 }} />
        )}
      </div>

      <LabeledHandle type="source" id={`${id}-out`} label="out" dataType="geometry" />
    </div>
  );
}

export const PreviewNode = memo(PreviewNodeInner);
