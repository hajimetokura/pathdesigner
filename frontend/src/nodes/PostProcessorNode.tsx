import { useCallback, useEffect, useState } from "react";
import { Position, type NodeProps, useReactFlow } from "@xyflow/react";
import type { PostProcessorSettings } from "../types";
import LabeledHandle from "./LabeledHandle";

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

export default function PostProcessorNode({ id }: NodeProps) {
  const { setNodes } = useReactFlow();
  const [settings, setSettings] = useState<PostProcessorSettings>(DEFAULT_SETTINGS);
  const [open, setOpen] = useState(true);

  // Sync settings to node data
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, postProcessorSettings: settings } } : n
      )
    );
  }, [id, settings, setNodes]);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  return (
    <div style={nodeStyle}>
      <div style={headerStyle}>Post Processor</div>

      <SectionHeader label="Machine" open={open} onToggle={toggle} />
      {open && (
        <div style={sectionBody}>
          <NumberField
            label="Safe Z (mm)"
            value={settings.safe_z}
            onChange={(v) => setSettings((s) => ({ ...s, safe_z: v }))}
          />
          <NumberField
            label="Tool #"
            value={settings.tool_number}
            step={1}
            onChange={(v) => setSettings((s) => ({ ...s, tool_number: Math.round(v) }))}
          />
          <NumberField
            label="Home X"
            value={settings.home_position[0]}
            onChange={(v) =>
              setSettings((s) => ({ ...s, home_position: [v, s.home_position[1]] }))
            }
          />
          <NumberField
            label="Home Y"
            value={settings.home_position[1]}
            onChange={(v) =>
              setSettings((s) => ({ ...s, home_position: [s.home_position[0], v] }))
            }
          />
          <NumberField
            label="Warmup (s)"
            value={settings.warmup_pause}
            step={1}
            onChange={(v) =>
              setSettings((s) => ({ ...s, warmup_pause: Math.round(v) }))
            }
          />
        </div>
      )}

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

/* --- Sub-components --- */

function SectionHeader({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={sectionHeaderStyle} onClick={onToggle}>
      <span style={{ marginRight: 4 }}>{open ? "\u25BC" : "\u25B6"}</span>
      {label}
    </div>
  );
}

function NumberField({
  label,
  value,
  step = 0.1,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={fieldRow}>
      <label style={labelStyle}>{label}</label>
      <input
        type="number"
        style={inputStyle}
        value={value}
        step={step}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
    </div>
  );
}

/* --- Styles --- */

const nodeStyle: React.CSSProperties = {
  background: "white",
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: "20px 12px",
  minWidth: 220,
  maxWidth: 280,
  boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
};

const headerStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 13,
  marginBottom: 8,
  color: "#333",
};

const sectionHeaderStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 11,
  padding: "4px 0",
  cursor: "pointer",
  borderTop: "1px solid #eee",
  marginTop: 4,
  color: "#555",
  userSelect: "none",
};

const sectionBody: React.CSSProperties = {
  paddingLeft: 4,
  paddingBottom: 4,
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
  flexShrink: 0,
  marginRight: 8,
};

const inputStyle: React.CSSProperties = {
  fontSize: 11,
  padding: "2px 4px",
  borderRadius: 4,
  border: "1px solid #ccc",
  width: 70,
  textAlign: "right",
};
