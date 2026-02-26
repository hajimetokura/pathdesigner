# LR Panel Layout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** All panel content adapts to LR mode with horizontal multi-column layouts instead of TB's vertical column layout.

**Architecture:** Each panel imports `useLayoutDirection()` from existing context, checks `isLR`, and switches `flexDirection` to `"row"` for the main content area. Toolbar/header sections stay full-width on top; visual/canvas sections go left, info/input sections go right.

**Tech Stack:** React, inline styles (existing pattern), `useLayoutDirection()` context hook

**Design doc:** `docs/plans/2026-02-26-lr-panel-layout-design.md`

---

### Task 1: PlacementPanel — LR multi-column layout

**Files:**
- Modify: `frontend/src/components/PlacementPanel.tsx`

**Step 1: Add layout direction hook**

At the top of `PlacementPanel.tsx`, add import and use the hook:

```tsx
import { useLayoutDirection } from "../contexts/LayoutDirectionContext";
```

Inside the component function, add:

```tsx
const { direction } = useLayoutDirection();
const isLR = direction === "LR";
```

**Step 2: Wrap canvas + inputs in a flex row for LR**

Replace the current return block structure. The toolbar (Auto Nesting + SheetTabs) stays at top full-width. Below it, wrap canvas and inputs in a flex container:

```tsx
return (
  <div style={isLR ? panelStyleLR : panelStyle}>
    {/* Toolbar — always full width */}
    <div style={{ padding: "12px 16px 0" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        {/* ...existing Auto Nesting + Clearance buttons — no change... */}
      </div>
      <SheetTabs ... />
    </div>

    {/* Content area — row in LR, column in TB */}
    <div style={isLR ? contentRowStyle : contentColStyle}>
      {/* Canvas section */}
      <div style={isLR ? canvasSecLR : canvasSecTB}>
        <canvas ... />
      </div>

      {/* Info section: warnings + position inputs */}
      <div style={isLR ? infoSecLR : infoSecTB}>
        {warnings.length > 0 && (
          <div style={warningStyle}>...</div>
        )}
        <div style={inputsStyle}>
          <div style={inputsTitle}>Position (mm)</div>
          {activePlacements.map(...)}
        </div>
      </div>
    </div>
  </div>
);
```

**Step 3: Add new style constants**

```tsx
const panelStyleLR: React.CSSProperties = {
  display: "flex", flexDirection: "column", height: "100%", overflow: "hidden",
};
const contentRowStyle: React.CSSProperties = {
  display: "flex", flexDirection: "row", flex: 1, minHeight: 0,
};
const contentColStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", flex: 1, minHeight: 0,
};
const canvasSecLR: React.CSSProperties = {
  flex: 2, padding: "0 16px 16px", minWidth: 0,
};
const canvasSecTB: React.CSSProperties = {
  padding: "0 16px 16px",
};
const infoSecLR: React.CSSProperties = {
  flex: 1, overflowY: "auto", minWidth: 180, borderLeft: "1px solid var(--border-subtle)",
};
const infoSecTB: React.CSSProperties = {};
```

**Step 4: Verify visually**

Run: `make front` (or existing dev server)
- Open app, switch to LR mode
- Open Placement panel tab
- Canvas should be on left, position inputs on right
- Switch back to TB mode — should look the same as before

**Step 5: Commit**

```bash
git add frontend/src/components/PlacementPanel.tsx
git commit -m "feat: PlacementPanel LR multi-column layout"
```

---

### Task 2: BrepImportPanel — LR multi-column layout

**Files:**
- Modify: `frontend/src/components/BrepImportPanel.tsx`

**Step 1: Add layout hook and LR layout**

```tsx
import { useLayoutDirection } from "../contexts/LayoutDirectionContext";

export default function BrepImportPanel({ brepResult, meshes }: Props) {
  const { direction } = useLayoutDirection();
  const isLR = direction === "LR";

  return (
    <div style={isLR ? panelStyleLR : panelStyle}>
      <MeshViewer
        meshes={meshes}
        style={isLR ? { flex: 2, minHeight: 0 } : { flex: 1, minHeight: 300 }}
      />
      <div style={isLR ? infoStyleLR : infoStyle}>
        <div style={infoTitle}>Objects</div>
        {brepResult.objects.map((obj) => (
          <div key={obj.object_id} style={infoRow}>
            <span>{obj.object_id}</span>
            <span>
              {obj.bounding_box.x.toFixed(1)} × {obj.bounding_box.y.toFixed(1)} × {obj.bounding_box.z.toFixed(1)} {obj.unit}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const panelStyleLR: React.CSSProperties = {
  display: "flex", flexDirection: "row", height: "100%",
};
const infoStyleLR: React.CSSProperties = {
  flex: 1, padding: "12px 16px", borderLeft: "1px solid var(--surface-bg)", overflowY: "auto",
};
```

