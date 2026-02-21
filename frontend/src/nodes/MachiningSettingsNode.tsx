import { useCallback, useEffect, useState } from "react";
import { Position, type NodeProps, useReactFlow } from "@xyflow/react";
import { fetchPresets, validateSettings } from "../api";
import type { MachiningSettings, PresetItem } from "../types";
import LabeledHandle from "./LabeledHandle";

const DEFAULT_SETTINGS: MachiningSettings = {
  operation_type: "contour",
  tool: { diameter: 6.35, type: "endmill", flutes: 2 },
  feed_rate: { xy: 75.0, z: 25.0 },
  jog_speed: 200.0,
  spindle_speed: 18000,
  depth_per_pass: 6.0,
  total_depth: 12.0,
  direction: "climb",
  offset_side: "outside",
  tabs: { enabled: true, height: 3.0, width: 5.0, count: 4 },
};

export default function MachiningSettingsNode({ id }: NodeProps) {
  const { setNodes } = useReactFlow();
  const [settings, setSettings] = useState<MachiningSettings>(DEFAULT_SETTINGS);
  const [presets, setPresets] = useState<PresetItem[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    cutting: true,
    toolSpeed: true,
    depth: false,
    tabs: false,
  });

  // Load presets on mount
  useEffect(() => {
    fetchPresets().then(setPresets).catch(console.error);
  }, []);

  // Sync settings to node data
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, machiningSettings: settings } } : n
      )
    );
  }, [id, settings, setNodes]);

  // Validate on settings change (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      validateSettings(settings)
        .then((res) => setWarnings(res.warnings))
        .catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [settings]);

  const handlePresetChange = useCallback(
    (presetId: string) => {
      const preset = presets.find((p) => p.id === presetId);
      if (preset) setSettings(preset.settings);
    },
    [presets]
  );

  const toggleSection = useCallback((key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const updateField = useCallback(
    <K extends keyof MachiningSettings>(key: K, value: MachiningSettings[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  return (
    <div style={nodeStyle}>
      <div style={headerStyle}>Machining Settings</div>

      {/* Preset selector */}
      <div style={fieldRow}>
        <label style={labelStyle}>Preset</label>
        <select
          style={selectStyle}
          onChange={(e) => handlePresetChange(e.target.value)}
          defaultValue=""
        >
          <option value="" disabled>
            -- Select --
          </option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Cutting section */}
      <SectionHeader
        label="Cutting"
        open={openSections.cutting}
        onToggle={() => toggleSection("cutting")}
      />
      {openSections.cutting && (
        <div style={sectionBody}>
          <div style={fieldRow}>
            <label style={labelStyle}>Operation</label>
            <select
              style={selectStyle}
              value={settings.operation_type}
              onChange={(e) => updateField("operation_type", e.target.value)}
            >
              <option value="contour">Contour</option>
              <option value="pocket">Pocket</option>
              <option value="drill">Drill</option>
              <option value="engrave">Engrave</option>
            </select>
          </div>
          <div style={fieldRow}>
            <label style={labelStyle}>Direction</label>
            <select
              style={selectStyle}
              value={settings.direction}
              onChange={(e) => updateField("direction", e.target.value)}
            >
              <option value="climb">Climb</option>
              <option value="conventional">Conventional</option>
            </select>
          </div>
          <div style={fieldRow}>
            <label style={labelStyle}>Offset side</label>
            <select
              style={selectStyle}
              value={settings.offset_side}
              onChange={(e) => updateField("offset_side", e.target.value)}
            >
              <option value="outside">Outside</option>
              <option value="inside">Inside</option>
              <option value="none">None</option>
            </select>
          </div>
        </div>
      )}

      {/* Tool & Speed section */}
      <SectionHeader
        label="Tool & Speed"
        open={openSections.toolSpeed}
        onToggle={() => toggleSection("toolSpeed")}
      />
      {openSections.toolSpeed && (
        <div style={sectionBody}>
          <NumberField
            label="Tool dia. (mm)"
            value={settings.tool.diameter}
            onChange={(v) =>
              updateField("tool", { ...settings.tool, diameter: v })
            }
          />
          <div style={fieldRow}>
            <label style={labelStyle}>Tool type</label>
            <select
              style={selectStyle}
              value={settings.tool.type}
              onChange={(e) =>
                updateField("tool", { ...settings.tool, type: e.target.value })
              }
            >
              <option value="endmill">End Mill</option>
              <option value="ballnose">Ball Nose</option>
              <option value="v_bit">V-Bit</option>
            </select>
          </div>
          <NumberField
            label="Flutes"
            value={settings.tool.flutes}
            step={1}
            onChange={(v) =>
              updateField("tool", { ...settings.tool, flutes: Math.round(v) })
            }
          />
          <NumberField
            label="Feed XY (mm/s)"
            value={settings.feed_rate.xy}
            onChange={(v) =>
              updateField("feed_rate", { ...settings.feed_rate, xy: v })
            }
          />
          <NumberField
            label="Feed Z (mm/s)"
            value={settings.feed_rate.z}
            onChange={(v) =>
              updateField("feed_rate", { ...settings.feed_rate, z: v })
            }
          />
          <NumberField
            label="Jog (mm/s)"
            value={settings.jog_speed}
            onChange={(v) => updateField("jog_speed", v)}
          />
          <NumberField
            label="Spindle (RPM)"
            value={settings.spindle_speed}
            step={1000}
            onChange={(v) => updateField("spindle_speed", Math.round(v))}
          />
        </div>
      )}

      {/* Depth section */}
      <SectionHeader
        label="Depth"
        open={openSections.depth}
        onToggle={() => toggleSection("depth")}
      />
      {openSections.depth && (
        <div style={sectionBody}>
          <NumberField
            label="Per pass (mm)"
            value={settings.depth_per_pass}
            onChange={(v) => updateField("depth_per_pass", v)}
          />
          <NumberField
            label="Total (mm)"
            value={settings.total_depth}
            onChange={(v) => updateField("total_depth", v)}
          />
        </div>
      )}

      {/* Tabs section */}
      <SectionHeader
        label="Tabs"
        open={openSections.tabs}
        onToggle={() => toggleSection("tabs")}
      />
      {openSections.tabs && (
        <div style={sectionBody}>
          <div style={fieldRow}>
            <label style={labelStyle}>Enabled</label>
            <input
              type="checkbox"
              checked={settings.tabs.enabled}
              onChange={(e) =>
                updateField("tabs", { ...settings.tabs, enabled: e.target.checked })
              }
            />
          </div>
          {settings.tabs.enabled && (
            <>
              <NumberField
                label="Height (mm)"
                value={settings.tabs.height}
                onChange={(v) =>
                  updateField("tabs", { ...settings.tabs, height: v })
                }
              />
              <NumberField
                label="Width (mm)"
                value={settings.tabs.width}
                onChange={(v) =>
                  updateField("tabs", { ...settings.tabs, width: v })
                }
              />
              <NumberField
                label="Count"
                value={settings.tabs.count}
                step={1}
                onChange={(v) =>
                  updateField("tabs", { ...settings.tabs, count: Math.round(v) })
                }
              />
            </>
          )}
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div style={warningBox}>
          {warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 11 }}>
              {w}
            </div>
          ))}
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

const selectStyle: React.CSSProperties = {
  fontSize: 11,
  padding: "2px 4px",
  borderRadius: 4,
  border: "1px solid #ccc",
  flex: 1,
  minWidth: 0,
};

const inputStyle: React.CSSProperties = {
  fontSize: 11,
  padding: "2px 4px",
  borderRadius: 4,
  border: "1px solid #ccc",
  width: 70,
  textAlign: "right",
};

const warningBox: React.CSSProperties = {
  marginTop: 8,
  padding: "6px 8px",
  background: "#fff3e0",
  border: "1px solid #ffb74d",
  borderRadius: 4,
  color: "#e65100",
};
