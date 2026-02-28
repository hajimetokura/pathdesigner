import { Handle, Position } from "@xyflow/react";
import { useLayoutDirection } from "../contexts/LayoutDirectionContext";

// Data type → color mapping
const handleColors: Record<string, string> = {
  geometry: "var(--handle-geometry)",
  settings: "var(--handle-settings)",
  toolpath: "var(--handle-toolpath)",
  sketch: "var(--handle-sketch)",
  generic: "var(--handle-generic)",
};

// Data type → small icon (Unicode symbols that render well at small sizes)
const handleIcons: Record<string, string> = {
  geometry: "⬡",   // hexagon — 3D shape
  settings: "⚙",   // gear
  toolpath: "⤳",   // squiggly arrow — path
  sketch: "✏",     // pencil — freehand sketch
  generic: "○",
};

interface LabeledHandleProps {
  type: "source" | "target";
  position?: Position;
  id: string;
  label: string;
  dataType?: keyof typeof handleColors;
  /** 0-based index among handles on the same side, for spread offset */
  index?: number;
  total?: number;
}

export default function LabeledHandle({
  type,
  position: positionOverride,
  id,
  label,
  dataType = "generic",
  index = 0,
  total = 1,
}: LabeledHandleProps) {
  const { direction } = useLayoutDirection();
  const color = handleColors[dataType] ?? handleColors.generic;
  const icon = handleIcons[dataType] ?? handleIcons.generic;

  // Resolve position from layout direction (unless explicitly overridden)
  const position =
    positionOverride ??
    (type === "target"
      ? direction === "TB" ? Position.Top : Position.Left
      : direction === "TB" ? Position.Bottom : Position.Right);

  const isVertical = position === Position.Top || position === Position.Bottom;
  const isBeforeContent = position === Position.Top || position === Position.Left;

  // Spread handles evenly across the node width (TB) or height (LR)
  const spreadPercent = total === 1 ? 50 : 20 + (60 / (total - 1)) * index;

  // Offset: push dot half-outside the node boundary
  const DOT_SIZE = 8;
  const offset = -(DOT_SIZE / 2 + 1); // -5px: dot sits half outside

  const wrapperStyle: React.CSSProperties = {
    position: "absolute",
    ...(isVertical
      ? {
          [isBeforeContent ? "top" : "bottom"]: offset,
          left: `${spreadPercent}%`,
          transform: "translateX(-50%)",
          flexDirection: "column" as const,
        }
      : {
          [isBeforeContent ? "left" : "right"]: offset,
          top: `${spreadPercent}%`,
          transform: "translateY(-50%)",
          flexDirection: "row" as const,
        }),
    display: "flex",
    alignItems: "center",
    pointerEvents: "none",
  };

  const iconEl = (
    <span style={{ ...iconStyle, color }} title={label}>
      {icon}
    </span>
  );

  return (
    <div style={wrapperStyle}>
      {!isBeforeContent && iconEl}
      <Handle
        type={type}
        position={position}
        id={id}
        style={{
          position: "relative",
          top: "auto",
          bottom: "auto",
          left: "auto",
          right: "auto",
          transform: "none",
          width: DOT_SIZE,
          height: DOT_SIZE,
          background: color,
          border: `2px solid ${color}`,
          borderRadius: "50%",
          pointerEvents: "all",
        }}
      />
      {isBeforeContent && iconEl}
    </div>
  );
}

const iconStyle: React.CSSProperties = {
  fontSize: 15,
  lineHeight: 1,
  userSelect: "none",
  margin: 1,
};
