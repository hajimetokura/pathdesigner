# Operation Settings Group Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace per-operation cards in OperationDetailPanel with a grouped settings model: default settings per operation_type + drag-and-drop override groups.

**Architecture:** Frontend-only refactor. Groups are UI state inside OperationDetailPanel — downstream nodes still receive flat `OperationAssignment[]`. When group settings change, all assignments in that group get the updated settings before calling `onAssignmentsChange`.

**Tech Stack:** React, TypeScript, native HTML Drag & Drop API (no new libraries)

---

### Task 1: Add SettingsGroup type to types.ts

**Files:**
- Modify: `frontend/src/types.ts:147-153`

**Step 1: Add SettingsGroup interface and update OperationAssignment**

Add after the existing `OperationAssignment` interface (line 153):

```typescript
export interface SettingsGroup {
  group_id: string;
  label: string;
  operation_type: string;
  settings: MachiningSettings;
  object_ids: string[];
}
```

Add `group_id` to `OperationAssignment`:

```typescript
export interface OperationAssignment {
  operation_id: string;
  material_id: string;
  enabled: boolean;
  settings: MachiningSettings;
  order: number;
  group_id?: string;  // optional for backward compat
}
```

**Step 2: Verify build**

Run: `cd frontend && npx tsc --noEmit`
Expected: No new errors (group_id is optional)

**Step 3: Commit**

```bash
git add frontend/src/types.ts
git commit -m "Add SettingsGroup type, optional group_id to OperationAssignment"
```

---

### Task 2: Rewrite OperationDetailPanel — group derivation and settings UI

**Files:**
- Modify: `frontend/src/components/OperationDetailPanel.tsx`

This is the largest task. Replace the current per-operation card layout with group-based layout.

**Step 1: Add helper function to derive groups from assignments + detected operations**

At the top of the file (after imports), add:

```typescript
function deriveGroups(
  assignments: OperationAssignment[],
  detectedOps: DetectedOperation[],
  activeObjectIds: Set<string>,
): SettingsGroup[] {
  // Build operation lookup
  const opMap = new Map(detectedOps.map((op) => [op.operation_id, op]));

  // Group by group_id (or by operation_type for ungrouped)
  const groupMap = new Map<string, SettingsGroup>();

  for (const a of assignments) {
    const op = opMap.get(a.operation_id);
    if (!op || !activeObjectIds.has(op.object_id)) continue;

    const groupId = a.group_id || `default_${op.operation_type}`;
    const isDefault = !a.group_id || a.group_id.startsWith("default_");

    if (!groupMap.has(groupId)) {
      groupMap.set(groupId, {
        group_id: groupId,
        label: isDefault ? "Default" : groupId.replace("override_", "Override "),
        operation_type: op.operation_type,
        settings: { ...a.settings },
        object_ids: [],
      });
    }
    const group = groupMap.get(groupId)!;
    if (!group.object_ids.includes(op.object_id)) {
      group.object_ids.push(op.object_id);
    }
  }

  // Sort: defaults first, then overrides
  return [...groupMap.values()].sort((a, b) => {
    const aDefault = a.group_id.startsWith("default_") ? 0 : 1;
    const bDefault = b.group_id.startsWith("default_") ? 0 : 1;
    return aDefault - bDefault || a.group_id.localeCompare(b.group_id);
  });
}
```

**Step 2: Rewrite the component body**

Replace the entire component with the group-based layout:

Key state additions:
```typescript
const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
const [draggedOpId, setDraggedOpId] = useState<string | null>(null);
const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
```

The render structure:
```
panelStyle
└─ panelBodyStyle
   ├─ StockBadge (if multi-stock)
   ├─ For each group:
   │  └─ groupCardStyle (with background color)
   │     ├─ Group header (▼/▶ toggle + label + item count)
   │     ├─ Settings fields (if expanded)
   │     │  └─ NumberRow for each setting field
   │     ├─ Divider
   │     └─ Object rows (always visible)
   │        └─ For each operation in group:
   │           ├─ ☰ drag handle
   │           ├─ ☑ enable checkbox
   │           └─ "contour — obj_001  depth: 12.0mm"
   └─ [+ Add Override] button
```

