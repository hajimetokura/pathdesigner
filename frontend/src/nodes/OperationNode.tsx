import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { Position, type NodeProps, useReactFlow } from "@xyflow/react";
import { detectOperations } from "../api";
import type {
  BrepImportResult,
  BrepObject,
  StockSettings,
  OperationDetectResult,
  OperationAssignment,
  PlacementItem,
} from "../types";
import LabeledHandle from "./LabeledHandle";
import OperationDetailPanel from "../components/OperationDetailPanel";

type Status = "idle" | "loading" | "success" | "error";

export default function OperationNode({ id }: NodeProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [detected, setDetected] = useState<OperationDetectResult | null>(null);
  const [assignments, setAssignments] = useState<OperationAssignment[]>([]);
  const [stockSettings, setStockSettings] = useState<StockSettings | null>(null);
  const [placements, setPlacements] = useState<PlacementItem[]>([]);
  const [showPanel, setShowPanel] = useState(false);
  const [error, setError] = useState("");
  const { getNode, getEdges, setNodes } = useReactFlow();

  const syncToNodeData = useCallback(
    (det: OperationDetectResult, assign: OperationAssignment[], stock: StockSettings | null, plc: PlacementItem[]) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id
            ? { ...n, data: { ...n.data, detectedOperations: det, assignments: assign, stockSettings: stock, placements: plc } }
            : n
        )
      );
    },
    [id, setNodes]
  );

  const handleDetect = useCallback(async () => {
    const edges = getEdges();

    // Find upstream data — either PlacementResult or direct BrepImportResult
    const brepEdge = edges.find(
      (e) => e.target === id && e.targetHandle === `${id}-brep`
    );
    if (!brepEdge) {
      setError("Connect Placement or BREP Import node first");
      setStatus("error");
      return;
    }
    const upstreamNode = getNode(brepEdge.source);

    // Try PlacementResult first (from PlacementNode)
    const placementResult = upstreamNode?.data?.placementResult as
      | { placements: PlacementItem[]; stock: StockSettings; objects: BrepObject[] }
      | undefined;

    let brepResult: BrepImportResult | undefined;
    let upstreamStock: StockSettings | undefined;
    let upstreamPlacements: PlacementItem[] = [];

    if (placementResult) {
      // PlacementNode upstream: extract brep + stock + placements from placement result
      brepResult = {
        file_id: (upstreamNode?.data as Record<string, unknown>)?.fileId as string ?? "",
        objects: placementResult.objects,
        object_count: placementResult.objects.length,
      } as BrepImportResult;
      upstreamStock = placementResult.stock;
      upstreamPlacements = placementResult.placements;
    } else {
      // Direct BrepImportResult (backwards-compatible)
      brepResult = upstreamNode?.data?.brepResult as BrepImportResult | undefined;
      // Stock from separate edge
      const stockEdge = edges.find(
        (e) => e.target === id && e.targetHandle === `${id}-stock`
      );
      const stockNode = stockEdge ? getNode(stockEdge.source) : null;
      upstreamStock = stockNode?.data?.stockSettings as StockSettings | undefined;
    }

    if (!brepResult) {
      setError("Upload a STEP file first");
      setStatus("error");
      return;
    }

    // Get file_id for API call
    const fileId = placementResult
      ? (upstreamNode?.data?.fileId as string)
      : brepResult?.file_id;

    if (!fileId) {
      setError("Upload a STEP file first");
      setStatus("error");
      return;
    }

    setStockSettings(upstreamStock ?? null);
    setPlacements(upstreamPlacements);
    setStatus("loading");
    setError("");

    try {
      const objectIds = brepResult.objects.map((o) => o.object_id);
      const result = await detectOperations(fileId, objectIds);
      setDetected(result);

      // Auto-create assignments
      const defaultMaterialId = upstreamStock?.materials?.[0]?.material_id ?? "mtl_1";
      const newAssignments: OperationAssignment[] = result.operations.map((op, i) => ({
        operation_id: op.operation_id,
        material_id: defaultMaterialId,
        enabled: op.enabled,
        settings: op.suggested_settings,
        order: i + 1,
      }));
      setAssignments(newAssignments);

      syncToNodeData(result, newAssignments, upstreamStock ?? null, upstreamPlacements);
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
        if (detected) syncToNodeData(detected, updated, stockSettings, placements);
        return updated;
      });
    },
    [detected, stockSettings, placements, syncToNodeData]
  );

  const handleAssignmentsChange = useCallback(
    (updated: OperationAssignment[]) => {
      setAssignments(updated);
      if (detected) syncToNodeData(detected, updated, stockSettings, placements);
    },
    [detected, stockSettings, placements, syncToNodeData]
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

          <button
            onClick={() => setShowPanel(true)}
            style={editButtonStyle}
          >
            Edit Settings
          </button>

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

      {showPanel && detected && createPortal(
        <OperationDetailPanel
          detectedOperations={detected}
          assignments={assignments}
          stockSettings={stockSettings}
          onAssignmentsChange={handleAssignmentsChange}
          onClose={() => setShowPanel(false)}
        />,
        document.body
      )}
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

const editButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 10px",
  border: "1px solid #ccc",
  borderRadius: 6,
  background: "#f5f5f5",
  color: "#333",
  cursor: "pointer",
  fontSize: 11,
  fontWeight: 600,
  marginBottom: 4,
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
