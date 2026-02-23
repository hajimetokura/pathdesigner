import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Position, type NodeProps, useReactFlow } from "@xyflow/react";
import { generateToolpath, generateSbp } from "../api";
import type {
  OperationDetectResult,
  OperationAssignment,
  SheetSettings,
  PostProcessorSettings,
  ToolpathGenResult,
  PlacementItem,
} from "../types";
import LabeledHandle from "./LabeledHandle";
import NodeShell from "../components/NodeShell";
import { useUpstreamData } from "../hooks/useUpstreamData";
import { SheetBadge } from "../components/SheetBadge";

type Status = "idle" | "loading" | "success" | "error";

interface OperationsUpstream {
  detectedOperations: OperationDetectResult;
  assignments: OperationAssignment[];
  sheetSettings: SheetSettings;
  placements: PlacementItem[];
  objectOrigins: Record<string, [number, number]>;
  boundingBoxes: Record<string, { x: number; y: number; z: number }>;
  upstreamActiveSheetId: string;
}

export default function ToolpathGenNode({ id, selected }: NodeProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [toolpathResult, setToolpathResult] = useState<ToolpathGenResult | null>(null);
  const [error, setError] = useState("");
  const { setNodes } = useReactFlow();
  const lastGenKeyRef = useRef<string | null>(null);

  // Subscribe to upstream OperationNode data
  const extractOperations = useCallback((d: Record<string, unknown>): OperationsUpstream | undefined => {
    const detectedOperations = d.detectedOperations as OperationDetectResult | undefined;
    const assignments = d.assignments as OperationAssignment[] | undefined;
    const sheetSettings = d.sheetSettings as SheetSettings | undefined;
    const placements = d.placements as PlacementItem[] | undefined;
    const objectOrigins = d.objectOrigins as Record<string, [number, number]> | undefined;
    const boundingBoxes = d.boundingBoxes as Record<string, { x: number; y: number; z: number }> | undefined;
    const upstreamActiveSheetId = (d.activeSheetId as string) || "sheet_1";
    if (!detectedOperations || !assignments?.length || !sheetSettings || !placements) return undefined;
    return { detectedOperations, assignments, sheetSettings, placements, objectOrigins: objectOrigins ?? {}, boundingBoxes: boundingBoxes ?? {}, upstreamActiveSheetId };
  }, []);
  const operations = useUpstreamData(id, `${id}-operations`, extractOperations);

  const activeSheetId = operations?.upstreamActiveSheetId ?? "sheet_1";

  const allPlacements = operations?.placements ?? [];
  const sheetIds = useMemo(() => {
    const ids = [...new Set(allPlacements.map((p) => p.sheet_id))];
    if (ids.length === 0) ids.push("sheet_1");
    return ids.sort();
  }, [allPlacements]);

  // Subscribe to upstream PostProcessorNode data
  const extractPostProc = useCallback((d: Record<string, unknown>) => d.postProcessorSettings as PostProcessorSettings | undefined, []);
  const postProc = useUpstreamData(id, `${id}-postprocessor`, extractPostProc);

  // Auto-generate when upstream data changes
  useEffect(() => {
    if (!operations || !postProc) return;

    const { detectedOperations, assignments, sheetSettings, placements, objectOrigins, boundingBoxes } = operations;

    // Build a generation key from all upstream inputs to avoid redundant calls
    const genKey = JSON.stringify({ assignments, placements, sheetSettings, postProc, activeSheetId });
    if (lastGenKeyRef.current === genKey && toolpathResult) return;
    lastGenKeyRef.current = genKey;

    // Filter placements and assignments by active stock
    const filteredPlacements = placements.filter(
      (p: PlacementItem) => p.sheet_id === activeSheetId
    );
    const activeObjectIds = new Set(filteredPlacements.map((p: PlacementItem) => p.object_id));
    const opToObj = new Map(detectedOperations.operations.map((op) => [op.operation_id, op.object_id]));
    const filteredAssignments = assignments.filter((a: OperationAssignment) => {
      const objId = opToObj.get(a.operation_id);
      return objId ? activeObjectIds.has(objId) : false;
    });

    // Validate stock thickness (only for active stock's assignments)
    const matLookup = new Map(sheetSettings.materials.map((m) => [m.material_id, m]));
    const opLookup = new Map(detectedOperations.operations.map((op) => [op.operation_id, op]));
    const thinOps: string[] = [];
    for (const a of filteredAssignments) {
      if (!a.enabled) continue;
      const mat = matLookup.get(a.material_id);
      const op = opLookup.get(a.operation_id);
      if (mat && op && mat.thickness < op.geometry.depth) {
        thinOps.push(`${op.object_id}: sheet ${mat.thickness}mm < depth ${op.geometry.depth}mm`);
      }
    }
    if (thinOps.length > 0) {
      setError(`Sheet too thin: ${thinOps.join(", ")}`);
      setStatus("error");
      return;
    }

    let cancelled = false;
    setStatus("loading");
    setError("");

    (async () => {
      try {
        const tpResult = await generateToolpath(
          filteredAssignments, detectedOperations, sheetSettings, filteredPlacements, objectOrigins, boundingBoxes
        );
        if (cancelled) return;
        setToolpathResult(tpResult);

        const sbp = await generateSbp(tpResult, filteredAssignments, sheetSettings, postProc);
        if (cancelled) return;
        setStatus("success");

        // Store results in own node.data only (downstream reads via useStore)
        const allSheetIds = [...new Set(placements.map((p: PlacementItem) => p.sheet_id))].sort();
        setNodes((nds) =>
          nds.map((n) =>
            n.id === id
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    toolpathResult: tpResult,
                    outputResult: sbp,
                    sheetSettings,
                    activeSheetId,
                    allSheetIds,
                    allPlacements: placements,
                    allAssignments: assignments,
                    detectedOperations,
                    objectOrigins,
                    postProcessorSettings: postProc,
                  },
                }
              : n
          )
        );
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Generation failed");
        setStatus("error");
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operations, postProc, operations?.upstreamActiveSheetId]);

  return (
    <NodeShell category="cam" selected={selected} statusBorder={status === "error" ? "#d32f2f" : status === "loading" ? "#ffc107" : undefined}>
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

      {sheetIds.length > 1 && (
        <SheetBadge
          activeSheetId={activeSheetId}
          totalSheets={sheetIds.length}
        />
      )}

      {status === "loading" && (
        <div style={spinnerContainerStyle}>
          <div style={spinnerStyle} />
          <span style={{ fontSize: 11, color: "#888" }}>Generating...</span>
        </div>
      )}

      {status === "error" && (
        <div style={{ color: "#d32f2f", fontSize: 11, padding: "4px 0" }}>
          {error}
        </div>
      )}

      {!operations && !postProc && status !== "loading" && (
        <div style={{ color: "#999", fontSize: 11 }}>Connect Operation + Post Proc</div>
      )}

      {status === "success" && toolpathResult && (
        <div style={resultStyle}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {toolpathResult.toolpaths.length} toolpath
            {toolpathResult.toolpaths.length > 1 ? "s" : ""}
          </div>
          <div style={scrollableListStyle}>
            {toolpathResult.toolpaths.map((tp) => (
              <div key={tp.operation_id} style={detailStyle}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#333" }}>
                  {tp.operation_id}
                </div>
                <div style={{ fontSize: 11, color: "#555" }}>
                  {tp.passes.length} passes
                </div>
                <div style={{ fontSize: 10, color: "#777" }}>
                  Z: {tp.passes.map((p) => p.z_depth.toFixed(1)).join(" \u2192 ")}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <LabeledHandle
        type="source"
        position={Position.Bottom}
        id={`${id}-toolpath`}
        label="toolpath"
        dataType="toolpath"
        index={0}
        total={2}
      />
      <LabeledHandle
        type="source"
        position={Position.Bottom}
        id={`${id}-output`}
        label="output"
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
  color: "#333",
};

const resultStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 12,
};

const scrollableListStyle: React.CSSProperties = {
  maxHeight: 150,
  overflowY: "auto",
  scrollbarWidth: "thin",
};

const detailStyle: React.CSSProperties = {
  background: "#f5f5f5",
  borderRadius: 4,
  padding: "6px 8px",
  marginTop: 4,
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
  borderTopColor: "#ff9800",
  borderRadius: "50%",
  animation: "spin 0.8s linear infinite",
};
