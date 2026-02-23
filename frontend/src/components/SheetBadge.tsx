interface SheetBadgeProps {
  activeSheetId: string;
  totalSheets: number;
}

export function SheetBadge({ activeSheetId, totalSheets }: SheetBadgeProps) {
  if (totalSheets <= 1) return null;

  const sheetNum = activeSheetId.replace("sheet_", "");

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
