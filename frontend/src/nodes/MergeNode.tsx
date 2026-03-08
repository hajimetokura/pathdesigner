import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type NodeProps, useReactFlow, useStore } from "@xyflow/react";
import LabeledHandle from "./LabeledHandle";
import NodeShell from "../components/NodeShell";
import { useMultiUpstreamData } from "../hooks/useMultiUpstreamData";
import { mergeBReps, mergeToolpaths } from "../api";
import type { BrepImportResult, ToolpathGenResult } from "../types";

const MIN_PORTS = 2;

type UpstreamData =
  | { type: "geometry"; data: BrepImportResult }
  | { type: "toolpath"; data: ToolpathGenResult };

function MergeNodeInner({ id, selected }: NodeProps) {
  const { setNodes } = useReactFlow();

  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [objectCount, setObjectCount] = useState(0);
  const [sourceCount, setSourceCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [detectedType, setDetectedType] = useState<"geometry" | "toolpath">("geometry");
  const lastKey = useRef<string | null>(null);

  // Count connected edges to determine port count
  const connectedCount = useStore(
    useCallback(
      (s: { edges: { target: string; targetHandle?: string | null }[] }) =>
        s.edges.filter(
          (e) => e.target === id && e.targetHandle?.startsWith(`${id}-in-`),
        ).length,
      [id],
    ),
  );

  // Always keep one empty port available
  const handleCount = Math.max(MIN_PORTS, connectedCount + 1);

  const extract = useCallback(
    (d: Record<string, unknown>): UpstreamData | undefined => {
      // Check toolpath first (3D milling node stores toolpathResult or finishingResult)
      const tpResult = (d.toolpathResult ?? d.finishingResult) as ToolpathGenResult | undefined;
      if (tpResult?.toolpaths) {
        return { type: "toolpath", data: tpResult };
      }
      // Fall back to geometry
      const br = d.brepResult as BrepImportResult | undefined;
      if (br) {
        return { type: "geometry", data: br };
      }
      return undefined;
    },
    [],
  );

  const upstreamResults = useMultiUpstreamData<UpstreamData>(
    id,
    `${id}-in`,
    handleCount,
    extract,
  );

  // Build a stable key from upstream data
  const dataKey = useMemo(() => {
    if (upstreamResults.length === 0) return "";
    return upstreamResults
      .map((r) => {
        if (r.type === "geometry") return `g:${(r.data as BrepImportResult).file_id}`;
        return `t:${(r.data as ToolpathGenResult).toolpaths.length}`;
      })
      .sort()
      .join("+");
  }, [upstreamResults]);

  // Call merge API when upstream data changes
  useEffect(() => {
    if (dataKey === lastKey.current) return;
    lastKey.current = dataKey;

    if (upstreamResults.length === 0) {
      setStatus("idle");
      setObjectCount(0);
      setSourceCount(0);
      setDetectedType("geometry");
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, brepResult: null, toolpathResult: null } } : n,
        ),
      );
      return;
    }

    const dataType = upstreamResults[0].type;
    const allSame = upstreamResults.every((r) => r.type === dataType);
    setDetectedType(dataType);

    if (!allSame) {
      setStatus("error");
      setErrorMsg("Cannot mix geometry and toolpath inputs");
      return;
    }

    // Single source: pass through directly
    if (upstreamResults.length === 1) {
      if (dataType === "geometry") {
        const result = upstreamResults[0].data as BrepImportResult;
        setStatus("done");
        setObjectCount(result.object_count);
        setSourceCount(1);
        setNodes((nds) =>
          nds.map((n) =>
            n.id === id ? { ...n, data: { ...n.data, brepResult: result, toolpathResult: null } } : n,
          ),
        );
      } else {
        const result = upstreamResults[0].data as ToolpathGenResult;
        setStatus("done");
        setObjectCount(result.toolpaths.length);
        setSourceCount(1);
        setNodes((nds) =>
          nds.map((n) =>
            n.id === id ? { ...n, data: { ...n.data, toolpathResult: result, brepResult: null } } : n,
          ),
        );
      }
      return;
    }

    let cancelled = false;
    setStatus("processing");
    setErrorMsg(null);

    if (dataType === "geometry") {
      const fileIds = upstreamResults
        .map((r) => (r.data as BrepImportResult).file_id)
        .sort();
      mergeBReps(fileIds)
        .then((result) => {
          if (cancelled) return;
          setStatus("done");
          setObjectCount(result.object_count);
          setSourceCount(fileIds.length);
          setNodes((nds) =>
            nds.map((n) =>
              n.id === id ? { ...n, data: { ...n.data, brepResult: result, toolpathResult: null } } : n,
            ),
          );
        })
        .catch((err) => {
          if (cancelled) return;
          setStatus("error");
          setErrorMsg(err instanceof Error ? err.message : "Merge failed");
        });
    } else {
      const sources = upstreamResults.map((r) => r.data as ToolpathGenResult);
      mergeToolpaths(sources)
        .then((result) => {
          if (cancelled) return;
          setStatus("done");
          setObjectCount(result.toolpaths.length);
          setSourceCount(upstreamResults.length);
          setNodes((nds) =>
            nds.map((n) =>
              n.id === id ? { ...n, data: { ...n.data, toolpathResult: result, brepResult: null } } : n,
            ),
          );
        })
        .catch((err) => {
          if (cancelled) return;
          setStatus("error");
          setErrorMsg(err instanceof Error ? err.message : "Toolpath merge failed");
        });
    }

    return () => { cancelled = true; };
  }, [id, dataKey, upstreamResults, setNodes]);

  const label = detectedType === "toolpath" ? "toolpaths" : "objects";

  return (
    <NodeShell category="utility" selected={selected} width={180}>
      {Array.from({ length: handleCount }, (_, i) => (
        <LabeledHandle
          key={i}
          type="target"
          id={`${id}-in-${i}`}
          label={`in ${i + 1}`}
          dataType={detectedType}
          index={i}
          total={handleCount}
        />
      ))}

      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, color: "var(--text-primary)" }}>
        Merge
      </div>

      <div style={{ fontSize: 11, color: "var(--text-secondary)", minHeight: 20 }}>
        {status === "idle" && "Connect geometry or toolpath nodes"}
        {status === "processing" && "Merging..."}
        {status === "done" && `${objectCount} ${label} from ${sourceCount} sources`}
        {status === "error" && (
          <span style={{ color: "var(--color-error)" }}>{errorMsg}</span>
        )}
      </div>

      <LabeledHandle type="source" id={`${id}-out`} label="out" dataType={detectedType} />
    </NodeShell>
  );
}

const MergeNode = memo(MergeNodeInner);
export default MergeNode;
