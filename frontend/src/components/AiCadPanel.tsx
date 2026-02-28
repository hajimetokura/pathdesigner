import { useState } from "react";

interface Props {
  code: string;
  prompt: string;
  model: string;
  onRerun: (code: string) => void;
}

export default function AiCadPanel({ code, prompt, model, onRerun }: Props) {
  const [editedCode, setEditedCode] = useState(code);
  const [isEditing, setIsEditing] = useState(false);

  const handleRerun = () => {
    onRerun(editedCode);
  };

  return (
    <div style={panelStyle}>
      <div style={metaStyle}>
        <div style={metaRow}>
          <span style={metaLabel}>Prompt:</span>
          <span>{prompt}</span>
        </div>
        <div style={metaRow}>
          <span style={metaLabel}>Model:</span>
          <span>{model}</span>
        </div>
      </div>

      <div style={codeSection}>
        <div style={codeLabelRow}>
          <span style={metaLabel}>build123d Code</span>
          <button
            onClick={() => setIsEditing(!isEditing)}
            style={toggleBtn}
          >
            {isEditing ? "Cancel Edit" : "Edit"}
          </button>
        </div>

        {isEditing ? (
          <>
            <textarea
              value={editedCode}
              onChange={(e) => setEditedCode(e.target.value)}
              style={editorStyle}
              rows={20}
              spellCheck={false}
            />
            <button onClick={handleRerun} style={rerunBtn}>
              Re-run Code
            </button>
          </>
        ) : (
          <pre style={preStyle}>{code}</pre>
        )}
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", height: "100%",
  overflow: "hidden",
};
const metaStyle: React.CSSProperties = {
  padding: "12px 16px", borderBottom: "1px solid var(--surface-bg)",
};
const metaRow: React.CSSProperties = {
  fontSize: 12, padding: "2px 0", color: "var(--text-secondary)",
};
const metaLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
  textTransform: "uppercase", letterSpacing: 1, marginRight: 8,
};
const codeSection: React.CSSProperties = {
  flex: 1, display: "flex", flexDirection: "column",
  padding: "12px 16px", overflow: "hidden",
};
const codeLabelRow: React.CSSProperties = {
  display: "flex", justifyContent: "space-between",
  alignItems: "center", marginBottom: 8,
};
const toggleBtn: React.CSSProperties = {
  padding: "4px 12px", border: "1px solid var(--border-color)", borderRadius: "var(--radius-item)",
  background: "var(--node-bg)", cursor: "pointer", fontSize: 11,
};
const preStyle: React.CSSProperties = {
  flex: 1, overflow: "auto", background: "#1e1e1e", color: "#d4d4d4",
  padding: 16, borderRadius: 8, fontSize: 13,
  fontFamily: "'SF Mono', 'Fira Code', monospace",
  lineHeight: 1.5, margin: 0, whiteSpace: "pre-wrap",
};
const editorStyle: React.CSSProperties = {
  flex: 1, background: "#1e1e1e", color: "#d4d4d4",
  padding: 16, borderRadius: 8, fontSize: 13,
  fontFamily: "'SF Mono', 'Fira Code', monospace",
  lineHeight: 1.5, border: "2px solid var(--color-cad)",
  resize: "none", boxSizing: "border-box",
};
const rerunBtn: React.CSSProperties = {
  padding: "8px 16px", border: "none", borderRadius: "var(--radius-control)",
  background: "var(--color-cad)", color: "white", cursor: "pointer",
  fontSize: 12, fontWeight: 600, marginTop: 8,
};
