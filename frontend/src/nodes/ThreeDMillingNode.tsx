import { useCallback, useState } from "react";
import { type NodeProps, useReactFlow } from "@xyflow/react";
import { generate3dRoughing } from "../api";
import type { MeshImportResult, ThreeDRoughingResult } from "../types";
import LabeledHandle from "./LabeledHandle";
import NodeShell from "../components/NodeShell";
import { useUpstreamData } from "../hooks/useUpstreamData";

type Status = "idle" | "loading" | "success" | "error";

export default function ThreeDMillingNode({ id, selected }: NodeProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<ThreeDRoughingResult | null>(null);
  const [error, setError] = useState("");
  const { setNodes } = useReactFlow();

  // Parameters
  const [zStep, setZStep] = useState(3.0);
  const [stockToLeave, setStockToLeave] = useState(0.5);
  const [toolDiameter, setToolDiameter] = useState(6.0);
  const [toolType, setToolType] = useState<string>("ballnose");
  const [toolFlutes, setToolFlutes] = useState(2);
  const [feedXY, setFeedXY] = useState(20);
  const [feedZ, setFeedZ] = useState(10);
  const [spindleSpeed, setSpindleSpeed] = useState(18000);

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

  const handleGenerate = useCallback(async () => {
    if (!meshData?.mesh_file_path) return;
    setStatus("loading");
    setError("");
    try {
      const res = await generate3dRoughing(
        meshData.mesh_file_path,
        zStep,
        stockToLeave,
        { diameter: toolDiameter, type: toolType, flutes: toolFlutes },
        { xy: feedXY, z: feedZ },
        spindleSpeed,
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
  }, [
    meshData,
    zStep,
    stockToLeave,
    toolDiameter,
    toolType,
    toolFlutes,
    feedXY,
    feedZ,
    spindleSpeed,
    id,
    setNodes,
  ]);

  // Count Z levels and total passes from result
  const zLevels = result
    ? new Set(result.toolpaths.flatMap((tp) => tp.passes.map((p) => p.z_depth)))
        .size
    : 0;
  const totalPasses = result
    ? result.toolpaths.reduce((sum, tp) => sum + tp.passes.length, 0)
    : 0;

  return (
    <NodeShell category="cam" selected={selected}>
      <LabeledHandle
        type="target"
        id={`${id}-mesh`}
        label="mesh"
        dataType="geometry"
        index={0}
        total={1}
      />

      <div style={headerStyle}>3D Milling</div>

      {!meshData && status !== "loading" && (
        <div style={{ color: "var(--text-muted)", fontSize: 11 }}>
          Connect Mesh Import
        </div>
      )}

      {/* Roughing Parameters */}
      <div style={sectionStyle}>
        <div style={labelStyle}>Z Step (mm)</div>
        <input
          type="number"
          value={zStep}
          min={0.1}
          step={0.5}
          onChange={(e) => setZStep(Number(e.target.value))}
          style={inputStyle}
        />

        <div style={labelStyle}>Stock to Leave (mm)</div>
        <input
          type="number"
          value={stockToLeave}
          min={0}
          step={0.1}
          onChange={(e) => setStockToLeave(Number(e.target.value))}
          style={inputStyle}
        />

        <div style={labelStyle}>Tool Diameter (mm)</div>
        <input
          type="number"
          value={toolDiameter}
          min={0.1}
          step={0.5}
          onChange={(e) => setToolDiameter(Number(e.target.value))}
          style={inputStyle}
        />

        <div style={labelStyle}>Tool Type</div>
        <select
          value={toolType}
          onChange={(e) => setToolType(e.target.value)}
          style={inputStyle}
        >
          <option value="ballnose">Ballnose</option>
          <option value="endmill">Endmill</option>
          <option value="v_bit">V-Bit</option>
        </select>

        <div style={labelStyle}>Flutes</div>
        <input
          type="number"
          value={toolFlutes}
          min={1}
          max={8}
          onChange={(e) => setToolFlutes(Number(e.target.value))}
          style={inputStyle}
        />

        <div style={labelStyle}>Feed XY (mm/s)</div>
        <input
          type="number"
          value={feedXY}
          min={1}
          step={1}
          onChange={(e) => setFeedXY(Number(e.target.value))}
          style={inputStyle}
        />

        <div style={labelStyle}>Feed Z (mm/s)</div>
        <input
          type="number"
          value={feedZ}
          min={1}
          step={1}
          onChange={(e) => setFeedZ(Number(e.target.value))}
          style={inputStyle}
        />

        <div style={labelStyle}>Spindle Speed (RPM)</div>
        <input
          type="number"
          value={spindleSpeed}
          min={1000}
          step={1000}
          onChange={(e) => setSpindleSpeed(Number(e.target.value))}
          style={inputStyle}
        />
      </div>

      {/* Generate Button */}
      <button
        onClick={handleGenerate}
        disabled={!meshData || status === "loading"}
        style={{
          ...buttonStyle,
          opacity: !meshData || status === "loading" ? 0.5 : 1,
          cursor: !meshData || status === "loading" ? "not-allowed" : "pointer",
        }}
      >
        {status === "loading" ? "Generating..." : "Generate Roughing"}
      </button>

      {/* Error */}
      {status === "error" && (
        <div style={{ color: "var(--color-error)", fontSize: 11, marginTop: 4 }}>
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

const sectionStyle: React.CSSProperties = {
  background: "var(--surface-bg)",
  borderRadius: 6,
  padding: "8px 10px",
  marginBottom: 8,
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-muted)",
  marginBottom: 2,
  marginTop: 6,
};

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "3px 6px",
  fontSize: 12,
  border: "1px solid var(--border-subtle)",
  borderRadius: 4,
  background: "var(--surface-bg)",
  color: "var(--text-primary)",
  boxSizing: "border-box",
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
