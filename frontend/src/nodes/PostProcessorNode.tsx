import { useCallback, useEffect, useState } from "react";
import { Position, type NodeProps, useReactFlow } from "@xyflow/react";
import type { PostProcessorSettings } from "../types";
import type { PanelTab } from "../components/SidePanel";
import LabeledHandle from "./LabeledHandle";
import PostProcessorPanel from "../components/PostProcessorPanel";

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

export default function PostProcessorNode({ id, data }: NodeProps) {
  const { setNodes } = useReactFlow();
  const [settings, setSettings] = useState<PostProcessorSettings>(DEFAULT_SETTINGS);
  const openTab = (data as Record<string, unknown>).openTab as ((tab: PanelTab) => void) | undefined;

  // Sync settings to node data
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, postProcessorSettings: settings } } : n
      )
    );
  }, [id, settings, setNodes]);

  const handleOpenPanel = useCallback(() => {
    if (!openTab) return;
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
    <div style={nodeStyle}>
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
        position={Position.Bottom}
        id={`${id}-out`}
        label="settings"
        dataType="settings"
      />
    </div>
  );
}

/* --- Styles --- */

const nodeStyle: React.CSSProperties = {
  background: "white",
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: "12px",
  width: 200,
  boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  fontWeight: 700,
  fontSize: 13,
  marginBottom: 8,
  color: "#333",
};

const detailBtn: React.CSSProperties = {
  fontSize: 10,
  padding: "2px 8px",
  border: "1px solid #ddd",
  borderRadius: 4,
  background: "#f5f5f5",
  color: "#555",
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
  color: "#555",
};

const valueStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#333",
};
