import { useState, useCallback, type ReactNode } from "react";
import { useLayoutDirection } from "../contexts/LayoutDirectionContext";

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

const PANEL_HEIGHT_KEY = "pathdesigner-panel-height";
const DEFAULT_HEIGHT = 300;
const MIN_HEIGHT = 150;
const MAX_HEIGHT_RATIO = 0.7;

export default function SidePanel({ tabs, activeTabId, onSelectTab, onCloseTab }: SidePanelProps) {
  const { direction } = useLayoutDirection();
  const isLR = direction === "LR";

  const [panelHeight, setPanelHeight] = useState(() => {
    const saved = localStorage.getItem(PANEL_HEIGHT_KEY);
    return saved ? Number(saved) : DEFAULT_HEIGHT;
  });

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = panelHeight;
    const maxH = window.innerHeight * MAX_HEIGHT_RATIO;

    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      const next = Math.max(MIN_HEIGHT, Math.min(maxH, startH + delta));
      setPanelHeight(next);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setPanelHeight((h) => {
        localStorage.setItem(PANEL_HEIGHT_KEY, String(h));
        return h;
      });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [panelHeight]);

  if (tabs.length === 0) return null;

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  const dynContainerStyle: React.CSSProperties = isLR
    ? {
        width: "100%",
        height: panelHeight,
        borderTop: "1px solid var(--border-subtle)",
        background: "var(--panel-bg)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
      }
    : containerTBStyle;

  return (
    <div style={dynContainerStyle}>
      {isLR && (
        <div style={resizeHandleStyle} onMouseDown={onResizeStart} />
      )}
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

/* ── TB (right panel) ── */

const containerTBStyle: React.CSSProperties = {
  width: 480,
  height: "100vh",
  borderLeft: "1px solid var(--border-subtle)",
  background: "var(--panel-bg)",
  display: "flex",
  flexDirection: "column",
  flexShrink: 0,
};

/* ── LR resize handle ── */

const resizeHandleStyle: React.CSSProperties = {
  height: 6,
  cursor: "row-resize",
  background: "var(--border-subtle)",
  flexShrink: 0,
};

/* ── Shared styles ── */

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
