import { type ReactNode } from "react";

export interface PanelTab {
  id: string;
  label: string;
  icon: string;       // 1文字 emoji/記号
  content: ReactNode;
}

interface SidePanelProps {
  tabs: PanelTab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

export default function SidePanel({ tabs, activeTabId, onSelectTab, onCloseTab }: SidePanelProps) {
  if (tabs.length === 0) return null;

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  return (
    <div style={containerStyle}>
      {/* Tab bar */}
      <div style={tabBarStyle}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            style={{
              ...tabStyle,
              ...(tab.id === activeTab.id ? activeTabStyle : {}),
            }}
            onClick={() => onSelectTab(tab.id)}
          >
            <span style={{ marginRight: 4 }}>{tab.icon}</span>
            <span style={{ flex: 1 }}>{tab.label}</span>
            <span
              style={closeTabStyle}
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
            >
              ×
            </span>
          </div>
        ))}
      </div>
      {/* Panel content */}
      <div style={panelBodyStyle}>{activeTab.content}</div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  width: 480,
  height: "100vh",
  borderLeft: "1px solid var(--border-subtle)",
  background: "var(--panel-bg)",
  display: "flex",
  flexDirection: "column",
  flexShrink: 0,
};

const tabBarStyle: React.CSSProperties = {
  display: "flex",
  borderBottom: "1px solid var(--border-subtle)",
  background: "var(--sidebar-bg)",
  overflowX: "auto",
  flexShrink: 0,
};

const tabStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "8px 12px",
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
  borderRight: "1px solid var(--border-subtle)",
  whiteSpace: "nowrap",
  color: "var(--text-secondary)",
  userSelect: "none",
};

const activeTabStyle: React.CSSProperties = {
  background: "var(--panel-bg)",
  color: "var(--text-primary)",
  fontWeight: 600,
  borderBottom: "2px solid var(--color-accent)",
};

const closeTabStyle: React.CSSProperties = {
  marginLeft: 6,
  fontSize: 14,
  color: "var(--text-muted)",
  cursor: "pointer",
  lineHeight: 1,
};

const panelBodyStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
};
