# LR Mode Panel Layout Design

## Problem

LR (Left-Right) mode places the SidePanel at the bottom of the screen (full width, ~300px height). However, all panel content is designed for TB mode (480px wide, full height) — vertical column layouts that waste horizontal space and require excessive scrolling in the shorter bottom panel.

## Approach

**Approach A: `direction` prop via context** — Each panel imports `useLayoutDirection()` and switches its `flexDirection` to `"row"` in LR mode, splitting content into left/right columns optimized for the horizontal form factor.

## Panel Designs

### 1. PlacementPanel

- **Toolbar** (Auto Nesting + SheetTabs): stays at top, full width
- **Below toolbar** splits into two columns:
  - Left (flex: 2): Canvas (responsive width, aspect ratio preserved)
  - Right (flex: 1, overflowY: auto): Position inputs + Warnings

### 2. BrepImportPanel

- Left (flex: 2): MeshViewer
- Right (flex: 1): Objects info list

### 3. ToolpathPreviewPanel

- Left (flex: 2): Toolpath canvas
- Right (flex: 1): Summary stats + Legend

### 4. CodeEditorPanel

- Full-width editor (height: 100% instead of fixed 360px)
- Toolbar + results combined into single bottom row

### 5. AiCadPanel

- Left (flex: 0 0 200px): Meta info (prompt, model) + Edit/Re-run buttons
- Right (flex: 1): Code display

### 6. AiCadChatPanel

- Chat history: full width (benefits from horizontal space naturally)
- Input + Action bar: merge into single row (textarea + send + apply buttons)

### 7. OperationDetailPanel

- Group cards: `flexDirection: "row"` + `flexWrap: "wrap"`
- Each card: `minWidth: 220px, flex: 1`

### 8. SnippetLibraryPanel

- Left (flex: 0 0 200px): Save form
- Right (flex: 1): Library grid (increase column count)

### 9. PostProcessorPanel / CncCodePanel

- Minimal changes — content already works well in horizontal layout
- CncCodePanel benefits from wider code view automatically

## Implementation

- Each panel uses `useLayoutDirection()` hook to get `direction`
- `isLR` flag toggles between TB (column) and LR (row) flex layouts
- No prop drilling needed — context provides direction
- No SidePanel changes required (already handles container sizing)

## Files to Modify

1. `PlacementPanel.tsx`
2. `BrepImportPanel.tsx`
3. `ToolpathPreviewPanel.tsx`
4. `CodeEditorPanel.tsx`
5. `AiCadPanel.tsx`
6. `AiCadChatPanel.tsx`
7. `OperationDetailPanel.tsx`
8. `SnippetLibraryPanel.tsx`