**Group settings update logic:**
When a setting is changed in a group, update ALL assignments in that group:
```typescript
const updateGroupSettings = (groupId: string, field: keyof MachiningSettings, value: unknown) => {
  const group = groups.find((g) => g.group_id === groupId);
  if (!group) return;
  // Find all operation_ids belonging to objects in this group
  const opsInGroup = detectedOperations.operations.filter(
    (op) => group.object_ids.includes(op.object_id) && activeObjectIds.has(op.object_id)
  );
  const opIdsInGroup = new Set(opsInGroup.map((op) => op.operation_id));

  const updated = assignments.map((a) =>
    opIdsInGroup.has(a.operation_id)
      ? { ...a, settings: { ...a.settings, [field]: value } }
      : a
  );
  onAssignmentsChange(updated);
};
```

**Step 3: Verify build and manual test**

Run: `cd frontend && npx tsc --noEmit`
Run: `make dev` — open browser, import STEP file, verify grouped panel

**Step 4: Commit**

```bash
git add frontend/src/components/OperationDetailPanel.tsx
git commit -m "Rewrite OperationDetailPanel with settings group UI"
```

---

### Task 3: Implement drag & drop for object movement between groups

**Files:**
- Modify: `frontend/src/components/OperationDetailPanel.tsx`

**Step 1: Add drag handlers to object rows**

Each object row gets:
```typescript
draggable
onDragStart={(e) => {
  e.dataTransfer.setData("text/plain", op.operation_id);
  setDraggedOpId(op.operation_id);
}}
onDragEnd={() => {
  setDraggedOpId(null);
  setDragOverGroupId(null);
}}
```

Each group card gets:
```typescript
onDragOver={(e) => {
  e.preventDefault();
  setDragOverGroupId(group.group_id);
}}
onDragLeave={() => setDragOverGroupId(null)}
onDrop={(e) => {
  e.preventDefault();
  const opId = e.dataTransfer.getData("text/plain");
  handleMoveToGroup(opId, group.group_id);
  setDraggedOpId(null);
  setDragOverGroupId(null);
}}
```

**Step 2: Implement handleMoveToGroup**

```typescript
const handleMoveToGroup = (operationId: string, targetGroupId: string) => {
  const updated = assignments.map((a) =>
    a.operation_id === operationId
      ? {
          ...a,
          group_id: targetGroupId,
          settings: { ...groups.find((g) => g.group_id === targetGroupId)!.settings },
        }
      : a
  );
  onAssignmentsChange(updated);
};
```

When an object is moved to a new group, it adopts that group's settings.

**Step 3: Add visual feedback**

- Drag handle cursor: `cursor: "grab"`
- Drop target highlight: `border: "2px dashed #4a90d9"` when `dragOverGroupId === group.group_id`
- Dragged item opacity: `opacity: 0.4` when `draggedOpId === op.operation_id`

**Step 4: Verify drag & drop works**

Run: `make dev` — drag object between groups, verify settings update

**Step 5: Commit**

```bash
git add frontend/src/components/OperationDetailPanel.tsx
git commit -m "Add drag-and-drop to move objects between settings groups"
```

---

### Task 4: Add Override group creation and removal

**Files:**
- Modify: `frontend/src/components/OperationDetailPanel.tsx`

**Step 1: Implement "Add Override" button**

```typescript
const handleAddOverride = (operationType: string) => {
  // Find next override number
  const overrideCount = groups.filter(
    (g) => !g.group_id.startsWith("default_") && g.operation_type === operationType
  ).length;
  const newGroupId = `override_${operationType}_${overrideCount + 1}`;

  // No assignments to update yet — the group appears when objects are dragged in
  // But we need to track empty groups in local state
  // Use a separate state for user-created groups
};
```

