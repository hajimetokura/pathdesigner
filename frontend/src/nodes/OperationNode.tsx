import { useCallback, useEffect, useRef, useState } from "react";
import { Position, type NodeProps, useReactFlow } from "@xyflow/react";
import { detectOperations } from "../api";
import type {
  BrepObject,
  StockSettings,
  OperationDetectResult,
  OperationAssignment,
  PlacementItem,
} from "../types";
import LabeledHandle from "./LabeledHandle";
import type { PanelTab } from "../components/SidePanel";
import OperationDetailPanel from "../components/OperationDetailPanel";
import { useUpstreamData } from "../hooks/useUpstreamData";

type Status = "idle" | "loading" | "success" | "error";

interface UpstreamData {
  placementResult: { placements: PlacementItem[]; stock: StockSettings; objects: BrepObject[] };
  fileId: string;
}

export default function OperationNode({ id, data }: NodeProps) {
  const openTab = (data as Record<string, unknown>).openTab as ((tab: PanelTab) => void) | undefined;
  const [status, setStatus] = useState<Status>("idle");
  const [detected, setDetected] = useState<OperationDetectResult | null>(null);
  const [assignments, setAssignments] = useState<OperationAssignment[]>([]);
  const [error, setError] = useState("");
  const { setNodes } = useReactFlow();
  const lastFileIdRef = useRef<string | null>(null);

  // Subscribe to upstream PlacementNode data (reactive)
  const extractUpstream = useCallback((d: Record<string, unknown>): UpstreamData | undefined => {
    const placementResult = d.placementResult as UpstreamData["placementResult"] | undefined;
    const fileId = d.fileId as string | undefined;
    if (!placementResult || !fileId) return undefined;
    return { placementResult, fileId };
  }, []);
  const upstream = useUpstreamData(id, `${id}-brep`, extractUpstream);

  const syncToNodeData = useCallback(
    (det: OperationDetectResult, assign: OperationAssignment[], stock: StockSettings | null, plc: PlacementItem[], objects: BrepObject[]) => {
      // Build objectOrigins map for ToolpathGenNode
      const objectOrigins: Record<string, [number, number]> = {};
      for (const obj of objects) {
        objectOrigins[obj.object_id] = [obj.origin.position[0], obj.origin.position[1]];
      }
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id
            ? { ...n, data: { ...n.data, detectedOperations: det, assignments: assign, stockSettings: stock, placements: plc, objectOrigins } }
            : n
        )
      );
    },
    [id, setNodes]
  );

  // Auto-detect operations when upstream data changes
  useEffect(() => {
    if (!upstream) return;
    const { placementResult, fileId } = upstream;
    // Skip if fileId hasn't changed (avoid re-detect on assignment edits)
    if (lastFileIdRef.current === fileId && detected) return;
    lastFileIdRef.current = fileId;

    const { placements: upstreamPlacements, stock: upstreamStock, objects } = placementResult;
    const objectIds = objects.map((o) => o.object_id);

    let cancelled = false;
    setStatus("loading");
    setError("");

    (async () => {
      try {
        const result = await detectOperations(fileId, objectIds);
        if (cancelled) return;
        setDetected(result);

        const defaultMaterialId = upstreamStock?.materials?.[0]?.material_id ?? "mtl_1";
        const newAssignments: OperationAssignment[] = result.operations.map((op, i) => ({
          operation_id: op.operation_id,
          material_id: defaultMaterialId,
          enabled: op.enabled,
          settings: op.suggested_settings,
          order: i + 1,
        }));
        setAssignments(newAssignments);
        syncToNodeData(result, newAssignments, upstreamStock, upstreamPlacements, objects);
        setStatus("success");
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Detection failed");
        setStatus("error");
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upstream?.fileId]);

  // Re-sync downstream when upstream placements/stock change (without re-detecting)
  useEffect(() => {
    if (!upstream || !detected) return;
    const { placements: upstreamPlacements, stock: upstreamStock, objects } = upstream.placementResult;
    syncToNodeData(detected, assignments, upstreamStock, upstreamPlacements, objects);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upstream?.placementResult]);

  const handleToggleOp = useCallback(
    (opId: string) => {
      setAssignments((prev) => {
        const updated = prev.map((a) =>
          a.operation_id === opId ? { ...a, enabled: !a.enabled } : a
        );
        if (detected && upstream) {
          syncToNodeData(detected, updated, upstream.placementResult.stock, upstream.placementResult.placements, upstream.placementResult.objects);
        }
        return updated;
      });
    },
    [detected, upstream, syncToNodeData]
  );

  const handleAssignmentsChange = useCallback(
    (updated: OperationAssignment[]) => {
      setAssignments(updated);
      if (detected && upstream) {
        syncToNodeData(detected, updated, upstream.placementResult.stock, upstream.placementResult.placements, upstream.placementResult.objects);
      }
    },
    [detected, upstream, syncToNodeData]
  );

  const enabledCount = assignments.filter((a) => a.enabled).length;

  const handleEditSettings = useCallback(() => {
    if (!detected || !openTab) return;
    openTab({
      id: `operations-${id}`,
      label: "Operations",
      icon: "\u2699",
      content: (
        <OperationDetailPanel
          detectedOperations={detected}
          assignments={assignments}
          stockSettings={upstream?.placementResult.stock ?? null}
          onAssignmentsChange={handleAssignmentsChange}
        />
      ),
    });
  }, [id, detected, assignments, upstream, handleAssignmentsChange, openTab]);

  // Update tab content when assignments change
  useEffect(() => {
    if (detected && openTab) {
      openTab({
        id: `operations-${id}`,
        label: "Operations",
        icon: "\u2699",
        content: (
          <OperationDetailPanel
            detectedOperations={detected}
            assignments={assignments}
            stockSettings={upstream?.placementResult.stock ?? null}
            onAssignmentsChange={handleAssignmentsChange}
          />
        ),
      });
    }
  }, [id, detected, assignments, upstream, handleAssignmentsChange, openTab]);

  const dynamicBorder = status === "error" ? "#d32f2f" : status === "loading" ? "#ffc107" : "#ddd";

  return (
    <div style={{ ...nodeStyle, borderColor: dynamicBorder }}>
      <LabeledHandle
        type="target"
        position={Position.Top}
        id={`${id}-brep`}
        label="placement"
        dataType="geometry"
      />

      <div style={headerStyle}>Operation</div>

      {status === "loading" && (
        <div style={spinnerContainerStyle}>
          <div style={spinnerStyle} />
          <span style={{ fontSize: 11, color: "#888" }}>Detecting...</span>
        </div>
      )}

      {status === "error" && (
        <div style={{ color: "#d32f2f", fontSize: 11, padding: "4px 0" }}>
          {error}
        </div>
      )}

      {!upstream && status !== "loading" && (
        <div style={{ color: "#999", fontSize: 11 }}>Connect Placement node</div>
      )}

      {status === "success" && detected && (
        <div style={resultStyle}>
          <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 12 }}>
            {detected.operations.length} detected / {enabledCount} enabled
          </div>

          <button
            onClick={handleEditSettings}
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
    </div>
  );
}

/* --- Styles --- */

const nodeStyle: React.CSSProperties = {
  background: "white",
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: "20px 12px",
  width: 200,
  boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
};

const headerStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 13,
  marginBottom: 8,
  color: "#333",
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

const spinnerContainerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 0",
};

const spinnerStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  border: "2px solid #eee",
  borderTopColor: "#7b61ff",
  borderRadius: "50%",
  animation: "spin 0.8s linear infinite",
};
