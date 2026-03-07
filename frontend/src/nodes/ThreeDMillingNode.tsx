import { useCallback, useState } from "react";
import { type NodeProps, useReactFlow } from "@xyflow/react";
import { generate3dRoughing } from "../api";
import type {
  MeshImportResult,
  OperationAssignment,
  ThreeDRoughingResult,
} from "../types";
import LabeledHandle from "./LabeledHandle";
import NodeShell from "../components/NodeShell";
import { useUpstreamData } from "../hooks/useUpstreamData";

type Status = "idle" | "loading" | "success" | "error";

export default function ThreeDMillingNode({ id, selected }: NodeProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<ThreeDRoughingResult | null>(null);
  const [error, setError] = useState("");
  const { setNodes } = useReactFlow();

  // Read upstream MeshImportNode data
  const extractMesh = useCallback(
    (d: Record<string, unknown>): MeshImportResult | undefined => {
      const br = d.brepResult as MeshImportResult | undefined;
      if (br && br.mesh_file_path) return br;
      return undefined;
    },
    [],
  );
  const meshData = useUpstreamData(id, `${id}-mesh`, extractMesh);

  // Read upstream OperationNode — find enabled 3d_roughing assignment
  const extractRoughing = useCallback(
    (d: Record<string, unknown>): OperationAssignment | undefined => {
      const assignments = d.assignments as OperationAssignment[] | undefined;
      if (!assignments?.length) return undefined;
      return assignments.find(
        (a) => a.settings.operation_type === "3d_roughing" && a.enabled,
      );
    },
    [],
  );
  const roughingAssignment = useUpstreamData(
    id,
    `${id}-operations`,
    extractRoughing,
  );

  const handleGenerate = useCallback(async () => {
    if (!meshData?.mesh_file_path) return;
    setStatus("loading");
    setError("");
    try {
      const s = roughingAssignment?.settings;
      const res = await generate3dRoughing(
        meshData.mesh_file_path,
        s?.z_step ?? 3.0,
        s?.stock_to_leave ?? 0.5,
        s
          ? {
              diameter: s.tool.diameter,
              type: s.tool.type,
              flutes: s.tool.flutes,
            }
          : undefined,
        s ? { xy: s.feed_rate.xy, z: s.feed_rate.z } : undefined,
        s?.spindle_speed,
      );
      setResult(res);
      setStatus("success");
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id
            ? { ...n, data: { ...n.data, toolpathResult: res } }
            : n,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
      setStatus("error");
    }
  }, [meshData, roughingAssignment, id, setNodes]);

  // Count Z levels and total passes from result
  const zLevels = result
    ? new Set(
        result.toolpaths.flatMap((tp) => tp.passes.map((p) => p.z_depth)),
      ).size
    : 0;
  const totalPasses = result
    ? result.toolpaths.reduce((sum, tp) => sum + tp.passes.length, 0)
    : 0;

  // Summary of current settings from upstream
  const settingsLabel = roughingAssignment
    ? `z=${roughingAssignment.settings.z_step ?? 3}mm / ${roughingAssignment.settings.tool.type} ${roughingAssignment.settings.tool.diameter}mm`
    : null;

  return (
    <NodeShell category="cam" selected={selected}>
      <LabeledHandle
        type="target"
        id={`${id}-mesh`}
        label="mesh"
        dataType="geometry"
        index={0}
        total={2}
      />
      <LabeledHandle
        type="target"
        id={`${id}-operations`}
        label="operations"
        dataType="geometry"
        index={1}
        total={2}
      />

      <div style={headerStyle}>3D Milling</div>

      {!meshData && status !== "loading" && (
        <div style={{ color: "var(--text-muted)", fontSize: 11 }}>
          Connect Mesh Import
        </div>
      )}

      {!roughingAssignment && meshData && status !== "loading" && (
        <div style={{ color: "var(--text-muted)", fontSize: 11 }}>
          Connect Operation node
        </div>
      )}

      {settingsLabel && (
        <div style={settingsBadgeStyle}>{settingsLabel}</div>
      )}

      {/* Generate Button */}
      <button
        onClick={handleGenerate}
        disabled={!meshData || status === "loading"}
        style={{
          ...buttonStyle,
          opacity: !meshData || status === "loading" ? 0.5 : 1,
          cursor:
            !meshData || status === "loading" ? "not-allowed" : "pointer",
        }}
      >
        {status === "loading" ? "Generating..." : "Generate Roughing"}
      </button>

      {/* Error */}
      {status === "error" && (
        <div
          style={{ color: "var(--color-error)", fontSize: 11, marginTop: 4 }}
        >
          {error}
        </div>
      )}

      {/* Result Summary */}
      {status === "success" && result && (
        <div style={resultStyle}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {result.toolpaths.length} toolpath
            {result.toolpaths.length !== 1 ? "s" : ""}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {zLevels} Z level{zLevels !== 1 ? "s" : ""} / {totalPasses} pass
            {totalPasses !== 1 ? "es" : ""}
          </div>
        </div>
      )}

      <LabeledHandle
        type="source"
        id={`${id}-roughing`}
        label="roughing"
        dataType="toolpath"
        index={0}
        total={1}
      />
    </NodeShell>
  );
}

/* --- Styles --- */

const headerStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 13,
  marginBottom: 8,
  color: "var(--text-primary)",
};

const settingsBadgeStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--text-secondary)",
  background: "var(--surface-bg)",
  borderRadius: "var(--radius-item)",
  padding: "3px 8px",
  marginBottom: 6,
};

const buttonStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 0",
  fontSize: 12,
  fontWeight: 600,
  color: "#fff",
  background: "var(--color-cam)",
  border: "none",
  borderRadius: 6,
  marginBottom: 4,
};

const resultStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 12,
};
