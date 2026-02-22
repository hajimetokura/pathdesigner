import { useCallback, useEffect, useState } from "react";
import { Position, type NodeProps, useReactFlow } from "@xyflow/react";
import type { PostProcessorSettings } from "../types";
import LabeledHandle from "./LabeledHandle";

const DEFAULT_SETTINGS: PostProcessorSettings = {
  machine: "shopbot",
  output_format: "sbp",
  unit: "mm",
  safe_z: 38.0,
  home_position: [0.0, 0.0],
  tool_number: 3,
  spindle_warmup: { initial_rpm: 5000, wait_seconds: 2 },
  material: { width: 600, depth: 400, thickness: 18, x_offset: 0, y_offset: 0 },
};

export default function PostProcessorNode({ id }: NodeProps) {
  const { setNodes } = useReactFlow();
  const [settings, setSettings] = useState<PostProcessorSettings>(DEFAULT_SETTINGS);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    machine: true,
    material: true,
  });

  // Sync settings to node data
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, postProcessorSettings: settings } } : n
      )
    );
  }, [id, settings, setNodes]);

  const toggleSection = useCallback((key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return (
    <div style={nodeStyle}>
      <div style={headerStyle}>Post Processor</div>

      {/* Machine section */}
      <SectionHeader
        label="Machine"
        open={openSections.machine}
        onToggle={() => toggleSection("machine")}
      />
      {openSections.machine && (
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
            label="Warmup RPM"
            value={settings.spindle_warmup.initial_rpm}
            step={1000}
            onChange={(v) =>
              setSettings((s) => ({
                ...s,
                spindle_warmup: { ...s.spindle_warmup, initial_rpm: Math.round(v) },
              }))
            }
          />
          <NumberField
            label="Warmup (s)"
            value={settings.spindle_warmup.wait_seconds}
            step={1}
            onChange={(v) =>
              setSettings((s) => ({
                ...s,
                spindle_warmup: { ...s.spindle_warmup, wait_seconds: Math.round(v) },
              }))
            }
          />
        </div>
      )}

      {/* Material section */}
      <SectionHeader
        label="Material"
        open={openSections.material}
        onToggle={() => toggleSection("material")}
      />
      {openSections.material && (
        <div style={sectionBody}>
          <NumberField
            label="Width (mm)"
            value={settings.material.width}
            onChange={(v) =>
              setSettings((s) => ({ ...s, material: { ...s.material, width: v } }))
            }
          />
          <NumberField
            label="Depth (mm)"
            value={settings.material.depth}
            onChange={(v) =>
              setSettings((s) => ({ ...s, material: { ...s.material, depth: v } }))
            }
          />
          <NumberField
            label="Thickness (mm)"
            value={settings.material.thickness}
            onChange={(v) =>
              setSettings((s) => ({ ...s, material: { ...s.material, thickness: v } }))
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