**Step 2: Verify visually** — MeshViewer left, objects right in LR mode.

**Step 3: Commit**

```bash
git add frontend/src/components/BrepImportPanel.tsx
git commit -m "feat: BrepImportPanel LR multi-column layout"
```

---

### Task 3: ToolpathPreviewPanel — LR multi-column layout

**Files:**
- Modify: `frontend/src/components/ToolpathPreviewPanel.tsx`

**Step 1: Add layout hook and restructure**

Add `useLayoutDirection` import. Wrap canvas and summary/legend in a flex row for LR:

```tsx
const { direction } = useLayoutDirection();
const isLR = direction === "LR";

return (
  <div style={isLR ? { display: "flex", flexDirection: "row", height: "100%" } : panelStyle}>
    {/* Canvas section */}
    <div style={isLR ? { flex: 2, minWidth: 0, ...canvasWrapStyle } : canvasWrapStyle}>
      <canvas ... />
      <div style={hintStyle}>...</div>
    </div>

    {/* Info section */}
    <div style={isLR ? { flex: 1, overflowY: "auto", borderLeft: "1px solid var(--surface-bg)" } : {}}>
      <div style={summaryStyle}>...</div>
      <div style={legendStyle}>...</div>
    </div>
  </div>
);
```

**Step 2: Verify** — Canvas left, summary/legend right.

**Step 3: Commit**

```bash
git add frontend/src/components/ToolpathPreviewPanel.tsx
git commit -m "feat: ToolpathPreviewPanel LR multi-column layout"
```

---

### Task 4: CodeEditorPanel — LR horizontal optimization

**Files:**
- Modify: `frontend/src/components/CodeEditorPanel.tsx`

**Step 1: Add layout hook and adapt editor height**

The editor currently has `height: "360px"` hardcoded in the EditorView theme. For LR mode, the editor should fill available height. Also merge toolbar + results into a single row.

```tsx
const { direction } = useLayoutDirection();
const isLR = direction === "LR";
```

Change the EditorView theme to be dynamic (move into effect or useMemo):

```tsx
EditorView.theme({
  "&": { height: "100%", fontSize: "12px" },
  ".cm-scroller": { overflow: "auto", fontFamily: "monospace" },
}),
```

And set `editorWrapStyle` height constraint via the container:

```tsx
const editorWrapDyn: React.CSSProperties = {
  ...editorWrapStyle,
  ...(isLR ? {} : { maxHeight: 360 }),
};
```

For LR, merge toolbar and results into one row:

```tsx
{isLR ? (
  <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
    <button ...>▶ Run</button>
    <button ...>Save to Library</button>
    {runStatus === "success" && lastResult && (
      <span style={{ fontSize: 12, color: "var(--color-success)" }}>
        ✅ {lastResult.object_count} object{lastResult.object_count > 1 ? "s" : ""} generated
      </span>
    )}
    {runStatus === "error" && (
      <span style={{ fontSize: 11, color: "var(--color-error)" }}>{runError}</span>
    )}
  </div>
) : (
  <>
    <div style={toolbarStyle}>...</div>
    {/* existing result/error blocks */}
  </>
)}
```

**Step 2: Verify** — Editor fills height in LR, toolbar compact at bottom.

**Step 3: Commit**

```bash
git add frontend/src/components/CodeEditorPanel.tsx
git commit -m "feat: CodeEditorPanel LR layout — full-height editor, compact toolbar"
```

---

### Task 5: AiCadPanel — LR side-by-side

**Files:**
- Modify: `frontend/src/components/AiCadPanel.tsx`

**Step 1: Add layout hook and row layout**

```tsx
const { direction } = useLayoutDirection();
const isLR = direction === "LR";

return (
  <div style={isLR ? { display: "flex", flexDirection: "row", height: "100%", overflow: "hidden" } : panelStyle}>
    <div style={isLR ? { flex: "0 0 200px", padding: "12px 16px", borderRight: "1px solid var(--surface-bg)", overflowY: "auto" } : metaStyle}>
      <div style={metaRow}><span style={metaLabel}>Prompt:</span><span>{prompt}</span></div>
      <div style={metaRow}><span style={metaLabel}>Model:</span><span>{model}</span></div>
      {isLR && (
        <div style={{ marginTop: 8 }}>
          <button onClick={() => setIsEditing(!isEditing)} style={toggleBtn}>
            {isEditing ? "Cancel Edit" : "Edit"}
          </button>
          {isEditing && (
            <button onClick={handleRerun} style={{ ...rerunBtn, marginTop: 8 }}>Re-run</button>
          )}
        </div>
      )}
    </div>

    <div style={isLR ? { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" } : codeSection}>
      {!isLR && <div style={codeLabelRow}>...</div>}
      {isEditing ? <textarea .../> : <pre style={preStyle}>{code}</pre>}
      {!isLR && isEditing && <button onClick={handleRerun} style={rerunBtn}>Re-run Code</button>}
    </div>
  </div>
);
```

