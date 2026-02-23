import { useCallback, useMemo, useState } from "react";
import type {
  OperationDetectResult,
  OperationAssignment,
  DetectedOperation,
  StockSettings,
  MachiningSettings,
  PlacementItem,
  SettingsGroup,
} from "../types";
import { StockBadge } from "./StockBadge";

interface Props {
  detectedOperations: OperationDetectResult;
  assignments: OperationAssignment[];
  stockSettings: StockSettings | null;
  onAssignmentsChange: (assignments: OperationAssignment[]) => void;
  placements: PlacementItem[];
  stockIds: string[];
  activeStockId: string;
}

/* --- Helper: derive groups from assignments + detected operations --- */

function deriveGroups(
  assignments: OperationAssignment[],
  detectedOps: DetectedOperation[],
  activeObjectIds: Set<string>,
): SettingsGroup[] {
  const opMap = new Map(detectedOps.map((op) => [op.operation_id, op]));
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

  return [...groupMap.values()].sort((a, b) => {
    const aDefault = a.group_id.startsWith("default_") ? 0 : 1;
    const bDefault = b.group_id.startsWith("default_") ? 0 : 1;
    return aDefault - bDefault || a.group_id.localeCompare(b.group_id);
  });
}

/* --- Group background colors --- */

const GROUP_COLORS = [
  "#f8f9fa", // default: neutral gray
  "#fef9f0", // override 1: warm
  "#f0f7fe", // override 2: cool blue
  "#f5f0fe", // override 3: light purple
];

const getGroupBg = (index: number, isDefault: boolean): string =>
  isDefault ? GROUP_COLORS[0] : GROUP_COLORS[(index % (GROUP_COLORS.length - 1)) + 1];

/* --- Main component --- */

