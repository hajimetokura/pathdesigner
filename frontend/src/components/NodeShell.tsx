import type { ReactNode } from "react";

export type NodeCategory = "cam" | "cad" | "utility";

const CATEGORY_COLORS: Record<NodeCategory, string> = {
  cam: "#5b8def",
  cad: "#8b6cc1",
  utility: "#888888",
};

interface NodeShellProps {
  category: NodeCategory;
  selected?: boolean;
  width?: number;
  statusBorder?: string;  // error/loading 時の動的ボーダー色
  variant?: "light" | "dark";
  children: ReactNode;
}

export default function NodeShell({
  category,
  selected,
  width = 200,
  statusBorder,
  variant = "light",
  children,
}: NodeShellProps) {
  const isDark = variant === "dark";
  const categoryColor = CATEGORY_COLORS[category];

  const borderColor = statusBorder || (isDark ? "#444" : "#ddd");

  const style: React.CSSProperties = {
    background: isDark ? "#1e1e1e" : "white",
    borderTop: `1px solid ${borderColor}`,
    borderRight: `1px solid ${borderColor}`,
    borderBottom: `1px solid ${borderColor}`,
    borderLeft: `3px solid ${categoryColor}`,
    borderRadius: 8,
    padding: "20px 12px",
    width: isDark ? undefined : width,
    minWidth: isDark ? 220 : undefined,
    maxWidth: isDark ? 360 : undefined,
    boxShadow: selected
      ? `0 0 0 2px #4a90d9`
      : isDark
        ? "0 2px 6px rgba(0,0,0,0.15)"
        : "0 2px 6px rgba(0,0,0,0.08)",
  };

  return <div style={style}>{children}</div>;
}
