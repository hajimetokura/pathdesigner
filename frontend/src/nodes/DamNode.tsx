import { useCallback, useEffect, useRef, useState } from "react";
import { Position, type NodeProps, useReactFlow } from "@xyflow/react";
import LabeledHandle from "./LabeledHandle";
import NodeShell from "../components/NodeShell";
import { useUpstreamData } from "../hooks/useUpstreamData";

export default function DamNode({ id, selected }: NodeProps) {
  const { setNodes } = useReactFlow();
  const [hasUpdate, setHasUpdate] = useState(false);
  const releasedRef = useRef<string | null>(null);

  // Pass through all upstream data
  const extractAll = useCallback(
    (d: Record<string, unknown>) => d,
    [],
  );
  const upstreamData = useUpstreamData(id, `${id}-in`, extractAll);

  // Detect when upstream data differs from what was released
  useEffect(() => {
    if (!upstreamData) return;
    const key = JSON.stringify(upstreamData);
    setHasUpdate(key !== releasedRef.current);
  }, [upstreamData]);

  const handleRelease = useCallback(() => {
    if (!upstreamData) return;
    const key = JSON.stringify(upstreamData);
    releasedRef.current = key;
    setHasUpdate(false);
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, ...upstreamData } }
          : n,
      ),
    );
  }, [id, upstreamData, setNodes]);

  return (
    <NodeShell category="utility" selected={selected} width={140} statusBorder={hasUpdate ? "#ffc107" : undefined}>
      <LabeledHandle
        type="target"
        position={Position.Top}
        id={`${id}-in`}
        label="in"
        dataType="geometry"
      />

      <div style={headerStyle}>Dam</div>

      <div style={statusStyle}>
        {!upstreamData && <span style={{ color: "#999" }}>No input</span>}
        {upstreamData && !hasUpdate && (
          <span style={{ color: "#4caf50", fontSize: 11 }}>Up to date</span>
        )}
        {upstreamData && hasUpdate && (
          <span style={{ color: "#f57f17", fontSize: 11, fontWeight: 600 }}>
            Update pending
          </span>
        )}
      </div>

      <button
        onClick={handleRelease}
        disabled={!upstreamData || !hasUpdate}
        style={{
          ...buttonStyle,
          opacity: !upstreamData || !hasUpdate ? 0.4 : 1,
          cursor: !upstreamData || !hasUpdate ? "default" : "pointer",
        }}
      >
        Release
      </button>

      <LabeledHandle
        type="source"
        position={Position.Bottom}
        id={`${id}-out`}
        label="out"
        dataType="geometry"
      />
    </NodeShell>
  );
}

const headerStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 13,
  marginBottom: 8,
  color: "#333",
};

const statusStyle: React.CSSProperties = {
  marginBottom: 8,
  fontSize: 11,
};

const buttonStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 10px",
  border: "1px solid #ffc107",
  borderRadius: 6,
  background: "#fff8e1",
  color: "#f57f17",
  fontSize: 11,
  fontWeight: 600,
};
