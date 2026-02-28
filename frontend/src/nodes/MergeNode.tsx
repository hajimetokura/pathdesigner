import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type NodeProps, useReactFlow, useStore } from "@xyflow/react";
import LabeledHandle from "./LabeledHandle";
import NodeShell from "../components/NodeShell";
import { useMultiUpstreamData } from "../hooks/useMultiUpstreamData";
import { mergeBReps } from "../api";
import type { BrepImportResult } from "../types";

const MIN_PORTS = 2;

function MergeNodeInner({ id, selected }: NodeProps) {
  const { setNodes } = useReactFlow();

  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [objectCount, setObjectCount] = useState(0);
  const [sourceCount, setSourceCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const lastFileIdsKey = useRef<string | null>(null);

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
    (d: Record<string, unknown>) => d.brepResult as BrepImportResult | undefined,
    [],
  );

  const upstreamResults = useMultiUpstreamData<BrepImportResult>(
    id,
    `${id}-in`,
    handleCount,
    extract,
  );

  // Collect file_ids from upstream and build a stable key
  const fileIds = useMemo(
    () => upstreamResults.map((r) => r.file_id).sort(),
    [upstreamResults],
  );
  const fileIdsKey = fileIds.join("+");

  // Call merge API when upstream file_ids change
  useEffect(() => {
    if (fileIdsKey === lastFileIdsKey.current) return;
    lastFileIdsKey.current = fileIdsKey;

    if (fileIds.length === 0) {
      setStatus("idle");
      setObjectCount(0);
      setSourceCount(0);
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, brepResult: null } } : n,
        ),
      );
      return;
    }

    // Single source: pass through directly without API call
    if (fileIds.length === 1) {
      const result = upstreamResults[0];
      setStatus("done");
      setObjectCount(result.object_count);
      setSourceCount(1);
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, brepResult: result } } : n,
        ),
      );
      return;
    }

    let cancelled = false;
    setStatus("processing");
    setErrorMsg(null);

    mergeBReps(fileIds)
      .then((result) => {
        if (cancelled) return;
        setStatus("done");
        setObjectCount(result.object_count);
        setSourceCount(fileIds.length);
        setNodes((nds) =>
          nds.map((n) =>
            n.id === id ? { ...n, data: { ...n.data, brepResult: result } } : n,
          ),
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : "Merge failed");
      });

    return () => { cancelled = true; };
  }, [id, fileIdsKey, fileIds, upstreamResults, setNodes]);

  return (
    <NodeShell category="utility" selected={selected} width={180}>
      {Array.from({ length: handleCount }, (_, i) => (
        <LabeledHandle
          key={i}
          type="target"
          id={`${id}-in-${i}`}
          label={`in ${i + 1}`}
          dataType="geometry"
          index={i}
          total={handleCount}
        />
      ))}

      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, color: "var(--text-primary)" }}>
        Merge
      </div>

      <div style={{ fontSize: 11, color: "var(--text-secondary)", minHeight: 20 }}>
        {status === "idle" && "Connect geometry nodes"}
        {status === "processing" && "Merging..."}
        {status === "done" && `${objectCount} objects from ${sourceCount} sources`}
        {status === "error" && (
          <span style={{ color: "var(--color-error)" }}>{errorMsg}</span>
        )}
      </div>

      <LabeledHandle type="source" id={`${id}-out`} label="out" dataType="geometry" />
    </NodeShell>
  );
}

const MergeNode = memo(MergeNodeInner);
export default MergeNode;
