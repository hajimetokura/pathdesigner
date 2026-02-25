import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { Position, type NodeProps, useReactFlow } from "@xyflow/react";
import LabeledHandle from "./LabeledHandle";
import NodeShell from "../components/NodeShell";
import SnippetLibraryPanel from "../components/SnippetLibraryPanel";
import type { AiCadResult } from "../types";
import { useUpstreamData } from "../hooks/useUpstreamData";
import { usePanelTabs } from "../contexts/PanelTabsContext";

export default function SnippetDbNode({ id, selected }: NodeProps) {
  const { openTab, updateTab } = usePanelTabs();
  const { setNodes } = useReactFlow();

  const extractUpstream = useCallback(
    (d: Record<string, unknown>) => d.result as AiCadResult | undefined,
    [],
  );
  const upstream = useUpstreamData(id, `${id}-input`, extractUpstream);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const handleSelect = useCallback((sid: string | null, sname: string | null) => {
    setSelectedId(sid);
    setSelectedName(sname);
  }, []);

  const handleExecute = useCallback(
    (result: AiCadResult) => {
      setNodes((nodes) =>
        nodes.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, outputResult: result } } : n,
        ),
      );
    },
    [id, setNodes],
  );

  const handleOpenLibrary = useCallback(() => {
    openTab({
      id: `snippet-lib-${id}`,
      label: "Code Library",
      icon: "📚",
      content: (
        <SnippetLibraryPanel
          upstream={upstream}
          selectedId={selectedId}
          onSelect={handleSelect}
          onExecute={handleExecute}
        />
      ),
    });
  }, [id, upstream, selectedId, openTab, handleSelect, handleExecute]);

  // タブが開いている場合、upstream/selectedId の変化を反映する
  useEffect(() => {
    updateTab({
      id: `snippet-lib-${id}`,
      label: "Code Library",
      icon: "📚",
      content: (
        <SnippetLibraryPanel
          upstream={upstream}
          selectedId={selectedId}
          onSelect={handleSelect}
          onExecute={handleExecute}
        />
      ),
    });
  }, [id, upstream, selectedId, updateTab, handleSelect, handleExecute]);

  return (
    <NodeShell category="cad" selected={selected}>
      <LabeledHandle
        type="target"
        position={Position.Top}
        id={`${id}-input`}
        label="input"
        dataType="code"
      />

      <div style={headerStyle}>Code Library</div>

      <div style={summaryStyle}>
        {selectedName ? (
          <span style={{ color: "#333" }}>📦 {selectedName}</span>
        ) : (
          <span style={{ color: "#999" }}>スニペット未選択</span>
        )}
      </div>

      <button onClick={handleOpenLibrary} style={openBtnStyle}>
        Open Library
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
  fontWeight: 700, fontSize: 13, marginBottom: 8, color: "#333",
};
const summaryStyle: React.CSSProperties = {
  fontSize: 12, marginBottom: 8, minHeight: 20,
};
const openBtnStyle: React.CSSProperties = {
  width: "100%", padding: "6px 12px", border: "1px solid #ddd", borderRadius: 6,
  background: "white", color: "#333", cursor: "pointer", fontSize: 11,
};
