import { useCallback, useState } from "react";
import { Handle, Position, type NodeProps, useReactFlow } from "@xyflow/react";
import { extractContours } from "../api";
import type { ContourExtractResult } from "../types";

type Status = "idle" | "loading" | "success" | "error";

export default function ContourExtractNode({ id }: NodeProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<ContourExtractResult | null>(null);
  const [error, setError] = useState("");
  const { getNode, getEdges } = useReactFlow();

  const handleExtract = useCallback(async () => {
    // Find connected BREP Import node to get file_id and object_id
    const edges = getEdges();
    const incomingEdge = edges.find(
      (e) => e.target === id && e.source === "1"
    );
    if (!incomingEdge) {
      setError("Connect BREP Import node first");
      setStatus("error");
      return;
    }

    const sourceNode = getNode(incomingEdge.source);
    const brepData = sourceNode?.data?.brepResult as
      | { file_id: string; objects: { object_id: string }[] }
      | undefined;

    if (!brepData?.file_id) {
      setError("Upload a STEP file in BREP Import first");
      setStatus("error");
      return;
    }

    setStatus("loading");
    setError("");

    try {
      const data = await extractContours(
        brepData.file_id,
        brepData.objects[0].object_id
      );
      setResult(data);
      setStatus("success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed");
      setStatus("error");
    }
  }, [id, getNode, getEdges]);

  return (
    <div style={nodeStyle}>
      <Handle type="target" position={Position.Top} id={`${id}-in`} />

      <div style={headerStyle}>Contour Extract</div>

      <button
        onClick={handleExtract}
        disabled={status === "loading"}
        style={buttonStyle}
      >
        {status === "loading" ? "Extracting..." : "Extract Contours"}
      </button>

      {status === "error" && (
        <div style={{ color: "#d32f2f", fontSize: 11, padding: "4px 0" }}>
          {error}
        </div>
      )}

      {status === "success" && result && (
        <div style={resultStyle}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {result.contours.length} contour
            {result.contours.length > 1 ? "s" : ""}
          </div>
          <div style={{ fontSize: 11, color: "#555" }}>
            Z: {result.slice_z} mm
          </div>
          {result.contours.map((c) => (
            <div key={c.id} style={contourStyle}>
              <div style={{ fontSize: 11 }}>
                {c.id}: {c.type}
              </div>
              <div style={{ fontSize: 10, color: "#777" }}>
                {c.coords.length} points
                {c.closed ? " (closed)" : " (open)"}
              </div>
            </div>
          ))}
          <div style={{ fontSize: 11, marginTop: 4, color: "#555" }}>
            Offset: {result.offset_applied.distance.toFixed(3)} mm{" "}
            ({result.offset_applied.side})
          </div>
        </div>
      )}

      <Handle type="source" position={Position.Bottom} id={`${id}-out`} />
    </div>
  );
}

const nodeStyle: React.CSSProperties = {
  background: "white",
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: 12,
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
  border: "1px solid #4a90d9",
  borderRadius: 6,
  background: "#4a90d9",
  color: "white",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};

const resultStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 12,
};

const contourStyle: React.CSSProperties = {
  background: "#f5f5f5",
  borderRadius: 4,
  padding: "6px 8px",
  marginTop: 4,
};
