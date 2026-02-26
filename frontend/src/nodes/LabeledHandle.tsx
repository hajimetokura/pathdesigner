import { Handle, Position } from "@xyflow/react";

// Data type → color mapping
const handleColors: Record<string, string> = {
  geometry: "var(--handle-geometry)",
  settings: "var(--handle-settings)",
  toolpath: "var(--handle-toolpath)",
  generic: "var(--handle-generic)",
};

interface LabeledHandleProps {
  type: "source" | "target";
  position: Position;
  id: string;
  label: string;
  dataType?: keyof typeof handleColors;
  /** 0-based index among handles on the same side, for horizontal offset */
  index?: number;
  total?: number;
}

export default function LabeledHandle({
  type,
  position,
  id,
  label,
  dataType = "generic",
  index = 0,
  total = 1,
}: LabeledHandleProps) {
  const color = handleColors[dataType] ?? handleColors.generic;
  const isTop = position === Position.Top;

  // Spread handles evenly across the node width
  const leftPercent = total === 1 ? 50 : 20 + (60 / (total - 1)) * index;

  return (
    <div
      style={{
        position: "absolute",
        [isTop ? "top" : "bottom"]: 0,
        left: `${leftPercent}%`,
        transform: "translateX(-50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        pointerEvents: "none",
      }}
    >
      {!isTop && (
        <span style={{ ...labelStyle, marginBottom: 2 }}>{label}</span>
      )}
      <Handle
        type={type}
        position={position}
        id={id}
        style={{
          position: "relative",
          top: "auto",
          bottom: "auto",
          left: "auto",
          transform: "none",
          width: 10,
          height: 10,
          background: color,
          border: `2px solid ${color}`,
          borderRadius: "50%",
          pointerEvents: "all",
        }}
      />
      {isTop && <span style={{ ...labelStyle, marginTop: 2 }}>{label}</span>}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 9,
  color: "var(--text-muted)",
  whiteSpace: "nowrap",
  userSelect: "none",
  lineHeight: 1,
};
