// frontend/src/nodes/CodeNode.tsx
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { Position, type NodeProps, useReactFlow } from "@xyflow/react";
import LabeledHandle from "./LabeledHandle";
import NodeShell from "../components/NodeShell";
import CodeEditorPanel from "../components/CodeEditorPanel";
import type { AiCadResult } from "../types";
import { usePanelTabs } from "../contexts/PanelTabsContext";

type RunStatus = "idle" | "running" | "success" | "error";

export default function CodeNode({ id, selected }: NodeProps) {
  const { openTab, updateTab } = usePanelTabs();
  const { setNodes } = useReactFlow();

  const [status, setStatus] = useState<RunStatus>("idle");
  const [result, setResult] = useState<AiCadResult | null>(null);
  const [code, setCode] = useState<string | undefined>(undefined);

  const handleResult = useCallback(
    (r: AiCadResult) => {
      setResult(r);
      setStatus("success");
      setNodes((nodes) =>
        nodes.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, brepResult: r } } : n,
        ),
      );
    },
    [id, setNodes],
  );

  const panelContent = (
    <CodeEditorPanel
      initialCode={code}
      onResult={handleResult}
      onCodeChange={setCode}
    />
  );

  const handleOpenEditor = useCallback(() => {
    openTab({
      id: `code-editor-${id}`,
      label: "Code Editor",
      icon: "{}",
      content: panelContent,
    });
  }, [id, openTab, panelContent]);

  // タブが開いている場合、state変化を反映する
  useEffect(() => {
    updateTab({
      id: `code-editor-${id}`,
      label: "Code Editor",
      icon: "{}",
      content: panelContent,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, code, result, updateTab]);

  return (
    <NodeShell category="cad" selected={selected}>
      <div style={headerStyle}>Code Node</div>

      <div style={summaryStyle}>
        {status === "success" && result ? (
          <span style={{ color: "var(--color-success)" }}>
            ✅ {result.object_count} object{result.object_count > 1 ? "s" : ""}
          </span>
        ) : status === "error" ? (
          <span style={{ color: "var(--color-error)" }}>❌ Error</span>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>コード未実行</span>
        )}
      </div>

      <button onClick={handleOpenEditor} style={openBtnStyle}>
        Open Editor
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
  fontWeight: 700, fontSize: 13, marginBottom: 8, color: "var(--text-primary)",
};
const summaryStyle: React.CSSProperties = {
  fontSize: 12, marginBottom: 8, minHeight: 20,
};
const openBtnStyle: React.CSSProperties = {
  width: "100%", padding: "6px 12px", border: "1px solid var(--border-color)", borderRadius: "var(--radius-control)",
  background: "var(--node-bg)", color: "var(--text-primary)", cursor: "pointer", fontSize: 11,
};
