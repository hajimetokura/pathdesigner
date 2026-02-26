interface SheetTabsProps {
  sheetIds: string[];
  activeSheetId: string;
  onChange?: (sheetId: string) => void;
  /** Optional: show part count per sheet */
  counts?: Record<string, number>;
}

export default function SheetTabs({
  sheetIds,
  activeSheetId,
  onChange,
  counts,
}: SheetTabsProps) {
  if (sheetIds.length <= 1) return null;

  return (
    <div style={{
      display: "flex",
      gap: 4,
      marginBottom: 8,
      overflowX: "auto",
      scrollbarWidth: "thin",
      maxWidth: "100%",
    }}>
      {sheetIds.map((sid) => {
        const isActive = sid === activeSheetId;
        const label = sid.replace("sheet_", "Sheet ");
        const count = counts?.[sid];
        return (
          <button
            key={sid}
            onClick={() => onChange?.(sid)}
            style={{
              padding: "4px 12px",
              fontSize: 12,
              background: isActive ? "var(--color-accent)" : "var(--border-subtle)",
              color: isActive ? "#fff" : "var(--text-primary)",
              border: "none",
              borderRadius: "var(--radius-item)",
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
