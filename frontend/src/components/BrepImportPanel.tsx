import type { BrepImportResult, ObjectMesh } from "../types";
import MeshViewer from "./MeshViewer";
import { useLayoutDirection } from "../contexts/LayoutDirectionContext";

interface Props {
  brepResult: BrepImportResult;
  meshes: ObjectMesh[];
}

export default function BrepImportPanel({ brepResult, meshes }: Props) {
  const { direction } = useLayoutDirection();
  const isLR = direction === "LR";

  return (
    <div style={isLR ? panelStyleLR : panelStyle}>
      <MeshViewer
        meshes={meshes}
        style={isLR ? { flex: 2, minHeight: 0 } : { flex: 1, minHeight: 300 }}
      />

      <div style={isLR ? infoStyleLR : infoStyle}>
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
  display: "flex",
  flexDirection: "column",
  height: "100%",
};

const panelStyleLR: React.CSSProperties = {
  display: "flex",
  flexDirection: "row",
  height: "100%",
};

const infoStyle: React.CSSProperties = {
  padding: "12px 16px",
  borderTop: "1px solid var(--surface-bg)",
};

const infoStyleLR: React.CSSProperties = {
  flex: 1,
  padding: "12px 16px",
  borderLeft: "1px solid var(--surface-bg)",
  overflowY: "auto",
};

const infoTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: 1,
  paddingBottom: 4,
};

const infoRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: 12,
  padding: "2px 0",
  color: "var(--text-secondary)",
};
