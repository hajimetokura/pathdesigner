import type { ReactNode } from "react";
import { useLayoutDirection } from "../contexts/LayoutDirectionContext";

export type NodeCategory = "cam" | "cad" | "utility";

const CATEGORY_COLORS: Record<NodeCategory, string> = {
  cad: "var(--color-cad)",
  cam: "var(--color-cam)",
  utility: "var(--color-utility)",
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
  const { direction } = useLayoutDirection();
  const isLR = direction === "LR";

  const borderColor = statusBorder || "var(--border-color)";

  const baseBg = "var(--node-bg)";
  const selectedBg = selected
    ? `color-mix(in srgb, ${categoryColor} 15%, ${baseBg})`
    : baseBg;

  const style: React.CSSProperties = {
    background: selectedBg,
    borderTop: isLR ? `3px solid ${categoryColor}` : `1px solid ${borderColor}`,
    borderRight: `1px solid ${borderColor}`,
    borderBottom: `1px solid ${borderColor}`,
    borderLeft: isLR ? `1px solid ${borderColor}` : `3px solid ${categoryColor}`,
    borderRadius: "var(--radius-node)",
    padding: isLR ? "12px 16px" : "16px 12px",
    width: isDark ? undefined : width,
    minWidth: isDark ? 220 : undefined,
    maxWidth: isDark ? 360 : undefined,
    boxShadow: isDark
      ? "0 2px 6px rgba(0,0,0,0.15)"
      : "var(--shadow-node)",
  };

  return <div style={style}>{children}</div>;
}
