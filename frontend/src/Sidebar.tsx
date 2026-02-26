import type { NodeCategory } from "./components/NodeShell";
import { getSidebarGroups } from "./nodeRegistry";
import { useLayoutDirection } from "./contexts/LayoutDirectionContext";

const CATEGORY_COLORS: Record<NodeCategory, string> = {
  cad: "var(--color-cad)",
  cam: "var(--color-cam)",
  utility: "var(--color-utility)",
};

const nodeGroups = getSidebarGroups();

export default function Sidebar() {
  const { direction } = useLayoutDirection();
  const isLR = direction === "LR";

  const onDragStart = (
    event: React.DragEvent,
    nodeType: string,
  ) => {
    event.dataTransfer.setData("application/reactflow", nodeType);
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <aside style={isLR ? sidebarLRStyle : sidebarTBStyle}>
      {nodeGroups.map((group) => (
        <div key={group.category} style={isLR ? groupLRStyle : undefined}>
          <div
            style={{
              ...(isLR ? groupTitleLRStyle : groupTitleTBStyle),
              color: CATEGORY_COLORS[group.category],
            }}
          >
            {group.label}
          </div>
          {group.items.map((item) => (
            <div
              key={item.type}
              draggable
              onDragStart={(e) => onDragStart(e, item.type)}
              style={
                isLR
                  ? { ...itemLRStyle, borderTopColor: CATEGORY_COLORS[group.category] }
                  : { ...itemTBStyle, borderLeftColor: CATEGORY_COLORS[group.category] }
              }
            >
              {item.label}
            </div>
          ))}
        </div>
      ))}
    </aside>
  );
}

/* ── TB (vertical sidebar) ── */

const sidebarTBStyle: React.CSSProperties = {
  width: 160,
  padding: "12px 8px",
  borderRight: "1px solid var(--border-subtle)",
  background: "var(--sidebar-bg)",
  display: "flex",
  flexDirection: "column",
  gap: 6,
  flexShrink: 0,
};

const groupTitleTBStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 1,
  padding: "8px 4px 4px",
};

const itemTBStyle: React.CSSProperties = {
  padding: "8px 10px",
  background: "var(--node-bg)",
  border: "1px solid var(--border-color)",
  borderLeft: "3px solid",
  borderRadius: "var(--radius-control)",
  fontSize: 12,
  cursor: "grab",
  userSelect: "none",
  marginTop: 4,
};

/* ── LR (horizontal toolbar) ── */

const sidebarLRStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 12px",
  borderBottom: "1px solid var(--border-subtle)",
  background: "var(--sidebar-bg)",
  display: "flex",
  flexDirection: "row",
  alignItems: "center",
  gap: 12,
  flexShrink: 0,
  overflowX: "auto",
};

const groupLRStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
};

const groupTitleLRStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 1,
  padding: "0 4px",
  whiteSpace: "nowrap",
};

const itemLRStyle: React.CSSProperties = {
  padding: "4px 8px",
  background: "var(--node-bg)",
  border: "1px solid var(--border-color)",
  borderTop: "2px solid",
  borderRadius: "var(--radius-control)",
  fontSize: 11,
  cursor: "grab",
  userSelect: "none",
  whiteSpace: "nowrap",
};
