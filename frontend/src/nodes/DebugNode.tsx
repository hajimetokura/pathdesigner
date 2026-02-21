import { useCallback, useEffect, useRef, useState } from "react";
import {
  Position,
  type NodeProps,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import LabeledHandle from "./LabeledHandle";

export default function DebugNode({ id }: NodeProps) {
  const { setNodes } = useReactFlow();
  const [copied, setCopied] = useState(false);
  const lastJsonRef = useRef<string | null>(null);

  // Reactively watch which edges target this node (stable, no loop)
  const sourceIds = useStore(
    useCallback(
      (s) =>
        s.edges
          .filter((e) => e.target === id)
          .map((e) => e.source)
          .join(","),
      [id]
    )
  );

  // Watch upstream nodes' data only (exclude self to avoid loop)
  const upstreamDataStr = useStore(
    useCallback(
      (s) => {
        if (!sourceIds) return "";
        const ids = sourceIds.split(",");
        const merged: Record<string, unknown> = {};
        for (const sid of ids) {
          const node = s.nodeLookup.get(sid);
          if (node?.data) {
            Object.assign(merged, node.data);
          }
        }
        return Object.keys(merged).length > 0
          ? JSON.stringify(merged, null, 2)
          : "";
      },
      [sourceIds]
    )
  );

  // Pass-through: write upstream data to own node.data (only when changed)
  useEffect(() => {
    if (upstreamDataStr && upstreamDataStr !== lastJsonRef.current) {
      lastJsonRef.current = upstreamDataStr;
      const parsed = JSON.parse(upstreamDataStr);
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, ...parsed } } : n
        )
      );
    }
  }, [id, upstreamDataStr, setNodes]);

  const handleCopy = useCallback(() => {
    if (upstreamDataStr) {
      navigator.clipboard.writeText(upstreamDataStr);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [upstreamDataStr]);

  return (
    <div style={nodeStyle}>
      <LabeledHandle type="target" position={Position.Top} id={`${id}-in`} label="in" dataType="generic" />

      <div style={headerRow}>
        <span style={headerStyle}>Debug</span>
        {upstreamDataStr && (
          <button onClick={handleCopy} style={copyBtnStyle}>
            {copied ? "Copied!" : "Copy"}
          </button>
        )}
      </div>

      {upstreamDataStr ? (
        <pre style={preStyle}>{upstreamDataStr}</pre>
      ) : (
        <div style={{ color: "#999", fontSize: 11, padding: "8px 0" }}>
          Connect to a node
        </div>
      )}

      <LabeledHandle type="source" position={Position.Bottom} id={`${id}-out`} label="out" dataType="generic" />
    </div>
  );
}

const nodeStyle: React.CSSProperties = {
  background: "#1e1e1e",
  border: "1px solid #444",
  borderRadius: 8,
  padding: "20px 12px",
  minWidth: 220,
  maxWidth: 360,
  boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
};

const headerRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 8,
};

const headerStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 13,
  color: "#4fc3f7",
};

const copyBtnStyle: React.CSSProperties = {
  padding: "2px 8px",
  border: "1px solid #555",
  borderRadius: 4,
  background: "transparent",
  color: "#aaa",
  cursor: "pointer",
  fontSize: 10,
};

const preStyle: React.CSSProperties = {
  margin: 0,
  padding: 8,
  background: "#2d2d2d",
  borderRadius: 4,
  fontSize: 10,
  color: "#d4d4d4",
  maxHeight: 300,
  overflow: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  lineHeight: 1.4,
};
