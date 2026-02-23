import { useCallback, useEffect, useState } from "react";
import { Position, type NodeProps, useReactFlow } from "@xyflow/react";
import type { SheetMaterial, SheetSettings } from "../types";
import LabeledHandle from "./LabeledHandle";
import NodeShell from "../components/NodeShell";

const DEFAULT_MAT: SheetMaterial = {
  material_id: "sheet_1",
  label: "Sheet",
  width: 1820,
  depth: 910,
  thickness: 24,
  x_position: 0,
  y_position: 0,
};

export default function SheetNode({ id, selected }: NodeProps) {
  const { setNodes } = useReactFlow();
  const [mat, setMat] = useState<SheetMaterial>(DEFAULT_MAT);

  // Sync as SheetSettings to downstream nodes
  useEffect(() => {
    const settings: SheetSettings = { materials: [mat] };
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, sheetSettings: settings } } : n
      )
    );
  }, [id, mat, setNodes]);

  const update = useCallback(
    (field: keyof SheetMaterial, value: string | number) => {
      setMat((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  return (
    <NodeShell category="cam" selected={selected}>
      <div style={headerStyle}>Sheet</div>

      <TextField label="Label" value={mat.label} onChange={(v) => update("label", v)} />
      <div style={dimRow}>
        <NumberField label="W" value={mat.width} onChange={(v) => update("width", v)} />
        <NumberField label="D" value={mat.depth} onChange={(v) => update("depth", v)} />
      </div>
      <NumberField label="Thickness" value={mat.thickness} onChange={(v) => update("thickness", v)} />

      <LabeledHandle
        type="source"
        position={Position.Bottom}
        id={`${id}-out`}
        label="sheet"
        dataType="settings"
      />
    </NodeShell>
  );
}

/* --- Sub-components --- */

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={fieldRow}>
      <label style={labelStyle}>{label}</label>
      <input
        className="nodrag"
        type="number"
        style={inputStyle}
        value={value}
        min={0}
        step={1}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") return;
          const num = parseFloat(raw);
          if (!Number.isNaN(num)) onChange(num);
        }}
        onPointerDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={fieldRow}>
      <label style={labelStyle}>{label}</label>
      <input
        className="nodrag"
        type="text"
        style={{ ...inputStyle, width: "100%", textAlign: "left" }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}

/* --- Styles --- */

const headerStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 13,
  marginBottom: 8,
  color: "#333",
};

const dimRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
};

const fieldRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 4,
  flex: 1,
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
  width: 60,
  textAlign: "right",
};
