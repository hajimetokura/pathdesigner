# Operation Settings Group Design

## Problem

When importing multiple objects (e.g. 8 pieces), every operation gets its own card in the OperationDetailPanel. All operations typically share the same machining settings, but changing them requires editing each card individually. There's no way to adjust settings globally.

## Solution

Replace per-operation cards with a **settings group** model:
- **Default group** per operation_type: applies to all objects unless overridden
- **Override groups**: created on demand for objects that need different settings
- Objects are moved between groups via drag & drop

## Data Model

```typescript
interface SettingsGroup {
  group_id: string;           // "default_contour", "override_1", etc.
  label: string;              // "Default", "Override 1"
  operation_type: string;     // "contour", "pocket", etc.
  settings: MachiningSettings;
  object_ids: string[];       // objects assigned to this group
}
```

Existing `OperationAssignment` gains a `group_id` field. When sending to backend, group settings are expanded into individual assignments (backward compatible).

## UI Layout

```
Sheet 1

▼ Default (contour)                    6 items
┌────────────────────────────────────────────┐
│  Depth/pass [6]     Feed XY [75]           │  ← toggle to expand/collapse
│  Feed Z [25]        Spindle [18000]        │
│  Tool dia [6.35]    Direction [climb ▼]    │
│  Tabs ☑ enabled (4)                        │
│╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌│
│  ☰ ☑ contour — obj_001   depth: 12.0mm    │  ← ☰ drag handle
│  ☰ ☑ contour — obj_002   depth: 12.0mm    │
│  ☰ ☑ contour — obj_004   depth: 12.0mm    │
│  ...                                       │
└────────────────────────────────────────────┘
                                      bg: #f8f9fa

▶ Override 1 (contour)                 1 item
┌────────────────────────────────────────────┐
│  ☰ ☑ contour — obj_003   depth: 12.0mm    │
└────────────────────────────────────────────┘
                                      bg: #fef9f0

[+ Add Override]
```

### Interactions

1. **Group header toggle** (▼/▶): expand/collapse settings fields
2. **Settings edit**: change a field → applies to all objects in that group
3. **Drag & drop**: drag object row (via ☰ handle) to another group
4. **Add override**: creates new group copying default settings for that operation_type
5. **Enable/disable**: per-object checkbox (existing behavior preserved)
6. **Empty group cleanup**: override groups with no objects can be removed

### Visual Grouping

Each group card has a distinct subtle background color to visually separate groups:
- Default groups: neutral gray (#f8f9fa)
- Override groups: warm tint (#fef9f0), alternate with (#f0f7fe) for multiple overrides

## Scope of Changes

| File | Change |
|------|--------|
| `types.ts` | Add `group_id` to `OperationAssignment`, add `SettingsGroup` type |
| `OperationDetailPanel.tsx` | Full rewrite: group-based layout, D&D, bulk settings |
| `OperationNode.tsx` | Pass group info downstream, build assignments from groups |

## D&D Implementation

Use native HTML Drag and Drop API (no library):
- `draggable` attribute on object rows
- `onDragStart`: store operation_id in dataTransfer
- `onDragOver`: highlight drop target group
- `onDrop`: move object to target group

## Backward Compatibility

- Backend API unchanged: assignments are still sent as individual `OperationAssignment[]`
- Group state is frontend-only, derived from assignments on load
- Existing assignments without `group_id` default to the type-based default group
