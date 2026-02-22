import { useCallback, useState } from "react";
import { Position, type NodeProps, useReactFlow } from "@xyflow/react";
import { generateToolpath, generateSbp } from "../api";
import type {
  OperationDetectResult,
  OperationAssignment,
  StockSettings,
  PostProcessorSettings,
  ToolpathGenResult,
  SbpGenResult,
} from "../types";
import LabeledHandle from "./LabeledHandle";

type Status = "idle" | "loading" | "success" | "error";

export default function ToolpathGenNode({ id }: NodeProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [toolpathResult, setToolpathResult] = useState<ToolpathGenResult | null>(null);
  const [sbpResult, setSbpResult] = useState<SbpGenResult | null>(null);
  const [error, setError] = useState("");
  const { getNode, getEdges, setNodes } = useReactFlow();

  const handleGenerate = useCallback(async () => {
    const edges = getEdges();

    // 1. Find operations data from OperationNode
    const opsEdge = edges.find(
      (e) => e.target === id && e.targetHandle === `${id}-operations`
    );
    if (!opsEdge) {
      setError("Connect Operation node first");
      setStatus("error");
      return;
    }
    const opsNode = getNode(opsEdge.source);
    const detectedOperations = opsNode?.data?.detectedOperations as
      | OperationDetectResult
      | undefined;
    const assignments = opsNode?.data?.assignments as
      | OperationAssignment[]
      | undefined;
    if (!detectedOperations || !assignments || assignments.length === 0) {
      setError("Run Detect Operations first");
      setStatus("error");
      return;
    }

    // 2. Get stock settings from OperationNode (passed through)
    const stockSettings = opsNode?.data?.stockSettings as
      | StockSettings
      | undefined;
    if (!stockSettings || stockSettings.materials.length === 0) {
      setError("Configure Stock settings first");
      setStatus("error");
      return;
    }

    // 3. Find post processor settings
    const ppEdge = edges.find(
      (e) => e.target === id && e.targetHandle === `${id}-postprocessor`
    );
    if (!ppEdge) {
      setError("Connect Post Processor node first");
      setStatus("error");
      return;
    }
    const ppNode = getNode(ppEdge.source);
    const postProcessorSettings = ppNode?.data?.postProcessorSettings as
      | PostProcessorSettings
      | undefined;
    if (!postProcessorSettings) {
      setError("Configure Post Processor first");
      setStatus("error");
      return;
    }

    setStatus("loading");
    setError("");

    try {
      // 4. Generate toolpath from operations
      const tpResult = await generateToolpath(
        assignments,
        detectedOperations,
        stockSettings
      );
      setToolpathResult(tpResult);

      // 5. Generate SBP
      const sbp = await generateSbp(
        tpResult,
        assignments,
        stockSettings,
        postProcessorSettings
      );
      setSbpResult(sbp);

      setStatus("success");

      // Store results in node data
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id
            ? { ...n, data: { ...n.data, toolpathResult: tpResult, sbpResult: sbp } }
            : n
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
      setStatus("error");
    }
  }, [id, getNode, getEdges, setNodes]);

  const handleDownload = useCallback(() => {
    if (!sbpResult) return;
    const blob = new Blob([sbpResult.sbp_code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = sbpResult.filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [sbpResult]);

  return (
    <div style={nodeStyle}>
      <LabeledHandle
        type="target"
        position={Position.Top}
        id={`${id}-operations`}
        label="operations"
        dataType="geometry"
        index={0}
        total={2}
      />
      <LabeledHandle
        type="target"
        position={Position.Top}
        id={`${id}-postprocessor`}
        label="post proc"
        dataType="settings"
        index={1}
        total={2}
      />

      <div style={headerStyle}>Toolpath Gen</div>

      <button
        onClick={handleGenerate}
        disabled={status === "loading"}
        style={buttonStyle}
      >
        {status === "loading" ? "Generating..." : "Generate"}
      </button>

      {status === "error" && (
        <div style={{ color: "#d32f2f", fontSize: 11, padding: "4px 0" }}>
          {error}
        </div>
      )}

      {status === "success" && toolpathResult && (
        <div style={resultStyle}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {toolpathResult.toolpaths.length} toolpath
            {toolpathResult.toolpaths.length > 1 ? "s" : ""}
          </div>
          {toolpathResult.toolpaths.map((tp) => (
            <div key={tp.operation_id} style={detailStyle}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#333" }}>
                {tp.operation_id}
              </div>
              <div style={{ fontSize: 11, color: "#555" }}>
                {tp.passes.length} passes
              </div>
              <div style={{ fontSize: 10, color: "#777" }}>
                Z: {tp.passes.map((p) => p.z_depth.toFixed(1)).join(" → ")}
              </div>
            </div>
          ))}

          {sbpResult && (
            <button onClick={handleDownload} style={downloadStyle}>
              Download SBP
            </button>
          )}
        </div>
      )}

      <LabeledHandle
        type="source"
        position={Position.Bottom}
        id={`${id}-out`}
        label="out"
        dataType="toolpath"
      />
    </div>
  );
}

/* --- Styles --- */

const nodeStyle: React.CSSProperties = {
  background: "white",
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: "20px 12px",
  minWidth: 200,
  maxWidth: 280,
  boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
};

const headerStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 13,
  marginBottom: 8,
  color: "#333",
};

const buttonStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  border: "1px solid #ff9800",
  borderRadius: 6,
  background: "#ff9800",
  color: "white",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};

const resultStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 12,
};

const detailStyle: React.CSSProperties = {
  background: "#f5f5f5",
  borderRadius: 4,
  padding: "6px 8px",
  marginTop: 4,
};

const downloadStyle: React.CSSProperties = {
  width: "100%",
  marginTop: 8,
  padding: "8px 12px",
  border: "1px solid #66bb6a",
  borderRadius: 6,
  background: "#66bb6a",
  color: "white",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};