**Step 2: Verify** — Meta left, code right in LR mode.

**Step 3: Commit**

```bash
git add frontend/src/components/AiCadPanel.tsx
git commit -m "feat: AiCadPanel LR side-by-side layout"
```

---

### Task 6: AiCadChatPanel — LR compact input bar

**Files:**
- Modify: `frontend/src/components/AiCadChatPanel.tsx`

**Step 1: Add layout hook and merge input + action bars**

```tsx
const { direction } = useLayoutDirection();
const isLR = direction === "LR";
```

For LR, merge textarea + send + apply into a single bar:

```tsx
{isLR ? (
  <div style={{ display: "flex", gap: 8, padding: "8px 16px", borderTop: "1px solid var(--border-subtle)", alignItems: "flex-end" }}>
    <textarea ... style={{ ...inputStyle, rows: 1 }} />
    <button onClick={handleSend} ...>送信</button>
    <button onClick={handleApply} disabled={!latestResult} ...>適用</button>
  </div>
) : (
  <>
    <div style={inputAreaStyle}>...</div>
    <div style={actionBarStyle}>...</div>
  </>
)}
```

**Step 2: Verify** — Chat history fills more space, input compact at bottom.

**Step 3: Commit**

```bash
git add frontend/src/components/AiCadChatPanel.tsx
git commit -m "feat: AiCadChatPanel LR compact input bar"
```

---

### Task 7: OperationDetailPanel — LR horizontal card flow

**Files:**
- Modify: `frontend/src/components/OperationDetailPanel.tsx`

**Step 1: Add layout hook and change body to flex-wrap row**

```tsx
const { direction } = useLayoutDirection();
const isLR = direction === "LR";
```

Change `panelBodyStyle` dynamically:

```tsx
<div style={isLR ? panelBodyStyleLR : panelBodyStyle}>
  {groups.map((group, groupIndex) => (
    <div
      key={group.group_id}
      style={{
        ...groupCardStyle,
        ...(isLR ? { minWidth: 220, flex: 1 } : {}),
        ...
      }}
    >
      ...
    </div>
  ))}
</div>
```

Add:

```tsx
const panelBodyStyleLR: React.CSSProperties = {
  display: "flex", flexDirection: "row", flexWrap: "wrap",
  gap: 8, padding: 12, overflowY: "auto", flex: 1,
  alignItems: "flex-start", alignContent: "flex-start",
};
```

**Step 2: Verify** — Group cards wrap horizontally in LR mode.

**Step 3: Commit**

```bash
git add frontend/src/components/OperationDetailPanel.tsx
git commit -m "feat: OperationDetailPanel LR horizontal card flow"
```

---

### Task 8: SnippetLibraryPanel — LR side-by-side

**Files:**
- Modify: `frontend/src/components/SnippetLibraryPanel.tsx`

**Step 1: Add layout hook and row layout**

```tsx
const { direction } = useLayoutDirection();
const isLR = direction === "LR";
```

Change container:

```tsx
const containerStyleDyn: React.CSSProperties = isLR
  ? { padding: 16, display: "flex", flexDirection: "row", gap: 16, height: "100%" }
  : containerStyle;
```

For LR, save section gets `flex: "0 0 200px"` and library section gets `flex: 1`. Grid columns increase:

```tsx
const gridStyleDyn: React.CSSProperties = isLR
  ? { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", gap: 6, marginTop: 4 }
  : gridStyle;
```

**Step 2: Verify** — Save form on left, library grid on right with more columns.

**Step 3: Commit**

```bash
git add frontend/src/components/SnippetLibraryPanel.tsx
git commit -m "feat: SnippetLibraryPanel LR side-by-side layout"
```

---

### Task 9: Final verification and commit

**Step 1: Full visual test**

Run `make front`. Test ALL panels in both TB and LR mode:
- [ ] PlacementPanel: canvas left, inputs right
- [ ] BrepImportPanel: viewer left, objects right
- [ ] ToolpathPreviewPanel: canvas left, summary right
- [ ] CodeEditorPanel: full-height editor, compact toolbar
- [ ] AiCadPanel: meta left, code right
- [ ] AiCadChatPanel: compact input bar
- [ ] OperationDetailPanel: cards wrap horizontally
- [ ] SnippetLibraryPanel: save left, library right
- [ ] All panels unchanged in TB mode

**Step 2: Switch between TB/LR multiple times** — ensure no state leaks or layout glitches.

**Step 3: Test panel resize in LR mode** — drag the resize handle, ensure content reflows.