export default function OperationDetailPanel({
  detectedOperations,
  assignments,
  stockSettings,
  onAssignmentsChange,
  placements,
  stockIds,
  activeStockId,
}: Props) {
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [draggedOpId, setDraggedOpId] = useState<string | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const [extraGroups, setExtraGroups] = useState<SettingsGroup[]>([]);

  const materials = stockSettings?.materials ?? [];

  const activeObjectIds = useMemo(() => {
    return new Set(placements.filter((p) => p.stock_id === activeStockId).map((p) => p.object_id));
  }, [placements, activeStockId]);

  const derivedGroups = useMemo(() => {
    return deriveGroups(assignments, detectedOperations.operations, activeObjectIds);
  }, [assignments, detectedOperations, activeObjectIds]);

  // Merge derived groups with extra (empty override) groups
  const groups = useMemo(() => {
    const derivedIds = new Set(derivedGroups.map((g) => g.group_id));
    const extras = extraGroups.filter((eg) => !derivedIds.has(eg.group_id));
    return [...derivedGroups, ...extras];
  }, [derivedGroups, extraGroups]);

  // Collect unique operation types for "Add Override" buttons
  const operationTypes = useMemo(() => {
    return [...new Set(groups.map((g) => g.operation_type))];
  }, [groups]);

  /* --- Group settings update: updates ALL assignments in the group --- */

  const updateGroupSettings = useCallback(
    (groupId: string, field: keyof MachiningSettings, value: unknown) => {
      const group = groups.find((g) => g.group_id === groupId);
      if (!group) return;

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

      // Also update extra groups settings for consistency
      setExtraGroups((prev) =>
        prev.map((eg) =>
          eg.group_id === groupId
            ? { ...eg, settings: { ...eg.settings, [field]: value } }
            : eg
        )
      );
    },
    [groups, detectedOperations, activeObjectIds, assignments, onAssignmentsChange]
  );

  /* --- Toggle enabled for a single operation --- */

  const toggleEnabled = useCallback(
    (opId: string) => {
      const updated = assignments.map((a) =>
        a.operation_id === opId ? { ...a, enabled: !a.enabled } : a
      );
      onAssignmentsChange(updated);
    },
    [assignments, onAssignmentsChange]
  );

  /* --- Drag & drop: move object to another group --- */

  const handleMoveToGroup = useCallback(
    (operationId: string, targetGroupId: string) => {
      const targetGroup = groups.find((g) => g.group_id === targetGroupId);
      if (!targetGroup) return;

      const updated = assignments.map((a) =>
        a.operation_id === operationId
          ? {
              ...a,
              group_id: targetGroupId,
              settings: { ...targetGroup.settings },
            }
          : a
      );
      onAssignmentsChange(updated);
    },
    [groups, assignments, onAssignmentsChange]
  );

  /* --- Add override group --- */

  const handleAddOverride = useCallback(
    (operationType: string) => {
      const overrideCount = groups.filter(
        (g) => !g.group_id.startsWith("default_") && g.operation_type === operationType
      ).length;
      const newGroupId = `override_${operationType}_${overrideCount + 1}`;

      // Copy settings from the default group for this operation type
      const defaultGroup = groups.find(
        (g) => g.group_id === `default_${operationType}`
      );
      const baseSettings = defaultGroup?.settings ??
        assignments[0]?.settings;
      if (!baseSettings) return;

      setExtraGroups((prev) => [
        ...prev,
        {
          group_id: newGroupId,
          label: `Override ${overrideCount + 1}`,
          operation_type: operationType,
          settings: { ...baseSettings },
          object_ids: [],
        },
      ]);
    },
    [groups, assignments]
  );

  /* --- Remove empty override group --- */

  const handleRemoveGroup = useCallback(
    (groupId: string) => {
      setExtraGroups((prev) => prev.filter((eg) => eg.group_id !== groupId));
    },
    []
  );

  /* --- Render --- */

  return (
    <div style={panelStyle}>
      <div style={panelBodyStyle}>
        {stockIds.length > 1 && (
          <StockBadge
            activeStockId={activeStockId}
            totalStocks={stockIds.length}
          />
        )}

        {groups.map((group, groupIndex) => {
          const isDefault = group.group_id.startsWith("default_");
          const isExpanded = expandedGroup === group.group_id;
          const isDragOver = dragOverGroupId === group.group_id;

          // Find operations belonging to this group
          const opsInGroup = detectedOperations.operations.filter(
            (op) =>
              group.object_ids.includes(op.object_id) &&
              activeObjectIds.has(op.object_id)
          );

          return (
            <div
              key={group.group_id}
              style={{
                ...groupCardStyle,
                background: getGroupBg(groupIndex, isDefault),
                border: isDragOver
                  ? "2px dashed #4a90d9"
                  : "1px solid #eee",
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverGroupId(group.group_id);
              }}
              onDragLeave={() => setDragOverGroupId(null)}
              onDrop={(e) => {
                e.preventDefault();
                const opId = e.dataTransfer.getData("text/plain");
                if (opId) handleMoveToGroup(opId, group.group_id);
                setDraggedOpId(null);
                setDragOverGroupId(null);
              }}
            >
              {/* Group header */}
              <div
                style={groupHeaderStyle}
                onClick={() =>
                  setExpandedGroup(isExpanded ? null : group.group_id)
                }
              >
                <span>
                  <span style={{ fontSize: 10, color: "#888", marginRight: 4 }}>
                    {isExpanded ? "\u25BC" : "\u25B6"}
                  </span>
                  <span style={{ fontSize: 11, color: "#666", marginRight: 4 }}>
                    [{group.operation_type}]
                  </span>
                  {group.label}
                  <span style={{ fontSize: 11, color: "#999", marginLeft: 6 }}>
                    ({opsInGroup.length})
                  </span>
                </span>
                {/* Remove button for empty override groups */}
                {group.object_ids.length === 0 && !isDefault && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveGroup(group.group_id);
                    }}
                    style={removeBtnStyle}
                  >
                    Remove
                  </button>
                )}
              </div>

              {/* Settings fields (if expanded) */}
              {isExpanded && opsInGroup.length > 0 && (
                <div style={settingsBodyStyle}>
                  <NumberRow
                    label="Depth/pass (mm)"
                    value={group.settings.depth_per_pass}
                    onChange={(v) =>
                      updateGroupSettings(group.group_id, "depth_per_pass", v)
                    }
                  />
                  <NumberRow
                    label="Feed XY (mm/s)"
                    value={group.settings.feed_rate.xy}
                    onChange={(v) =>
                      updateGroupSettings(group.group_id, "feed_rate", {
                        ...group.settings.feed_rate,
                        xy: v,
                      })
                    }
                  />
                  <NumberRow
                    label="Feed Z (mm/s)"
                    value={group.settings.feed_rate.z}
                    onChange={(v) =>
                      updateGroupSettings(group.group_id, "feed_rate", {
                        ...group.settings.feed_rate,
                        z: v,
                      })
                    }
                  />
                  <NumberRow
                    label="Spindle (RPM)"
                    value={group.settings.spindle_speed}
                    step={1000}
                    onChange={(v) =>
                      updateGroupSettings(
                        group.group_id,
                        "spindle_speed",
                        Math.round(v)
                      )
                    }
                  />
                  <NumberRow
                    label="Tool dia (mm)"
                    value={group.settings.tool.diameter}
                    step={0.1}
                    onChange={(v) =>
                      updateGroupSettings(group.group_id, "tool", {
                        ...group.settings.tool,
                        diameter: v,
                      })
                    }
                  />
                  <div style={fieldRowStyle}>
                    <label style={fieldLabelStyle}>Direction</label>
                    <select
                      style={selectStyle}
                      value={group.settings.direction}
                      onChange={(e) =>
                        updateGroupSettings(
                          group.group_id,
                          "direction",
                          e.target.value
                        )
                      }
                    >
                      <option value="climb">climb</option>
                      <option value="conventional">conventional</option>
                    </select>
                  </div>
                  <div style={fieldRowStyle}>
                    <label style={fieldLabelStyle}>Tabs</label>
                    <label style={{ fontSize: 11 }}>
                      <input
                        type="checkbox"
                        checked={group.settings.tabs.enabled}
                        onChange={() =>
                          updateGroupSettings(group.group_id, "tabs", {
                            ...group.settings.tabs,
                            enabled: !group.settings.tabs.enabled,
                          })
                        }
                      />
                      {" "}enabled ({group.settings.tabs.count})
                    </label>
                  </div>
                </div>
              )}

              {/* Divider */}
              {opsInGroup.length > 0 && (
                <div style={{ borderTop: "1px solid #e8e8e8", margin: "4px 0" }} />
              )}

              {/* Object rows (always visible) */}
              {opsInGroup.map((op) => {
                const assignment = assignments.find(
                  (a) => a.operation_id === op.operation_id
                );
                if (!assignment) return null;

                const isDragged = draggedOpId === op.operation_id;
                const assignedMat = materials.find(
                  (m) => m.material_id === assignment.material_id
                );
                const thicknessWarning =
                  assignedMat && assignedMat.thickness < op.geometry.depth;

                return (
                  <div
                    key={op.operation_id}
                    style={{
                      ...objectRowStyle,
                      opacity: isDragged ? 0.4 : 1,
                    }}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", op.operation_id);
                      setDraggedOpId(op.operation_id);
                    }}
                    onDragEnd={() => {
                      setDraggedOpId(null);
                      setDragOverGroupId(null);
                    }}
                  >
                    <span style={dragHandleStyle}>☰</span>
                    <label
                      style={{ display: "flex", alignItems: "center", gap: 4, flex: 1 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={assignment.enabled}
                        onChange={() => toggleEnabled(op.operation_id)}
                      />
                      <span style={{ fontSize: 11 }}>
                        {op.operation_type} — {op.object_id}
                        <span style={{ color: "#888", marginLeft: 6 }}>
                          depth: {op.geometry.depth.toFixed(1)}mm
                        </span>
                        {thicknessWarning && (
                          <span style={{ color: "#e65100", marginLeft: 4 }}>
                            ⚠ stock too thin
                          </span>
                        )}
                      </span>
                    </label>
                  </div>
                );
              })}

              {/* Empty group hint */}
              {opsInGroup.length === 0 && (
                <div style={{ fontSize: 11, color: "#aaa", padding: "4px 8px", fontStyle: "italic" }}>
                  Drag objects here
                </div>
              )}
            </div>
          );
        })}

        {/* Add Override buttons */}
        {operationTypes.map((opType) => (
          <button
            key={opType}
            onClick={() => handleAddOverride(opType)}
            style={addOverrideBtnStyle}
          >
            + Add Override ({opType})
          </button>
        ))}
      </div>
    </div>
  );
}

