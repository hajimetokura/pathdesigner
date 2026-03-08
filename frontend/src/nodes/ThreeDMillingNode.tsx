import { useCallback, useState } from "react";
import { type NodeProps, useReactFlow } from "@xyflow/react";
import { generate3dRoughing, generate3dFinishing } from "../api";
import type {
  MeshImportResult,
  OperationAssignment,
  ThreeDRoughingResult,
  ThreeDFinishingResult,
} from "../types";
import LabeledHandle from "./LabeledHandle";
import NodeShell from "../components/NodeShell";
import { useUpstreamData } from "../hooks/useUpstreamData";

type Status = "idle" | "loading" | "success" | "error";

export default function ThreeDMillingNode({ id, selected }: NodeProps) {
  const [roughingStatus, setRoughingStatus] = useState<Status>("idle");
  const [roughingResult, setRoughingResult] =
    useState<ThreeDRoughingResult | null>(null);
  const [roughingError, setRoughingError] = useState("");

  const [finishingStatus, setFinishingStatus] = useState<Status>("idle");
  const [finishingResult, setFinishingResult] =
    useState<ThreeDFinishingResult | null>(null);
  const [finishingError, setFinishingError] = useState("");

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

  // Read upstream OperationNode — find enabled 3d_finishing assignment
  const extractFinishing = useCallback(
    (d: Record<string, unknown>): OperationAssignment | undefined => {
      const assignments = d.assignments as OperationAssignment[] | undefined;
      if (!assignments?.length) return undefined;
      return assignments.find(
        (a) => a.settings.operation_type === "3d_finishing" && a.enabled,
      );
    },
    [],
  );
  const finishingAssignment = useUpstreamData(
    id,
    `${id}-operations`,
    extractFinishing,
  );

  const handleGenerateRoughing = useCallback(async () => {
    if (!meshData?.mesh_file_path) return;
    setRoughingStatus("loading");
    setRoughingError("");
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
      setRoughingResult(res);
      setRoughingStatus("success");
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id
            ? { ...n, data: { ...n.data, toolpathResult: res } }
            : n,
        ),
      );
    } catch (e) {
      setRoughingError(e instanceof Error ? e.message : "Generation failed");
      setRoughingStatus("error");
    }
  }, [meshData, roughingAssignment, id, setNodes]);

  const handleGenerateFinishing = useCallback(async () => {
    if (!meshData?.mesh_file_path) return;
    setFinishingStatus("loading");
    setFinishingError("");
    try {
      const s = finishingAssignment?.settings;
      const res = await generate3dFinishing(
        meshData.mesh_file_path,
        s?.stepover_3d ?? 0.15,
        s?.scan_angle ?? 0.0,
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
      setFinishingResult(res);
      setFinishingStatus("success");
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id
            ? { ...n, data: { ...n.data, finishingResult: res } }
            : n,
        ),
      );
    } catch (e) {
      setFinishingError(
        e instanceof Error ? e.message : "Finishing failed",
      );
      setFinishingStatus("error");
    }
  }, [meshData, finishingAssignment, id, setNodes]);

  // Count Z levels and total passes from roughing result
  const roughingZLevels = roughingResult
    ? new Set(
        roughingResult.toolpaths.flatMap((tp) =>
          tp.passes.map((p) => p.z_depth),
        ),
      ).size
    : 0;
  const roughingTotalPasses = roughingResult
    ? roughingResult.toolpaths.reduce((sum, tp) => sum + tp.passes.length, 0)
    : 0;

  // Summary of current settings from upstream
  const roughingLabel = roughingAssignment
    ? `z=${roughingAssignment.settings.z_step ?? 3}mm / ${roughingAssignment.settings.tool.type} ${roughingAssignment.settings.tool.diameter}mm`
    : null;

  const finishingLabel = finishingAssignment
    ? `stepover=${finishingAssignment.settings.stepover_3d ?? 0.15} / ${finishingAssignment.settings.tool.type} ${finishingAssignment.settings.tool.diameter}mm`
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

      {!meshData && roughingStatus !== "loading" && (
        <div style={{ color: "var(--text-muted)", fontSize: 11 }}>
          Connect Mesh Import
        </div>
      )}

      {!roughingAssignment &&
        !finishingAssignment &&
        meshData &&
        roughingStatus !== "loading" && (
          <div style={{ color: "var(--text-muted)", fontSize: 11 }}>
            Connect Operation node
          </div>
        )}

      {/* --- Roughing Section --- */}
      {roughingAssignment && (
        <>
          <div style={sectionLabelStyle}>Roughing</div>
          {roughingLabel && (
            <div style={settingsBadgeStyle}>{roughingLabel}</div>
          )}
          <button
            onClick={handleGenerateRoughing}
            disabled={!meshData || roughingStatus === "loading"}
            style={{
              ...buttonStyle,
              opacity:
                !meshData || roughingStatus === "loading" ? 0.5 : 1,
              cursor:
                !meshData || roughingStatus === "loading"
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            {roughingStatus === "loading"
              ? "Generating..."
              : "Generate Roughing"}
          </button>
          {roughingStatus === "error" && (
            <div style={errorStyle}>{roughingError}</div>
          )}
          {roughingStatus === "success" && roughingResult && (
            <div style={resultStyle}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {roughingResult.toolpaths.length} toolpath
                {roughingResult.toolpaths.length !== 1 ? "s" : ""}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {roughingZLevels} Z level
                {roughingZLevels !== 1 ? "s" : ""} / {roughingTotalPasses}{" "}
                pass
                {roughingTotalPasses !== 1 ? "es" : ""}
              </div>
            </div>
          )}
        </>
      )}

      {/* --- Finishing Section --- */}
      {finishingAssignment && (
        <>
          <div style={{ ...sectionLabelStyle, marginTop: 8 }}>Finishing</div>
          {finishingLabel && (
            <div style={settingsBadgeStyle}>{finishingLabel}</div>
          )}
          <button
            onClick={handleGenerateFinishing}
            disabled={!meshData || finishingStatus === "loading"}
            style={{
              ...buttonStyle,
              background: "var(--color-toolpath, #6366f1)",
              opacity:
                !meshData || finishingStatus === "loading" ? 0.5 : 1,
              cursor:
                !meshData || finishingStatus === "loading"
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            {finishingStatus === "loading"
              ? "Generating..."
              : "Generate Finishing"}
          </button>
          {finishingStatus === "error" && (
            <div style={errorStyle}>{finishingError}</div>
          )}
          {finishingStatus === "success" && finishingResult && (
            <div style={resultStyle}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {finishingResult.toolpaths.length} scan line
                {finishingResult.toolpaths.length !== 1 ? "s" : ""}
              </div>
            </div>
          )}
        </>
      )}

      {/* --- No operation assigned: show default generate button --- */}
      {!roughingAssignment && !finishingAssignment && meshData && (
        <button
          onClick={handleGenerateRoughing}
          disabled={!meshData || roughingStatus === "loading"}
          style={{
            ...buttonStyle,
            opacity: !meshData || roughingStatus === "loading" ? 0.5 : 1,
            cursor:
              !meshData || roughingStatus === "loading"
                ? "not-allowed"
                : "pointer",
          }}
        >
          {roughingStatus === "loading" ? "Generating..." : "Generate Roughing"}
        </button>
      )}

      <LabeledHandle
        type="source"
        id={`${id}-roughing`}
        label="roughing"
        dataType="toolpath"
        index={0}
        total={2}
      />
      <LabeledHandle
        type="source"
        id={`${id}-finishing`}
        label="finishing"
        dataType="toolpath"
        index={1}
        total={2}
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

const sectionLabelStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 11,
  color: "var(--text-secondary)",
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
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

const errorStyle: React.CSSProperties = {
  color: "var(--color-error)",
  fontSize: 11,
  marginTop: 4,
};
