import type { BrepImportResult, ObjectMesh } from "../types";
import MeshViewer from "./MeshViewer";

interface Props {
  brepResult: BrepImportResult;
  meshes: ObjectMesh[];
  onClose: () => void;
}

export default function BrepImportPanel({ brepResult, meshes, onClose }: Props) {
  return (
    <div style={panelStyle}>
      <div style={panelHeaderStyle}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>BREP Import — 3D Preview</span>
        <button onClick={onClose} style={closeBtnStyle}>×</button>
      </div>

      <MeshViewer
        meshes={meshes}
        style={{ flex: 1, minHeight: 300 }}
      />

      <div style={infoStyle}>
        <div style={infoTitle}>Objects</div>
        {brepResult.objects.map((obj) => (
          <div key={obj.object_id} style={infoRow}>
            <span>{obj.object_id}</span>
            <span>
              {obj.bounding_box.x.toFixed(1)} × {obj.bounding_box.y.toFixed(1)} × {obj.bounding_box.z.toFixed(1)} {obj.unit}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  right: 0,
  width: 480,
  height: "100vh",
  background: "white",
  borderLeft: "1px solid #ddd",
  boxShadow: "-4px 0 16px rgba(0,0,0,0.1)",
  zIndex: 100,
  display: "flex",
  flexDirection: "column",
};

const panelHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "12px 16px",
  borderBottom: "1px solid #eee",
};

const closeBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  fontSize: 16,
  cursor: "pointer",
  color: "#999",
  padding: "4px 8px",
};

const infoStyle: React.CSSProperties = {
  padding: "12px 16px",
  borderTop: "1px solid #f0f0f0",
};

const infoTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "#888",
  textTransform: "uppercase",
  letterSpacing: 1,
  paddingBottom: 4,
};

const infoRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: 12,
  padding: "2px 0",
  color: "#555",
};