Need an additional local state:
```typescript
const [extraGroups, setExtraGroups] = useState<SettingsGroup[]>([]);
```

Merge `extraGroups` with derived groups when rendering. When an object is dragged into an extra group, its assignment gets that group_id, and the group becomes part of the derived groups.

**Step 2: Add remove button for empty override groups**

Each override group with 0 objects shows a "Remove" button:
```typescript
{group.object_ids.length === 0 && !group.group_id.startsWith("default_") && (
  <button onClick={() => handleRemoveGroup(group.group_id)} style={removeBtnStyle}>
    Remove
  </button>
)}
```

**Step 3: Verify create/remove flow**

Run: `make dev` — add override, drag object in, drag object out, remove empty override

**Step 4: Commit**

```bash
git add frontend/src/components/OperationDetailPanel.tsx
git commit -m "Add override group creation and removal"
```

---

### Task 5: Wire up group_id in OperationNode initialization

**Files:**
- Modify: `frontend/src/nodes/OperationNode.tsx:101-108`

**Step 1: Set default group_id when creating assignments**

In the `useEffect` that creates initial assignments (around line 101):

```typescript
const newAssignments: OperationAssignment[] = result.operations.map((op, i) => ({
  operation_id: op.operation_id,
  material_id: defaultMaterialId,
  enabled: op.enabled,
  settings: op.suggested_settings,
  order: i + 1,
  group_id: `default_${op.operation_type}`,
}));
```

**Step 2: Verify build**

Run: `cd frontend && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add frontend/src/nodes/OperationNode.tsx
git commit -m "Set default group_id when initializing operation assignments"
```

---

### Task 6: Visual polish — group background colors and styles

**Files:**
- Modify: `frontend/src/components/OperationDetailPanel.tsx` (styles section)

**Step 1: Define group card background colors**

```typescript
const GROUP_COLORS = [
  "#f8f9fa",  // default: neutral gray
  "#fef9f0",  // override 1: warm
  "#f0f7fe",  // override 2: cool blue
  "#f5f0fe",  // override 3: light purple
];

const getGroupBg = (index: number, isDefault: boolean): string =>
  isDefault ? GROUP_COLORS[0] : GROUP_COLORS[(index % (GROUP_COLORS.length - 1)) + 1];
```

**Step 2: Style the drag handle**

```typescript
const dragHandleStyle: React.CSSProperties = {
  cursor: "grab",
  color: "#bbb",
  fontSize: 12,
  userSelect: "none",
  padding: "0 4px",
};
```

**Step 3: Style the group header**

```typescript
const groupHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  cursor: "pointer",
  userSelect: "none",
  padding: "6px 8px",
  fontWeight: 600,
  fontSize: 12,
};
```

**Step 4: Final manual verification**

Run: `make dev`
- Import STEP with multiple objects
- Verify default group shows all objects
- Add override group
- Drag objects between groups
- Change settings in a group → all objects in that group reflect the change
- Downstream toolpath generation still works

**Step 5: Commit**

```bash
git add frontend/src/components/OperationDetailPanel.tsx
git commit -m "Polish group card styling and drag handle visuals"
```

---

## Summary

| Task | Description | Files | Risk |
|------|-------------|-------|------|
| 1 | Add types | types.ts | Low |
| 2 | Rewrite panel (core) | OperationDetailPanel.tsx | High |
| 3 | Drag & drop | OperationDetailPanel.tsx | Medium |
| 4 | Override create/remove | OperationDetailPanel.tsx | Medium |
| 5 | Wire group_id in OperationNode | OperationNode.tsx | Low |
| 6 | Visual polish | OperationDetailPanel.tsx | Low |

**No backend changes needed.** The `group_id` field is optional and ignored by the backend.
**No downstream node changes needed.** `OperationAssignment[]` shape is preserved.
