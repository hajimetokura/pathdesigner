const nodeItems = [
  { type: "brepImport", label: "BREP Import", color: "#4a90d9" },
  { type: "stock", label: "Stock", color: "#ff9800" },
  { type: "operation", label: "Operation", color: "#7b61ff" },
  { type: "postProcessor", label: "Post Processor", color: "#66bb6a" },
  { type: "toolpathGen", label: "Toolpath Gen", color: "#ef5350" },
  { type: "debug", label: "Debug", color: "#4fc3f7" },
] as const;

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
      <div style={titleStyle}>Nodes</div>
      {nodeItems.map((item) => (
        <div
          key={item.type}
          draggable
          onDragStart={(e) => onDragStart(e, item.type)}
          style={{ ...itemStyle, borderLeftColor: item.color }}
        >
          {item.label}
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

const titleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "#888",
  textTransform: "uppercase",
  letterSpacing: 1,
  padding: "0 4px 4px",
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
};
