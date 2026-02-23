import { useMemo } from "react";

interface StockTabsProps {
  stockIds: string[];
  activeStockId: string;
  onChange?: (stockId: string) => void;
  readOnly?: boolean;
  size?: "small" | "normal";
  /** Optional: show part count per stock */
  counts?: Record<string, number>;
}

export default function StockTabs({
  stockIds,
  activeStockId,
  onChange,
  readOnly = false,
  size = "normal",
  counts,
}: StockTabsProps) {
  if (stockIds.length <= 1) return null;

  const isSmall = size === "small";

  return (
    <div style={{ display: "flex", gap: isSmall ? 2 : 4, marginBottom: isSmall ? 4 : 8 }}>
      {stockIds.map((sid) => {
        const isActive = sid === activeStockId;
        const label = sid.replace("stock_", "Sheet ");
        const count = counts?.[sid];
        return (
          <button
            key={sid}
            onClick={() => !readOnly && onChange?.(sid)}
            style={{
              padding: isSmall ? "2px 6px" : "4px 12px",
              fontSize: isSmall ? 10 : 12,
              background: isActive ? "#4a90d9" : readOnly ? "#f0f0f0" : "#e0e0e0",
              color: isActive ? "#fff" : "#333",
              border: "none",
              borderRadius: 4,
              cursor: readOnly ? "default" : "pointer",
              opacity: readOnly && !isActive ? 0.6 : 1,
            }}
          >
            {label}{count !== undefined ? ` (${count})` : ""}
          </button>
        );
      })}
    </div>
  );
}
