import type { NodeCategory } from "./components/NodeShell";
import { getSidebarGroups } from "./nodeRegistry";

const CATEGORY_COLORS: Record<NodeCategory, string> = {
  cad: "#ff9800",
  cam: "#00bcd4",
  utility: "#888888",
};

const nodeGroups = getSidebarGroups();

export default function Sidebar() {
  const onDragStart = (
    event: React.DragEvent,
    nodeType: string,
  ) => {
    event.dataTransfer.setData("application/reactflow", nodeType);
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <aside style={sidebarStyle}>
      {nodeGroups.map((group) => (
        <div key={group.category}>
          <div style={{ ...groupTitleStyle, color: CATEGORY_COLORS[group.category] }}>
            {group.label}
          </div>
          {group.items.map((item) => (
            <div
              key={item.type}
              draggable
              onDragStart={(e) => onDragStart(e, item.type)}
              style={{ ...itemStyle, borderLeftColor: CATEGORY_COLORS[group.category] }}
            >
              {item.label}
            </div>
          ))}
        </div>
      ))}
    </aside>
  );
}

const sidebarStyle: React.CSSProperties = {
  width: 160,
  padding: "12px 8px",
  borderRight: "1px solid #e0e0e0",
  background: "#fafafa",
  display: "flex",
  flexDirection: "column",
  gap: 6,
  flexShrink: 0,
};

const groupTitleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 1,
  padding: "8px 4px 4px",
};

const itemStyle: React.CSSProperties = {
  padding: "8px 10px",
  background: "white",
  border: "1px solid #ddd",
  borderLeft: "3px solid",
  borderRadius: 6,
  fontSize: 12,
  cursor: "grab",
  userSelect: "none",
  marginTop: 4,
};
