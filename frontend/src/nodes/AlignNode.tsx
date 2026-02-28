import { memo, useState, useEffect, useCallback, useRef } from "react";
import { type NodeProps, useReactFlow } from "@xyflow/react";
import LabeledHandle from "./LabeledHandle";
import NodeShell from "../components/NodeShell";
import { useUpstreamData } from "../hooks/useUpstreamData";
import { alignParts } from "../api";
import type { BrepImportResult } from "../types";

function AlignNodeInner({ id, selected }: NodeProps) {
  const { setNodes } = useReactFlow();

  const brepResult = useUpstreamData<BrepImportResult>(
    id,
    `${id}-brep`,
    (d) => d.brepResult as BrepImportResult | undefined,
  );

  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [partCount, setPartCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const lastFileId = useRef<string | null>(null);

  const upstreamFileId = brepResult?.file_id ?? null;

  // Call align API when upstream file_id changes
  useEffect(() => {
    if (upstreamFileId === lastFileId.current) return;
    lastFileId.current = upstreamFileId;

    if (!upstreamFileId) {
      setStatus("idle");
      setPartCount(0);
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, brepResult: null } } : n,
        ),
      );
      return;
    }

    let cancelled = false;
    setStatus("processing");
    setErrorMsg(null);

    alignParts(upstreamFileId)
      .then((result) => {
        if (cancelled) return;
        setStatus("done");
        setPartCount(result.object_count);
        setNodes((nds) =>
          nds.map((n) =>
            n.id === id ? { ...n, data: { ...n.data, brepResult: result } } : n,
          ),
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : "Align failed");
      });

    return () => { cancelled = true; };
  }, [id, upstreamFileId, setNodes]);

  return (
    <NodeShell category="cam" selected={selected}>
      <LabeledHandle type="target" id={`${id}-brep`} label="brep" dataType="geometry" />

      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, color: "var(--text-primary)" }}>
        Align
      </div>

      <div style={{ fontSize: 11, color: "var(--text-secondary)", minHeight: 20 }}>
        {status === "idle" && "Connect upstream node"}
        {status === "processing" && "Aligning parts..."}
        {status === "done" && `${partCount} parts aligned`}
        {status === "error" && (
          <span style={{ color: "var(--color-error)" }}>{errorMsg}</span>
        )}
      </div>

      <LabeledHandle type="source" id={`${id}-out`} label="out" dataType="geometry" />
    </NodeShell>
  );
}

const AlignNode = memo(AlignNodeInner);
export default AlignNode;
