import { useCallback, useEffect, useRef, useState } from "react";
import { Position, type NodeProps, useReactFlow } from "@xyflow/react";
import { generateToolpath, generateSbp } from "../api";
import type {
  OperationDetectResult,
  OperationAssignment,
  StockSettings,
  PostProcessorSettings,
  ToolpathGenResult,
  PlacementItem,
} from "../types";
import LabeledHandle from "./LabeledHandle";
import { useUpstreamData } from "../hooks/useUpstreamData";

type Status = "idle" | "loading" | "success" | "error";

interface OperationsUpstream {
  detectedOperations: OperationDetectResult;
  assignments: OperationAssignment[];
  stockSettings: StockSettings;
  placements: PlacementItem[];
  objectOrigins: Record<string, [number, number]>;
}

export default function ToolpathGenNode({ id }: NodeProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [toolpathResult, setToolpathResult] = useState<ToolpathGenResult | null>(null);
  const [error, setError] = useState("");
  const { setNodes } = useReactFlow();
  const lastGenKeyRef = useRef<string | null>(null);

  // Subscribe to upstream OperationNode data
  const extractOperations = useCallback((d: Record<string, unknown>): OperationsUpstream | undefined => {
    const detectedOperations = d.detectedOperations as OperationDetectResult | undefined;
    const assignments = d.assignments as OperationAssignment[] | undefined;
    const stockSettings = d.stockSettings as StockSettings | undefined;
    const placements = d.placements as PlacementItem[] | undefined;
    const objectOrigins = d.objectOrigins as Record<string, [number, number]> | undefined;
    if (!detectedOperations || !assignments?.length || !stockSettings || !placements) return undefined;
    return { detectedOperations, assignments, stockSettings, placements, objectOrigins: objectOrigins ?? {} };
  }, []);
  const operations = useUpstreamData(id, `${id}-operations`, extractOperations);

  // Subscribe to upstream PostProcessorNode data
  const extractPostProc = useCallback((d: Record<string, unknown>) => d.postProcessorSettings as PostProcessorSettings | undefined, []);
  const postProc = useUpstreamData(id, `${id}-postprocessor`, extractPostProc);

  // Auto-generate when upstream data changes
  useEffect(() => {
    if (!operations || !postProc) return;

    const { detectedOperations, assignments, stockSettings, placements, objectOrigins } = operations;

    // Build a generation key from all upstream inputs to avoid redundant calls
    const genKey = JSON.stringify({ assignments, placements, stockSettings, postProc });
    if (lastGenKeyRef.current === genKey && toolpathResult) return;
    lastGenKeyRef.current = genKey;

    // Validate stock thickness
    const matLookup = new Map(stockSettings.materials.map((m) => [m.material_id, m]));
    const opLookup = new Map(detectedOperations.operations.map((op) => [op.operation_id, op]));
    const thinOps: string[] = [];
    for (const a of assignments) {
      if (!a.enabled) continue;
      const mat = matLookup.get(a.material_id);
      const op = opLookup.get(a.operation_id);
      if (mat && op && mat.thickness < op.geometry.depth) {
        thinOps.push(`${op.object_id}: stock ${mat.thickness}mm < depth ${op.geometry.depth}mm`);
      }
    }
    if (thinOps.length > 0) {
      setError(`Stock too thin: ${thinOps.join(", ")}`);
      setStatus("error");
      return;
    }

    let cancelled = false;
    setStatus("loading");
    setError("");

    (async () => {
      try {
        const tpResult = await generateToolpath(
          assignments, detectedOperations, stockSettings, placements, objectOrigins
        );
        if (cancelled) return;
        setToolpathResult(tpResult);

        const sbp = await generateSbp(tpResult, assignments, stockSettings, postProc);
        if (cancelled) return;
        setStatus("success");

        // Store results in own node.data only (downstream reads via useStore)
        setNodes((nds) =>
          nds.map((n) =>
            n.id === id
              ? { ...n, data: { ...n.data, toolpathResult: tpResult, outputResult: sbp, stockSettings } }
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
  }, [operations, postProc]);

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
