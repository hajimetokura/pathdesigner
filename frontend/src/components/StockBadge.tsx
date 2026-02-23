interface StockBadgeProps {
  activeStockId: string;
  totalStocks: number;
}

export function StockBadge({ activeStockId, totalStocks }: StockBadgeProps) {
  if (totalStocks <= 1) return null;

  const sheetNum = activeStockId.replace("stock_", "");

  return (
    <div
      style={{
        display: "inline-block",
        padding: "1px 8px",
        borderRadius: 10,
        backgroundColor: "#4a90d9",
        color: "#fff",
        fontSize: 10,
        fontWeight: 600,
        lineHeight: "18px",
      }}
    >
      Sheet {sheetNum}
    </div>
  );
}
