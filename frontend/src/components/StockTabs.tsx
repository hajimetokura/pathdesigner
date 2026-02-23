interface StockTabsProps {
  stockIds: string[];
  activeStockId: string;
  onChange?: (stockId: string) => void;
  /** Optional: show part count per stock */
  counts?: Record<string, number>;
}

export default function StockTabs({
  stockIds,
  activeStockId,
  onChange,
  counts,
}: StockTabsProps) {
  if (stockIds.length <= 1) return null;

  return (
    <div style={{
      display: "flex",
      gap: 4,
      marginBottom: 8,
      overflowX: "auto",
      scrollbarWidth: "thin",
      maxWidth: "100%",
    }}>
      {stockIds.map((sid) => {
        const isActive = sid === activeStockId;
        const label = sid.replace("stock_", "Sheet ");
        const count = counts?.[sid];
        return (
          <button
            key={sid}
            onClick={() => onChange?.(sid)}
            style={{
              padding: "4px 12px",
              fontSize: 12,
              background: isActive ? "#4a90d9" : "#e0e0e0",
              color: isActive ? "#fff" : "#333",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {label}{count !== undefined ? ` (${count})` : ""}
          </button>
        );
      })}
    </div>
  );
}
