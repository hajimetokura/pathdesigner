import { useCallback } from "react";
import { Position, type NodeProps } from "@xyflow/react";
import type { OutputResult } from "../types";
import type { PanelTab } from "../components/SidePanel";
import LabeledHandle from "./LabeledHandle";
import CncCodePanel from "../components/CncCodePanel";

export default function CncCodeNode({ id, data }: NodeProps) {
  const openTab = (data as Record<string, unknown>).openTab as ((tab: PanelTab) => void) | undefined;

  // Read outputResult from own node data (pushed by ToolpathGenNode)
  const outputResult = (data as Record<string, unknown>)?.outputResult as OutputResult | undefined;

  const lineCount = outputResult ? outputResult.code.split("\n").length : 0;

  const handleExport = useCallback(() => {
    if (!outputResult) return;
    const blob = new Blob([outputResult.code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = outputResult.filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [outputResult]);

  const handleViewCode = useCallback(() => {
    if (!outputResult || !openTab) return;
    openTab({
      id: `cnc-code-${id}`,
      label: "CNC Code",
      icon: "📄",
      content: <CncCodePanel outputResult={outputResult} onExport={handleExport} />,
    });
  }, [id, outputResult, handleExport, openTab]);

  return (
    <div style={nodeStyle}>
      <LabeledHandle
        type="target"
        position={Position.Top}
        id={`${id}-in`}
        label="output"
        dataType="toolpath"
      />

      <div style={headerStyle}>CNC Code</div>

      {outputResult ? (
        <div style={resultStyle}>
          <div style={fileInfoStyle}>
            {outputResult.format.toUpperCase()} · {lineCount} lines
          </div>
          <button onClick={handleExport} style={exportBtnStyle}>
            Export
          </button>
          <button onClick={handleViewCode} style={viewBtnStyle}>
            View Code
          </button>
        </div>
      ) : (
        <div style={emptyStyle}>No data</div>
      )}
    </div>
  );
}

const nodeStyle: React.CSSProperties = {
  background: "white",
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: "20px 12px",
  minWidth: 200,
  maxWidth: 280,
  boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
};

const headerStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 13,
  marginBottom: 8,
  color: "#333",
};

const resultStyle: React.CSSProperties = {
  fontSize: 12,
};

const fileInfoStyle: React.CSSProperties = {
  color: "#666",
  marginBottom: 8,
};

const exportBtnStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  border: "1px solid #66bb6a",
  borderRadius: 6,
  background: "#66bb6a",
  color: "white",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
  marginBottom: 4,
};

const viewBtnStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 12px",
  border: "1px solid #ddd",
  borderRadius: 6,
  background: "white",
  color: "#333",
  cursor: "pointer",
  fontSize: 11,
};

const emptyStyle: React.CSSProperties = {
  color: "#999",
  fontSize: 11,
};
