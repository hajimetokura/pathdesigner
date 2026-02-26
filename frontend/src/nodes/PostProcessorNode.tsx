import { useCallback, useEffect, useState } from "react";
import { type NodeProps, useReactFlow } from "@xyflow/react";
import type { PostProcessorSettings } from "../types";
import LabeledHandle from "./LabeledHandle";
import NodeShell from "../components/NodeShell";
import PostProcessorPanel from "../components/PostProcessorPanel";
import { usePanelTabs } from "../contexts/PanelTabsContext";

const DEFAULT_SETTINGS: PostProcessorSettings = {
  machine_name: "ShopBot PRS-alpha 96-48",
  output_format: "sbp",
  unit: "mm",
  bed_size: [1220.0, 2440.0],
  safe_z: 38.0,
  home_position: [0.0, 0.0],
  tool_number: 3,
  warmup_pause: 2,
};

export default function PostProcessorNode({ id, selected }: NodeProps) {
  const { setNodes } = useReactFlow();
  const [settings, setSettings] = useState<PostProcessorSettings>(DEFAULT_SETTINGS);
  const { openTab } = usePanelTabs();

  // Sync settings to node data
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, postProcessorSettings: settings } } : n
      )
    );
  }, [id, settings, setNodes]);

  const handleOpenPanel = useCallback(() => {
    openTab({
      id: `postproc-${id}`,
      label: "Post Proc",
      icon: "🔧",
      content: (
        <PostProcessorPanel
          settings={settings}
          onSettingsChange={setSettings}
        />
      ),
    });
  }, [id, settings, openTab]);

  return (
    <NodeShell category="cam" selected={selected}>
      <div style={headerStyle}>
        <span>Post Processor</span>
        <button style={detailBtn} onClick={handleOpenPanel}>Details</button>
      </div>
      <div style={fieldRow}>
        <span style={labelStyle}>Machine</span>
        <span style={valueStyle}>ShopBot</span>
      </div>
      <div style={fieldRow}>
        <span style={labelStyle}>Bed</span>
        <span style={valueStyle}>{settings.bed_size[0]}x{settings.bed_size[1]}mm</span>
      </div>
      <div style={fieldRow}>
        <span style={labelStyle}>Format</span>
        <span style={valueStyle}>{settings.output_format.toUpperCase()}</span>
      </div>

      <LabeledHandle
        type="source"
        id={`${id}-out`}
        label="settings"
        dataType="settings"
      />
    </NodeShell>
  );
}

/* --- Styles --- */

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  fontWeight: 700,
  fontSize: 13,
  marginBottom: 8,
  color: "var(--text-primary)",
};

const detailBtn: React.CSSProperties = {
  fontSize: 10,
  padding: "2px 8px",
  border: "1px solid var(--border-color)",
  borderRadius: "var(--radius-item)",
  background: "var(--surface-bg)",
  color: "var(--text-secondary)",
  cursor: "pointer",
};

const fieldRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 4,
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-secondary)",
};

const valueStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-primary)",
};
