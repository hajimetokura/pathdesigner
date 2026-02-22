import { useCallback, useState } from "react";
import { Position, type NodeProps, useReactFlow } from "@xyflow/react";
import { detectOperations } from "../api";
import type {
  BrepImportResult,
  StockSettings,
  OperationDetectResult,
  OperationAssignment,
} from "../types";
import LabeledHandle from "./LabeledHandle";

type Status = "idle" | "loading" | "success" | "error";

export default function OperationNode({ id }: NodeProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [detected, setDetected] = useState<OperationDetectResult | null>(null);
  const [assignments, setAssignments] = useState<OperationAssignment[]>([]);
  const [error, setError] = useState("");
  const { getNode, getEdges, setNodes } = useReactFlow();

  const syncToNodeData = useCallback(
    (det: OperationDetectResult, assign: OperationAssignment[]) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id
            ? { ...n, data: { ...n.data, detectedOperations: det, assignments: assign } }
            : n
        )
      );
    },
    [id, setNodes]
  );

  const handleDetect = useCallback(async () => {
    const edges = getEdges();

    // Find BREP data from upstream
    const brepEdge = edges.find(
      (e) => e.target === id && e.targetHandle === `${id}-brep`
    );
    if (!brepEdge) {
      setError("Connect BREP Import node first");
      setStatus("error");
      return;
    }
    const brepNode = getNode(brepEdge.source);
    const brepResult = brepNode?.data?.brepResult as BrepImportResult | undefined;
    if (!brepResult) {
      setError("Upload a STEP file first");
      setStatus("error");
      return;
    }

    // Find stock data from upstream
    const stockEdge = edges.find(
      (e) => e.target === id && e.targetHandle === `${id}-stock`
    );
    const stockNode = stockEdge ? getNode(stockEdge.source) : null;
    const stockSettings = stockNode?.data?.stockSettings as StockSettings | undefined;

    setStatus("loading");
    setError("");

    try {
      const objectIds = brepResult.objects.map((o) => o.object_id);
      const result = await detectOperations(brepResult.file_id, objectIds);
      setDetected(result);

      // Auto-create assignments
      const defaultMaterialId = stockSettings?.materials?.[0]?.material_id ?? "mtl_1";
      const newAssignments: OperationAssignment[] = result.operations.map((op, i) => ({
        operation_id: op.operation_id,
        material_id: defaultMaterialId,
        enabled: op.enabled,
        settings: op.suggested_settings,
        order: i + 1,
      }));
      setAssignments(newAssignments);

      syncToNodeData(result, newAssignments);
      setStatus("success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Detection failed");
      setStatus("error");
    }
  }, [id, getNode, getEdges, syncToNodeData]);

  const handleToggleOp = useCallback(
    (opId: string) => {
      setAssignments((prev) => {
        const updated = prev.map((a) =>
          a.operation_id === opId ? { ...a, enabled: !a.enabled } : a
        );
        if (detected) syncToNodeData(detected, updated);
        return updated;
      });
    },
    [detected, syncToNodeData]
  );

  const enabledCount = assignments.filter((a) => a.enabled).length;

  return (
    <div style={nodeStyle}>
      <LabeledHandle
        type="target"
        position={Position.Top}
        id={`${id}-brep`}
        label="brep"
        dataType="geometry"
        index={0}
        total={2}
      />
      <LabeledHandle
        type="target"
        position={Position.Top}
        id={`${id}-stock`}
        label="stock"
        dataType="settings"
        index={1}
        total={2}
      />

      <div style={headerStyle}>Operation</div>

      <button
        onClick={handleDetect}
        disabled={status === "loading"}
        style={buttonStyle}
      >
        {status === "loading" ? "Detecting..." : "Detect Operations"}
      </button>

      {status === "error" && (
        <div style={{ color: "#d32f2f", fontSize: 11, padding: "4px 0" }}>
          {error}
        </div>
      )}

      {status === "success" && detected && (
        <div style={resultStyle}>
          <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 12 }}>
            {detected.operations.length} detected / {enabledCount} enabled
          </div>

          {detected.operations.map((op) => {
            const assignment = assignments.find(
              (a) => a.operation_id === op.operation_id
            );
            const enabled = assignment?.enabled ?? true;
            return (
              <div
                key={op.operation_id}
                style={{
                  ...opRowStyle,
                  opacity: enabled ? 1 : 0.5,
                }}
                onClick={() => handleToggleOp(op.operation_id)}
              >
                <span style={{ fontSize: 11 }}>
                  {enabled ? "\u2713" : "\u2717"}{" "}
                  {op.object_id}: {op.operation_type}
                </span>
                <span style={{ fontSize: 10, color: "#888" }}>
                  z={op.geometry.depth.toFixed(1)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <LabeledHandle
        type="source"
        position={Position.Bottom}
        id={`${id}-out`}
        label="operations"
        dataType="geometry"
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
  border: "1px solid #7b61ff",
  borderRadius: 6,
  background: "#7b61ff",
  color: "white",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};

const resultStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 12,
};

const opRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  background: "#f5f5f5",
  borderRadius: 4,
  padding: "4px 8px",
  marginTop: 3,
  cursor: "pointer",
  userSelect: "none",
};
