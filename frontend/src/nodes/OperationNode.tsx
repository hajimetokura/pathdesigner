import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type NodeProps, useReactFlow } from "@xyflow/react";
import { detectOperations } from "../api";
import type {
  BrepObject,
  SheetSettings,
  OperationDetectResult,
  OperationAssignment,
  PlacementItem,
} from "../types";
import LabeledHandle from "./LabeledHandle";
import NodeShell from "../components/NodeShell";
import OperationDetailPanel from "../components/OperationDetailPanel";
import { usePanelTabs } from "../contexts/PanelTabsContext";
import { useUpstreamData } from "../hooks/useUpstreamData";
import { SheetBadge } from "../components/SheetBadge";
import { DEFAULT_SHEET_ID } from "../constants";

type Status = "idle" | "loading" | "success" | "error";

interface UpstreamData {
  placementResult: { placements: PlacementItem[]; sheet: SheetSettings; objects: BrepObject[] };
  fileId: string;
  activeSheetId: string;
}

export default function OperationNode({ id, selected }: NodeProps) {
  const { openTab, updateTab } = usePanelTabs();
  const [status, setStatus] = useState<Status>("idle");
  const [detected, setDetected] = useState<OperationDetectResult | null>(null);
  const [assignments, setAssignments] = useState<OperationAssignment[]>([]);
  const [error, setError] = useState("");
  const [groupLabels, setGroupLabels] = useState<Record<string, string>>({});
  const { setNodes } = useReactFlow();
  const lastFileIdRef = useRef<string | null>(null);

  // Subscribe to upstream PlacementNode data (reactive)
  const extractUpstream = useCallback((d: Record<string, unknown>): UpstreamData | undefined => {
    const placementResult = d.placementResult as UpstreamData["placementResult"] | undefined;
    const fileId = d.fileId as string | undefined;
    const activeSheetId = (d.activeSheetId as string) || DEFAULT_SHEET_ID;
    if (!placementResult || !fileId) return undefined;
    return { placementResult, fileId, activeSheetId };
  }, []);
  const upstream = useUpstreamData(id, `${id}-brep`, extractUpstream);

  const activeSheetId = upstream?.activeSheetId ?? DEFAULT_SHEET_ID;

  const allPlacements = upstream?.placementResult.placements ?? [];
  const sheetIds = useMemo(() => {
    const ids = [...new Set(allPlacements.map((p) => p.sheet_id))];
    if (ids.length === 0) ids.push(DEFAULT_SHEET_ID);
    return ids.sort();
  }, [allPlacements]);

  // Filter operations by active sheet
  const activeObjectIds = useMemo(() => {
    const ids = new Set(allPlacements.filter((p) => p.sheet_id === activeSheetId).map((p) => p.object_id));
    return ids;
  }, [allPlacements, activeSheetId]);

  const syncToNodeData = useCallback(
    (det: OperationDetectResult, assign: OperationAssignment[], sheet: SheetSettings | null, plc: PlacementItem[], objects: BrepObject[]) => {
      const sid = upstream?.activeSheetId ?? DEFAULT_SHEET_ID;
      // Build objectOrigins and boundingBoxes maps for ToolpathGenNode
      const objectOrigins: Record<string, [number, number]> = {};
      const boundingBoxes: Record<string, { x: number; y: number; z: number }> = {};
      const outlines: Record<string, [number, number][]> = {};
      for (const obj of objects) {
        objectOrigins[obj.object_id] = [obj.origin.position[0], obj.origin.position[1]];
        boundingBoxes[obj.object_id] = obj.bounding_box;
        if (obj.outline && obj.outline.length >= 3) {
          outlines[obj.object_id] = obj.outline;
        }
      }
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id
            ? { ...n, data: { ...n.data, detectedOperations: det, assignments: assign, sheetSettings: sheet, placements: plc, objectOrigins, boundingBoxes, outlines, activeSheetId: sid } }
            : n
        )
      );
    },
    [id, setNodes, upstream?.activeSheetId]
  );

  // Auto-detect operations when upstream data changes
  useEffect(() => {
    if (!upstream) return;
    const { placementResult, fileId } = upstream;
    // Skip if fileId hasn't changed (avoid re-detect on assignment edits)
    if (lastFileIdRef.current === fileId && detected) return;
    lastFileIdRef.current = fileId;

    const { placements: upstreamPlacements, sheet: upstreamSheet, objects } = placementResult;
    const objectIds = objects.map((o) => o.object_id);

    let cancelled = false;
    setStatus("loading");
    setError("");

    (async () => {
      try {
        const result = await detectOperations(fileId, objectIds);
        if (cancelled) return;
        setDetected(result);

        const defaultMaterialId = upstreamSheet?.materials?.[0]?.material_id ?? "mtl_1";
        const newAssignments: OperationAssignment[] = result.operations.map((op, i) => ({
          operation_id: op.operation_id,
          material_id: defaultMaterialId,
          enabled: op.enabled,
          settings: op.suggested_settings,
          order: i + 1,
          group_id: `default_${op.operation_type}`,
        }));
        setAssignments(newAssignments);
        syncToNodeData(result, newAssignments, upstreamSheet, upstreamPlacements, objects);
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

  // Re-sync downstream when upstream placements/sheet change (without re-detecting)
  // Use JSON key to avoid infinite loops from object reference changes
  const upstreamSyncKey = useMemo(() => {
    if (!upstream) return null;
    return JSON.stringify({
      placements: upstream.placementResult.placements,
      sheet: upstream.placementResult.sheet,
      activeSheetId: upstream.activeSheetId,
    });
  }, [upstream]);

  useEffect(() => {
    if (!upstream || !detected || !upstreamSyncKey) return;
    const { placements: upstreamPlacements, sheet: upstreamSheet, objects } = upstream.placementResult;
    syncToNodeData(detected, assignments, upstreamSheet, upstreamPlacements, objects);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upstreamSyncKey]);

  const handleToggleOp = useCallback(
    (opId: string) => {
      setAssignments((prev) => {
        const updated = prev.map((a) =>
          a.operation_id === opId ? { ...a, enabled: !a.enabled } : a
        );
        if (detected && upstream) {
          syncToNodeData(detected, updated, upstream.placementResult.sheet, upstream.placementResult.placements, upstream.placementResult.objects);
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
        syncToNodeData(detected, updated, upstream.placementResult.sheet, upstream.placementResult.placements, upstream.placementResult.objects);
      }
    },
    [detected, upstream, syncToNodeData]
  );

  const handleGroupLabelsChange = useCallback(
    (labels: Record<string, string>) => setGroupLabels(labels),
    []
  );

  const filteredOps = useMemo(() =>
    detected ? detected.operations.filter((op) => activeObjectIds.has(op.object_id)) : [],
    [detected, activeObjectIds]
  );
  const filteredAssignments = useMemo(() => {
    if (!detected) return [];
    return assignments.filter((a) => {
      const op = detected.operations.find((o) => o.operation_id === a.operation_id);
      return op ? activeObjectIds.has(op.object_id) : false;
    });
  }, [detected, assignments, activeObjectIds]);
  const enabledCount = filteredAssignments.filter((a) => a.enabled).length;

  const handleEditSettings = useCallback(() => {
    if (!detected) return;
    openTab({
      id: `operations-${id}`,
      label: "Operations",
      icon: "\u2699",
      content: (
        <OperationDetailPanel
          detectedOperations={detected}
          assignments={assignments}
          sheetSettings={upstream?.placementResult.sheet ?? null}
          onAssignmentsChange={handleAssignmentsChange}
          placements={allPlacements}
          sheetIds={sheetIds}
          activeSheetId={activeSheetId}
          groupLabels={groupLabels}
          onGroupLabelsChange={handleGroupLabelsChange}
        />
      ),
    });
  }, [id, detected, assignments, upstream, handleAssignmentsChange, openTab, allPlacements, sheetIds, activeSheetId, groupLabels, handleGroupLabelsChange]);

  // Update tab content when assignments change (only if tab is already open)
  useEffect(() => {
    if (detected) {
      updateTab({
        id: `operations-${id}`,
        label: "Operations",
        icon: "\u2699",
        content: (
          <OperationDetailPanel
            detectedOperations={detected}
            assignments={assignments}
            sheetSettings={upstream?.placementResult.sheet ?? null}
            onAssignmentsChange={handleAssignmentsChange}
            placements={allPlacements}
            sheetIds={sheetIds}
            activeSheetId={activeSheetId}
            groupLabels={groupLabels}
            onGroupLabelsChange={handleGroupLabelsChange}
          />
        ),
      });
    }
  }, [id, detected, assignments, upstream, handleAssignmentsChange, updateTab, allPlacements, sheetIds, activeSheetId, groupLabels, handleGroupLabelsChange]);

  return (
    <NodeShell category="cam" selected={selected} statusBorder={status === "error" ? "var(--color-error)" : status === "loading" ? "var(--color-warning)" : undefined}>
      <LabeledHandle
        type="target"
        id={`${id}-brep`}
        label="placement"
        dataType="geometry"
      />

      <div style={headerStyle}>Operation</div>

      {sheetIds.length > 1 && (
        <SheetBadge
          activeSheetId={activeSheetId}
          totalSheets={sheetIds.length}
        />
      )}

      {status === "loading" && (
        <div style={spinnerContainerStyle}>
          <div style={spinnerStyle} />
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Detecting...</span>
        </div>
      )}

      {status === "error" && (
        <div style={{ color: "var(--color-error)", fontSize: 11, padding: "4px 0" }}>
          {error}
        </div>
      )}

      {!upstream && status !== "loading" && (
        <div style={{ color: "var(--text-muted)", fontSize: 11 }}>Connect Placement node</div>
      )}

      {status === "success" && detected && (
        <div style={resultStyle}>
          <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 12 }}>
            {filteredOps.length} detected / {enabledCount} enabled
          </div>

          <button
            onClick={handleEditSettings}
            style={editButtonStyle}
          >
            Edit Settings
          </button>

          <div style={scrollableListStyle}>
            {filteredOps.map((op) => {
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
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                    z={op.geometry.depth.toFixed(1)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <LabeledHandle
        type="source"
        id={`${id}-out`}
        label="operations"
        dataType="geometry"
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

const resultStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 12,
};

const editButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 10px",
  border: "1px solid var(--border-color)",
  borderRadius: "var(--radius-control)",
  background: "var(--surface-bg)",
  color: "var(--text-primary)",
  cursor: "pointer",
  fontSize: 11,
  fontWeight: 600,
  marginBottom: 4,
};

const scrollableListStyle: React.CSSProperties = {
  maxHeight: 150,
  overflowY: "auto",
  scrollbarWidth: "thin",
};

const opRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  background: "var(--surface-bg)",
  borderRadius: "var(--radius-item)",
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
  border: "2px solid var(--border-subtle)",
  borderTopColor: "var(--color-accent)",
  borderRadius: "50%",
  animation: "spin 0.8s linear infinite",
};
