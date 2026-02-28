import { memo, useState, useEffect, useCallback } from "react";
import { type NodeProps, useReactFlow } from "@xyflow/react";
import LabeledHandle from "./LabeledHandle";
import NodeShell from "../components/NodeShell";
import { useUpstreamData } from "../hooks/useUpstreamData";
import { usePanelTabs } from "../contexts/PanelTabsContext";
import MeshViewer from "../components/MeshViewer";
import BrepImportPanel from "../components/BrepImportPanel";
import { fetchMeshData } from "../api";
import type { BrepImportResult, ObjectMesh } from "../types";

function PreviewNodeInner({ id, selected }: NodeProps) {
  const { setNodes } = useReactFlow();
  const { openTab, updateTab } = usePanelTabs();

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
  const tabId = `preview-3d-${id}`;
  const handleExpand = useCallback(() => {
    if (!brepResult) return;
    openTab({
      id: tabId,
      label: "3D View",
      icon: "📦",
      content: <BrepImportPanel brepResult={brepResult} meshes={meshes} />,
    });
  }, [tabId, brepResult, meshes, openTab]);

  // Auto-update panel content when data changes
  useEffect(() => {
    if (!brepResult || meshes.length === 0) return;
    updateTab({
      id: tabId,
      label: "3D View",
      icon: "📦",
      content: <BrepImportPanel brepResult={brepResult} meshes={meshes} />,
    });
  }, [tabId, brepResult, meshes, updateTab]);

  return (
    <NodeShell category="cad" selected={selected}>
      <LabeledHandle type="target" id={`${id}-brep`} label="brep" dataType="geometry" />

      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: "var(--text-primary)" }}>
        3D Preview
      </div>

      <div
        className="nodrag nopan nowheel"
        style={{ width: "100%", height: 150, borderRadius: "var(--radius-control)", overflow: "hidden", background: "var(--surface-bg)", cursor: brepResult ? "pointer" : "default" }}
        onClick={handleExpand}
      >
        {!brepResult && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", fontSize: 11 }}>
            Connect upstream node
          </div>
        )}
        {brepResult && loading && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-secondary)", fontSize: 11 }}>
            Loading...
          </div>
        )}
        {brepResult && error && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--color-error)", fontSize: 11 }}>
            {error}
          </div>
        )}
        {brepResult && !loading && !error && meshes.length > 0 && (
          <MeshViewer meshes={meshes} style={{ width: "100%", height: 150 }} />
        )}
      </div>

      <LabeledHandle type="source" id={`${id}-out`} label="out" dataType="geometry" />
    </NodeShell>
  );
}

export const PreviewNode = memo(PreviewNodeInner);
