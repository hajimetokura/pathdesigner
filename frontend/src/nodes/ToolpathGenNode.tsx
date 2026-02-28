import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type NodeProps, useReactFlow } from "@xyflow/react";
import { generateToolpath, generateSbp, validatePlacement } from "../api";
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
import { DEFAULT_SHEET_ID } from "../constants";

type Status = "idle" | "loading" | "success" | "error" | "blocked";

interface OperationsUpstream {
  detectedOperations: OperationDetectResult;
  assignments: OperationAssignment[];
  sheetSettings: SheetSettings;
  placements: PlacementItem[];
  objectOrigins: Record<string, [number, number]>;
  boundingBoxes: Record<string, { x: number; y: number; z: number }>;
  outlines: Record<string, [number, number][]>;
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
    const outlines = d.outlines as Record<string, [number, number][]> | undefined;
    const upstreamActiveSheetId = (d.activeSheetId as string) || DEFAULT_SHEET_ID;
    if (!detectedOperations || !assignments?.length || !sheetSettings || !placements) return undefined;
    return { detectedOperations, assignments, sheetSettings, placements, objectOrigins: objectOrigins ?? {}, boundingBoxes: boundingBoxes ?? {}, outlines: outlines ?? {}, upstreamActiveSheetId };
  }, []);
  const operations = useUpstreamData(id, `${id}-operations`, extractOperations);

  const activeSheetId = operations?.upstreamActiveSheetId ?? DEFAULT_SHEET_ID;

  const allPlacements = operations?.placements ?? [];
  const sheetIds = useMemo(() => {
    const ids = [...new Set(allPlacements.map((p) => p.sheet_id))];
    if (ids.length === 0) ids.push(DEFAULT_SHEET_ID);
    return ids.sort();
  }, [allPlacements]);

  // Subscribe to upstream PostProcessorNode data
  const extractPostProc = useCallback((d: Record<string, unknown>) => d.postProcessorSettings as PostProcessorSettings | undefined, []);
  const postProc = useUpstreamData(id, `${id}-postprocessor`, extractPostProc);

  // Debounced auto-generate when upstream data changes
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!operations || !postProc) return;

    const { assignments, placements, sheetSettings } = operations;

    // Build a generation key from all upstream inputs to avoid redundant calls
    const genKey = JSON.stringify({ assignments, placements, sheetSettings, postProc, activeSheetId });
    if (lastGenKeyRef.current === genKey && toolpathResult) return;

    // Cancel any in-flight request
    cancelledRef.current = true;

    // Clear previous debounce timer
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // Show loading immediately so user knows generation is pending
    setStatus("loading");
    setError("");

    // Debounce: wait 500ms after last change before generating
    debounceRef.current = setTimeout(() => {
      lastGenKeyRef.current = genKey;
      cancelledRef.current = false;

      const { detectedOperations, objectOrigins, boundingBoxes, outlines } = operations;

      // Filter placements and assignments by active sheet
      const filteredPlacements = placements.filter(
        (p: PlacementItem) => p.sheet_id === activeSheetId
      );
      const activeObjectIds = new Set(filteredPlacements.map((p: PlacementItem) => p.object_id));
      const opToObj = new Map(detectedOperations.operations.map((op) => [op.operation_id, op.object_id]));
      const filteredAssignments = assignments.filter((a: OperationAssignment) => {
        const objId = opToObj.get(a.operation_id);
        return objId ? activeObjectIds.has(objId) : false;
      });

      // Validate sheet thickness (only for active sheet's assignments)
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
        setStatus("blocked");
        return;
      }

      (async () => {
        try {
          // Gate: validate placement (outline-based bounds + collision via backend)
          const validation = await validatePlacement(
            filteredPlacements, sheetSettings, boundingBoxes, outlines,
          );
          if (cancelledRef.current) return;
          if (validation.warnings.length > 0) {
            setError(validation.warnings.join("\n"));
            setStatus("blocked");
            return;
          }

          const tpResult = await generateToolpath(
            filteredAssignments, detectedOperations, sheetSettings, filteredPlacements, objectOrigins, boundingBoxes
          );
          if (cancelledRef.current) return;
          setToolpathResult(tpResult);

          const sbp = await generateSbp(tpResult, filteredAssignments, sheetSettings, postProc);
          if (cancelledRef.current) return;
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
                      boundingBoxes,
                      outlines,
                      postProcessorSettings: postProc,
                    },
                  }
                : n
            )
          );
        } catch (e) {
          if (cancelledRef.current) return;
          setError(e instanceof Error ? e.message : "Generation failed");
          setStatus("error");
        }
      })();
    }, 500);

    return () => {
      cancelledRef.current = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operations, postProc, operations?.upstreamActiveSheetId]);

  return (
    <NodeShell category="cam" selected={selected} statusBorder={status === "blocked" ? "var(--color-cad)" : status === "error" ? "var(--color-error)" : status === "loading" ? "var(--color-warning)" : undefined}>
      <LabeledHandle
        type="target"
        id={`${id}-operations`}
        label="operations"
        dataType="geometry"
        index={0}
        total={2}
      />
      <LabeledHandle
        type="target"
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
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Generating...</span>
        </div>
      )}

      {status === "blocked" && (
        <div style={blockedStyle}>
          <span style={{ fontWeight: 600 }}>Placement問題あり</span>
          <div style={scrollableListStyle}>
            {error.split("\n").map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </div>
      )}

      {status === "error" && (
        <div style={scrollableListStyle}>
          <div style={{ color: "var(--color-error)", fontSize: 11, padding: "4px 0" }}>
            {error}
          </div>
        </div>
      )}

      {!operations && !postProc && status !== "loading" && (
        <div style={{ color: "var(--text-muted)", fontSize: 11 }}>Connect Operation + Post Proc</div>
      )}

      {status === "success" && toolpathResult && (
        <div style={resultStyle}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {toolpathResult.toolpaths.length} toolpath
            {toolpathResult.toolpaths.length > 1 ? "s" : ""}
          </div>
          <div style={scrollableListStyle}>
            {(() => {
              // Group toolpaths by object_id
              const groups = new Map<string, typeof toolpathResult.toolpaths>();
              for (const tp of toolpathResult.toolpaths) {
                const key = tp.object_id || tp.operation_id;
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key)!.push(tp);
              }
              return [...groups.entries()].map(([objId, tps]) => (
                <div key={objId} style={detailStyle}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)", marginBottom: 2 }}>
                    {objId}
                  </div>
                  {tps.map((tp, i) => (
                    <div key={`${tp.operation_id}-${tp.contour_type}-${i}`} style={{ display: "flex", alignItems: "center", gap: 4, padding: "1px 0" }}>
                      <span style={{ ...contourDotStyle, background: CONTOUR_COLORS[tp.contour_type] ?? "var(--text-muted)" }} />
                      <span style={{ fontSize: 10, color: "var(--text-secondary)", minWidth: 48 }}>
                        {tp.contour_type}
                      </span>
                      <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                        {tp.passes.length}p Z:{tp.passes[0]?.z_depth.toFixed(1)}{tp.passes.length > 1 ? `→${tp.passes[tp.passes.length - 1].z_depth.toFixed(1)}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      <LabeledHandle
        type="source"
        id={`${id}-toolpath`}
        label="toolpath"
        dataType="toolpath"
        index={0}
        total={2}
      />
      <LabeledHandle
        type="source"
        id={`${id}-output`}
        label="output"
        dataType="toolpath"
        index={1}
        total={2}
      />
    </NodeShell>
  );
}

const CONTOUR_COLORS: Record<string, string> = {
  exterior: "#00bcd4",
  interior: "#4dd0e1",
  pocket: "#9c27b0",
  drill: "#ff9800",
};

const contourDotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "50%",
  flexShrink: 0,
};

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

const scrollableListStyle: React.CSSProperties = {
  maxHeight: 150,
  overflowY: "auto",
  scrollbarWidth: "thin",
};

const detailStyle: React.CSSProperties = {
  background: "var(--surface-bg)",
  borderRadius: "var(--radius-item)",
  padding: "6px 8px",
  marginTop: 4,
};

const blockedStyle: React.CSSProperties = {
  color: "var(--color-cad)",
  fontSize: 11,
  padding: "6px 8px",
  background: "var(--surface-bg)",
  borderRadius: "var(--radius-item)",
  lineHeight: 1.5,
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
  borderTopColor: "var(--color-cad)",
  borderRadius: "50%",
  animation: "spin 0.8s linear infinite",
};
