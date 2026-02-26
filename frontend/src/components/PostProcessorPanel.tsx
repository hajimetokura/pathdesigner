import type { PostProcessorSettings } from "../types";

interface Props {
  settings: PostProcessorSettings;
  onSettingsChange: (settings: PostProcessorSettings) => void;
}

export default function PostProcessorPanel({ settings, onSettingsChange }: Props) {
  return (
    <div style={panelStyle}>
      <div style={sectionStyle}>
        <div style={sectionTitle}>Machine</div>
        <div style={fieldRow}>
          <label style={labelStyle}>Name</label>
          <span style={valueStyle}>{settings.machine_name}</span>
        </div>
        <div style={fieldRow}>
          <label style={labelStyle}>Bed</label>
          <span style={valueStyle}>
            {settings.bed_size[0]} x {settings.bed_size[1]} mm
          </span>
        </div>
        <div style={fieldRow}>
          <label style={labelStyle}>Format</label>
          <span style={valueStyle}>{settings.output_format.toUpperCase()}</span>
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={sectionTitle}>Settings</div>
        <NumberField
          label="Safe Z (mm)"
          value={settings.safe_z}
          onChange={(v) => onSettingsChange({ ...settings, safe_z: v })}
        />
        <NumberField
          label="Tool #"
          value={settings.tool_number}
          step={1}
          onChange={(v) => onSettingsChange({ ...settings, tool_number: Math.round(v) })}
        />
        <NumberField
          label="Home X"
          value={settings.home_position[0]}
          onChange={(v) =>
            onSettingsChange({ ...settings, home_position: [v, settings.home_position[1]] })
          }
        />
        <NumberField
          label="Home Y"
          value={settings.home_position[1]}
          onChange={(v) =>
            onSettingsChange({ ...settings, home_position: [settings.home_position[0], v] })
          }
        />
        <NumberField
          label="Warmup (s)"
          value={settings.warmup_pause}
          step={1}
          onChange={(v) => onSettingsChange({ ...settings, warmup_pause: Math.round(v) })}
        />
      </div>
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

const panelStyle: React.CSSProperties = {
  padding: "12px 16px",
};

const sectionStyle: React.CSSProperties = {
  marginBottom: 16,
};

const sectionTitle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 12,
  color: "var(--text-primary)",
  marginBottom: 8,
  borderBottom: "1px solid var(--border-subtle)",
  paddingBottom: 4,
};

const fieldRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 6,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-secondary)",
  flexShrink: 0,
  marginRight: 8,
};

const valueStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-primary)",
};

const inputStyle: React.CSSProperties = {
  fontSize: 12,
  padding: "4px 6px",
  borderRadius: "var(--radius-item)",
  border: "1px solid var(--border-color)",
  width: 80,
  textAlign: "right",
  background: "var(--surface-bg)",
  color: "var(--text-primary)",
};
