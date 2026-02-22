import type { OutputResult } from "../types";

interface Props {
  outputResult: OutputResult;
  onExport: () => void;
  onClose: () => void;
}

export default function CncCodePanel({ outputResult, onExport, onClose }: Props) {
  const lines = outputResult.code.split("\n");

  return (
    <div style={panelStyle}>
      <div style={panelHeaderStyle}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>
          CNC Code — {outputResult.filename}
        </span>
        <button onClick={onClose} style={closeBtnStyle}>×</button>
      </div>

      <div style={toolbarStyle}>
        <span style={{ fontSize: 11, color: "#666" }}>
          {outputResult.format.toUpperCase()} · {lines.length} lines
        </span>
        <button onClick={onExport} style={exportSmallBtnStyle}>Export</button>
      </div>

      <div style={codeAreaStyle}>
        <pre style={preStyle}>
          {lines.map((line, i) => (
            <div key={i} style={lineStyle}>
              <span style={lineNumStyle}>{i + 1}</span>
              <span>{highlightSbpLine(line)}</span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}

/** Simple regex-based SBP syntax highlighting */
function highlightSbpLine(line: string): React.ReactNode {
  // Comment lines
  if (line.startsWith("'")) {
    return <span style={{ color: "#999" }}>{line}</span>;
  }
  // Control flow: IF, THEN, GOTO, END, PAUSE
  if (/^(IF|THEN|GOTO|END|PAUSE|SA|CN)\b/.test(line)) {
    return <span style={{ color: "#7b61ff" }}>{line}</span>;
  }
  // Movement commands: M3, J2, JZ, MZ
  if (/^(M3|M2|J2|JZ|MZ),/.test(line)) {
    return highlightCommand(line);
  }
  // Speed/settings: MS, JS, TR, C6, C7, C9
  if (/^(MS|JS|TR|C[0-9]+|&Tool)\b/.test(line)) {
    return highlightCommand(line);
  }
  // Label lines (e.g., UNIT_ERROR:)
  if (/^[A-Z_]+:/.test(line)) {
    return <span style={{ color: "#7b61ff" }}>{line}</span>;
  }
  return <span>{line}</span>;
}

function highlightCommand(line: string): React.ReactNode {
  const parts = line.split(",");
  const cmd = parts[0];
  const args = parts.slice(1).join(",");
  return (
    <span>
      <span style={{ color: "#1976d2", fontWeight: 600 }}>{cmd}</span>
      {args && <span style={{ color: "#e65100" }}>,{args}</span>}
    </span>
  );
}

/* --- Styles --- */
const panelStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  right: 0,
  width: 420,
  height: "100vh",
  background: "white",
  borderLeft: "1px solid #ddd",
  boxShadow: "-4px 0 16px rgba(0,0,0,0.1)",
  zIndex: 100,
  display: "flex",
  flexDirection: "column",
};

const panelHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "12px 16px",
  borderBottom: "1px solid #eee",
};

const closeBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  fontSize: 16,
  cursor: "pointer",
  color: "#999",
  padding: "4px 8px",
};

const toolbarStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 16px",
  borderBottom: "1px solid #f0f0f0",
};

const exportSmallBtnStyle: React.CSSProperties = {
  padding: "4px 12px",
  border: "1px solid #66bb6a",
  borderRadius: 4,
  background: "#66bb6a",
  color: "white",
  cursor: "pointer",
  fontSize: 11,
  fontWeight: 600,
};

const codeAreaStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "8px 0",
  background: "#fafafa",
};

const preStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: "'SF Mono', 'Fira Code', monospace",
  fontSize: 12,
  lineHeight: 1.6,
};

const lineStyle: React.CSSProperties = {
  display: "flex",
  padding: "0 16px",
};

const lineNumStyle: React.CSSProperties = {
  width: 36,
  textAlign: "right",
  color: "#bbb",
  marginRight: 12,
  userSelect: "none",
  flexShrink: 0,
};