/* --- Sub-components --- */

function NumberRow({
  label,
  value,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={fieldRowStyle}>
      <label style={fieldLabelStyle}>{label}</label>
      <input
        type="number"
        style={inputStyle}
        value={value}
        step={step}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
    </div>
  );
}

/* --- Styles --- */

const panelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
};

const panelBodyStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: 12,
};

const groupCardStyle: React.CSSProperties = {
  border: "1px solid #eee",
  borderRadius: 6,
  marginBottom: 8,
  padding: 8,
};

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

const objectRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "3px 8px",
  gap: 4,
};

const dragHandleStyle: React.CSSProperties = {
  cursor: "grab",
  color: "#bbb",
  fontSize: 12,
  userSelect: "none",
  padding: "0 4px",
};

const settingsBodyStyle: React.CSSProperties = {
  marginTop: 4,
  paddingLeft: 12,
  paddingRight: 8,
  paddingBottom: 4,
};

const fieldRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 4,
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#555",
  flexShrink: 0,
  marginRight: 8,
};

const inputStyle: React.CSSProperties = {
  fontSize: 11,
  padding: "2px 4px",
  borderRadius: 4,
  border: "1px solid #ccc",
  width: 70,
  textAlign: "right",
};

const selectStyle: React.CSSProperties = {
  fontSize: 11,
  padding: "2px 4px",
  borderRadius: 4,
  border: "1px solid #ccc",
};

const removeBtnStyle: React.CSSProperties = {
  fontSize: 10,
  color: "#d32f2f",
  background: "none",
  border: "1px solid #d32f2f",
  borderRadius: 4,
  padding: "1px 6px",
  cursor: "pointer",
};

const addOverrideBtnStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#1976d2",
  background: "none",
  border: "1px dashed #1976d2",
  borderRadius: 6,
  padding: "6px 12px",
  cursor: "pointer",
  width: "100%",
  marginBottom: 4,
};
