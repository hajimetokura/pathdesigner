import { useCallback, useEffect, useState } from "react";
import { Position, type NodeProps, useReactFlow } from "@xyflow/react";
import type { StockMaterial, StockSettings } from "../types";
import LabeledHandle from "./LabeledHandle";

let nextMaterialId = 1;

function createMaterial(): StockMaterial {
  const id = `mtl_${nextMaterialId++}`;
  return {
    material_id: id,
    label: "",
    width: 600,
    depth: 400,
    thickness: 18,
    x_position: 0,
    y_position: 0,
  };
}

const DEFAULT_SETTINGS: StockSettings = {
  materials: [createMaterial()],
};

export default function StockNode({ id }: NodeProps) {
  const { setNodes } = useReactFlow();
  const [settings, setSettings] = useState<StockSettings>(DEFAULT_SETTINGS);
  const [openMaterials, setOpenMaterials] = useState<Record<string, boolean>>({
    [DEFAULT_SETTINGS.materials[0].material_id]: true,
  });

  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, stockSettings: settings } } : n
      )
    );
  }, [id, settings, setNodes]);

  const addMaterial = useCallback(() => {
    const mat = createMaterial();
    setSettings((s) => ({ materials: [...s.materials, mat] }));
    setOpenMaterials((prev) => ({ ...prev, [mat.material_id]: true }));
  }, []);

  const removeMaterial = useCallback((materialId: string) => {
    setSettings((s) => ({
      materials: s.materials.filter((m) => m.material_id !== materialId),
    }));
    setOpenMaterials((prev) => {
      const next = { ...prev };
      delete next[materialId];
      return next;
    });
  }, []);

  const updateMaterial = useCallback(
    (materialId: string, field: keyof StockMaterial, value: string | number) => {
      setSettings((s) => ({
        materials: s.materials.map((m) =>
          m.material_id === materialId ? { ...m, [field]: value } : m
        ),
      }));
    },
    []
  );

  const toggleMaterial = useCallback((materialId: string) => {
    setOpenMaterials((prev) => ({ ...prev, [materialId]: !prev[materialId] }));
  }, []);

  return (
    <div style={nodeStyle}>
      <div style={headerStyle}>Stock</div>

      {settings.materials.map((mat, i) => (
        <div key={mat.material_id}>
          <div style={materialHeaderStyle} onClick={() => toggleMaterial(mat.material_id)}>
            <span style={{ marginRight: 4 }}>
              {openMaterials[mat.material_id] ? "\u25BC" : "\u25B6"}
            </span>
            <span style={{ flex: 1 }}>
              {mat.label || `Material ${i + 1}`}
            </span>
            {settings.materials.length > 1 && (
              <button
                style={removeBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  removeMaterial(mat.material_id);
                }}
              >
                x
              </button>
            )}
          </div>

          {openMaterials[mat.material_id] && (
            <div style={sectionBody}>
              <TextField
                label="Label"
                value={mat.label}
                onChange={(v) => updateMaterial(mat.material_id, "label", v)}
              />
              <NumberField
                label="Width (mm)"
                value={mat.width}
                onChange={(v) => updateMaterial(mat.material_id, "width", v)}
              />
              <NumberField
                label="Depth (mm)"
                value={mat.depth}
                onChange={(v) => updateMaterial(mat.material_id, "depth", v)}
              />
              <NumberField
                label="Thickness (mm)"
                value={mat.thickness}
                onChange={(v) => updateMaterial(mat.material_id, "thickness", v)}
              />
            </div>
          )}
        </div>
      ))}

      <button style={addBtn} onClick={addMaterial}>
        + Add Material
      </button>

      <LabeledHandle
        type="source"
        position={Position.Bottom}
        id={`${id}-out`}
        label="stock"
        dataType="settings"
      />
    </div>
  );
}

/* --- Sub-components --- */

function NumberField({
  label,
  value,
  step = 1,
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
        type="text"
        style={{ ...inputStyle, width: 100, textAlign: "left" }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
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

const materialHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
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

const addBtn: React.CSSProperties = {
  width: "100%",
  padding: "4px 0",
  marginTop: 6,
  fontSize: 11,
  border: "1px dashed #ccc",
  borderRadius: 4,
  background: "#fafafa",
  cursor: "pointer",
  color: "#666",
};

const removeBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "#999",
  fontSize: 12,
  padding: "0 4px",
  lineHeight: 1,
};
