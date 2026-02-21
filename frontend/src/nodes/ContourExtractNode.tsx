import { useCallback, useState } from "react";
import { Position, type NodeProps, useReactFlow } from "@xyflow/react";
import { extractContours } from "../api";
import type { ContourExtractResult } from "../types";
import LabeledHandle from "./LabeledHandle";

type Status = "idle" | "loading" | "success" | "error";

export default function ContourExtractNode({ id }: NodeProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [results, setResults] = useState<ContourExtractResult[]>([]);
  const [error, setError] = useState("");
  const { getNode, getEdges, setNodes } = useReactFlow();

  const handleExtract = useCallback(async () => {
    // Find connected BREP Import node to get file_id and object_id
    const edges = getEdges();
    const incomingEdge = edges.find(
      (e) => e.target === id && e.targetHandle === `${id}-brep`
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

    // Read machining settings from upstream
    const settingsEdge = edges.find(
      (e) => e.target === id && e.targetHandle === `${id}-settings`
    );
    const settingsNode = settingsEdge ? getNode(settingsEdge.source) : null;
    const machiningSettings = settingsNode?.data?.machiningSettings as
      | { tool: { diameter: number }; offset_side: string }
      | undefined;

    const toolDiameter = machiningSettings?.tool?.diameter ?? 6.35;
    const offsetSide = machiningSettings?.offset_side ?? "outside";

    setStatus("loading");
    setError("");

    try {
      const allResults = await Promise.all(
        brepData.objects.map((obj) =>
          extractContours(brepData.file_id, obj.object_id, toolDiameter, offsetSide)
        )
      );
      setResults(allResults);
      setStatus("success");
      // Store results in node data so downstream nodes can access them
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id
            ? { ...n, data: { ...n.data, contourResult: allResults } }
            : n
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed");
      setStatus("error");
    }
  }, [id, getNode, getEdges, setNodes]);

  return (
    <div style={nodeStyle}>
      <LabeledHandle type="target" position={Position.Top} id={`${id}-brep`} label="brep" dataType="geometry" index={0} total={2} />
      <LabeledHandle type="target" position={Position.Top} id={`${id}-settings`} label="settings" dataType="settings" index={1} total={2} />

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

      {status === "success" && results.length > 0 && (
        <div style={resultStyle}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {results.length} object{results.length > 1 ? "s" : ""}
          </div>
          {results.map((r) => (
            <div key={r.object_id} style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#333" }}>
                {r.object_id}
              </div>
              <div style={{ fontSize: 11, color: "#555" }}>
                Z: {r.slice_z} mm — {r.contours.length} contour
                {r.contours.length > 1 ? "s" : ""}
              </div>
              {r.contours.map((c) => (
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
              <div style={{ fontSize: 11, marginTop: 2, color: "#555" }}>
                Offset: {r.offset_applied.distance.toFixed(3)} mm (
                {r.offset_applied.side})
              </div>
            </div>
          ))}
        </div>
      )}

      <LabeledHandle type="source" position={Position.Bottom} id={`${id}-out`} label="out" dataType="geometry" />
    </div>
  );
}

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
