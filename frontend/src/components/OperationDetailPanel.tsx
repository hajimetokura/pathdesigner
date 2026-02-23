import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  OperationDetectResult,
  OperationAssignment,
  DetectedOperation,
  SheetSettings,
  MachiningSettings,
  PlacementItem,
  PresetItem,
  SettingsGroup,
} from "../types";
import { SheetBadge } from "./SheetBadge";
import { fetchPresets } from "../api";

interface Props {
  detectedOperations: OperationDetectResult;
  assignments: OperationAssignment[];
  sheetSettings: SheetSettings | null;
  onAssignmentsChange: (assignments: OperationAssignment[]) => void;
  placements: PlacementItem[];
  sheetIds: string[];
  activeSheetId: string;
  groupLabels: Record<string, string>;
  onGroupLabelsChange: (labels: Record<string, string>) => void;
}

/* --- Helper: derive groups from assignments + detected operations --- */

function deriveGroups(
  assignments: OperationAssignment[],
  detectedOps: DetectedOperation[],
  activeObjectIds: Set<string>,
  groupLabels: Record<string, string>,
): SettingsGroup[] {
  const opMap = new Map(detectedOps.map((op) => [op.operation_id, op]));
  const groupMap = new Map<string, SettingsGroup>();

  for (const a of assignments) {
    const op = opMap.get(a.operation_id);
    if (!op || !activeObjectIds.has(op.object_id)) continue;

    const groupId = a.group_id || `default_${op.operation_type}`;
    const isDefault = !a.group_id || a.group_id.startsWith("default_");

    if (!groupMap.has(groupId)) {
      const defaultLabel = isDefault
        ? "Default"
        : groupId.replace(/^override_\w+_/, "Setting ");
      groupMap.set(groupId, {
        group_id: groupId,
        label: groupLabels[groupId] ?? defaultLabel,
        operation_type: op.operation_type,
        settings: { ...a.settings },
        operation_ids: [],
      });
    }
    const group = groupMap.get(groupId)!;
    if (!group.operation_ids.includes(op.operation_id)) {
      group.operation_ids.push(op.operation_id);
    }
  }

  return [...groupMap.values()].sort((a, b) => {
    const aDefault = a.group_id.startsWith("default_") ? 0 : 1;
    const bDefault = b.group_id.startsWith("default_") ? 0 : 1;
    return aDefault - bDefault || a.group_id.localeCompare(b.group_id);
  });
}

/* --- Preset localStorage helpers --- */

const USER_PRESETS_KEY = "pathdesigner_user_presets";

interface UserPreset {
  id: string;
  name: string;
  settings: MachiningSettings;
}

function loadUserPresets(): UserPreset[] {
  try {
    const raw = localStorage.getItem(USER_PRESETS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveUserPresets(presets: UserPreset[]) {
  localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(presets));
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
  sheetSettings,
  onAssignmentsChange,
  placements,
  sheetIds,
  activeSheetId,
  groupLabels,
  onGroupLabelsChange,
}: Props) {
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [draggedOpId, setDraggedOpId] = useState<string | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const [extraGroups, setExtraGroups] = useState<SettingsGroup[]>([]);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");

  // Presets
  const [builtinPresets, setBuiltinPresets] = useState<PresetItem[]>([]);
  const [userPresets, setUserPresets] = useState<UserPreset[]>(loadUserPresets);
  const [presetMenuGroupId, setPresetMenuGroupId] = useState<string | null>(null);
  const [savingPresetGroupId, setSavingPresetGroupId] = useState<string | null>(null);
  const [newPresetName, setNewPresetName] = useState("");

  const materials = sheetSettings?.materials ?? [];

  // Load built-in presets on mount
  useEffect(() => {
    fetchPresets().then(setBuiltinPresets).catch(() => {});
  }, []);

  const activeObjectIds = useMemo(() => {
    return new Set(placements.filter((p) => p.sheet_id === activeSheetId).map((p) => p.object_id));
  }, [placements, activeSheetId]);

  const derivedGroups = useMemo(() => {
    return deriveGroups(assignments, detectedOperations.operations, activeObjectIds, groupLabels);
  }, [assignments, detectedOperations, activeObjectIds, groupLabels]);

  // Merge derived groups with extra (empty) groups
  const groups = useMemo(() => {
    const derivedIds = new Set(derivedGroups.map((g) => g.group_id));
    const extras = extraGroups.filter((eg) => !derivedIds.has(eg.group_id));
    return [...derivedGroups, ...extras];
  }, [derivedGroups, extraGroups]);

  const operationTypes = useMemo(() => {
    return [...new Set(groups.map((g) => g.operation_type))];
  }, [groups]);

  /* --- Group label editing --- */

  const startEditing = useCallback((groupId: string, currentLabel: string) => {
    setEditingGroupId(groupId);
    setEditingLabel(currentLabel);
  }, []);

  const commitLabel = useCallback(() => {
    if (editingGroupId && editingLabel.trim()) {
      onGroupLabelsChange({ ...groupLabels, [editingGroupId]: editingLabel.trim() });
      setExtraGroups((prev) =>
        prev.map((eg) =>
          eg.group_id === editingGroupId ? { ...eg, label: editingLabel.trim() } : eg
        )
      );
    }
    setEditingGroupId(null);
    setEditingLabel("");
  }, [editingGroupId, editingLabel, groupLabels, onGroupLabelsChange]);

  /* --- Group settings update --- */

  const updateGroupSettings = useCallback(
    (groupId: string, field: keyof MachiningSettings, value: unknown) => {
      const group = groups.find((g) => g.group_id === groupId);
      if (!group) return;

      const opIdsInGroup = new Set(group.operation_ids);

      const updated = assignments.map((a) =>
        opIdsInGroup.has(a.operation_id)
          ? { ...a, settings: { ...a.settings, [field]: value } }
          : a
      );
      onAssignmentsChange(updated);

      setExtraGroups((prev) =>
        prev.map((eg) =>
          eg.group_id === groupId
            ? { ...eg, settings: { ...eg.settings, [field]: value } }
            : eg
        )
      );
    },
    [groups, assignments, onAssignmentsChange]
  );

  /* --- Apply full settings to a group (for presets) --- */

  const applySettingsToGroup = useCallback(
    (groupId: string, settings: MachiningSettings, presetName?: string) => {
      const group = groups.find((g) => g.group_id === groupId);
      if (!group) return;

      const opIdsInGroup = new Set(group.operation_ids);

      const updated = assignments.map((a) =>
        opIdsInGroup.has(a.operation_id) ? { ...a, settings: { ...settings } } : a
      );
      onAssignmentsChange(updated);

      setExtraGroups((prev) =>
        prev.map((eg) =>
          eg.group_id === groupId ? { ...eg, settings: { ...settings } } : eg
        )
      );

      if (presetName) {
        onGroupLabelsChange({ ...groupLabels, [groupId]: presetName });
        setExtraGroups((prev) =>
          prev.map((eg) =>
            eg.group_id === groupId ? { ...eg, label: presetName } : eg
          )
        );
      }

      setPresetMenuGroupId(null);
    },
    [groups, assignments, onAssignmentsChange, groupLabels, onGroupLabelsChange]
  );

  /* --- Save current group settings as user preset --- */

  const saveAsPreset = useCallback(
    (groupId: string, name: string) => {
      const group = groups.find((g) => g.group_id === groupId);
      if (!group || !name.trim()) return;

      const newPreset: UserPreset = {
        id: `user_${Date.now()}`,
        name: name.trim(),
        settings: { ...group.settings },
      };
      const updated = [...userPresets, newPreset];
      setUserPresets(updated);
      saveUserPresets(updated);
      setSavingPresetGroupId(null);
      setNewPresetName("");
    },
    [groups, userPresets]
  );

  const deleteUserPreset = useCallback(
    (presetId: string) => {
      const updated = userPresets.filter((p) => p.id !== presetId);
      setUserPresets(updated);
      saveUserPresets(updated);
    },
    [userPresets]
  );

  /* --- Toggle enabled --- */

  const toggleEnabled = useCallback(
    (opId: string) => {
      const updated = assignments.map((a) =>
        a.operation_id === opId ? { ...a, enabled: !a.enabled } : a
      );
      onAssignmentsChange(updated);
    },
    [assignments, onAssignmentsChange]
  );

  /* --- Drag & drop --- */

  const handleMoveToGroup = useCallback(
    (operationId: string, targetGroupId: string) => {
      const targetGroup = groups.find((g) => g.group_id === targetGroupId);
      if (!targetGroup) return;

      const updated = assignments.map((a) =>
        a.operation_id === operationId
          ? { ...a, group_id: targetGroupId, settings: { ...targetGroup.settings } }
          : a
      );
      onAssignmentsChange(updated);
    },
    [groups, assignments, onAssignmentsChange]
  );

  /* --- Add setting group --- */

  const handleAddSetting = useCallback(
    (operationType: string) => {
      const settingCount = groups.filter(
        (g) => !g.group_id.startsWith("default_") && g.operation_type === operationType
      ).length;
      const newGroupId = `override_${operationType}_${settingCount + 1}`;

      const defaultGroup = groups.find((g) => g.group_id === `default_${operationType}`);
      const baseSettings = defaultGroup?.settings ?? assignments[0]?.settings;
      if (!baseSettings) return;

      setExtraGroups((prev) => [
        ...prev,
        {
          group_id: newGroupId,
          label: `Setting ${settingCount + 1}`,
          operation_type: operationType,
          settings: { ...baseSettings },
          operation_ids: [],
        },
      ]);
    },
    [groups, assignments]
  );

  /* --- Remove empty group --- */

  const handleRemoveGroup = useCallback(
    (groupId: string) => {
      setExtraGroups((prev) => prev.filter((eg) => eg.group_id !== groupId));
      const next = { ...groupLabels };
      delete next[groupId];
      onGroupLabelsChange(next);
    },
    [groupLabels, onGroupLabelsChange]
  );

  /* --- Render --- */

  return (
    <div style={panelStyle}>
      <div style={panelBodyStyle}>
        {sheetIds.length > 1 && (
          <SheetBadge activeSheetId={activeSheetId} totalSheets={sheetIds.length} />
        )}

        {groups.map((group, groupIndex) => {
          const isDefault = group.group_id.startsWith("default_");
          const isExpanded = expandedGroup === group.group_id;
          const isDragOver = dragOverGroupId === group.group_id;
          const isEditing = editingGroupId === group.group_id;
          const showPresetMenu = presetMenuGroupId === group.group_id;
          const showSavePreset = savingPresetGroupId === group.group_id;

          const opsInGroup = detectedOperations.operations.filter(
            (op) => group.operation_ids.includes(op.operation_id)
          );

          return (
            <div
              key={group.group_id}
              style={{
                ...groupCardStyle,
                background: getGroupBg(groupIndex, isDefault),
                border: isDragOver ? "2px dashed #4a90d9" : "1px solid #eee",
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
                onClick={() => setExpandedGroup(isExpanded ? null : group.group_id)}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 4, flex: 1 }}>
                  <span style={{ fontSize: 10, color: "#888" }}>
                    {isExpanded ? "\u25BC" : "\u25B6"}
                  </span>
                  <span style={{ fontSize: 11, color: "#666" }}>
                    [{group.operation_type}]
                  </span>
                  {isEditing ? (
                    <input
                      style={labelEditStyle}
                      value={editingLabel}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setEditingLabel(e.target.value)}
                      onBlur={commitLabel}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitLabel();
                        if (e.key === "Escape") {
                          setEditingGroupId(null);
                          setEditingLabel("");
                        }
                      }}
                    />
                  ) : (
                    <span
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        startEditing(group.group_id, group.label);
                      }}
                      title="Double-click to rename"
                    >
                      {group.label}
                    </span>
                  )}
                  <span style={{ fontSize: 11, color: "#999" }}>
                    ({opsInGroup.length})
                  </span>
                </span>
                <span style={{ display: "flex", gap: 4 }}>
                  {group.operation_ids.length === 0 && !isDefault && (
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
                </span>
              </div>

              {/* Settings fields (if expanded) */}
              {isExpanded && (
                <div style={settingsBodyStyle}>
                  {/* Preset bar */}
                  <div style={presetBarStyle}>
                    <button
                      style={presetBtnStyle}
                      onClick={() =>
                        setPresetMenuGroupId(showPresetMenu ? null : group.group_id)
                      }
                    >
                      Load Preset
                    </button>
                    <button
                      style={presetBtnStyle}
                      onClick={() =>
                        setSavingPresetGroupId(showSavePreset ? null : group.group_id)
                      }
                    >
                      Save as Preset
                    </button>
                  </div>

                  {/* Preset dropdown */}
                  {showPresetMenu && (
                    <div style={presetDropdownStyle}>
                      {builtinPresets.length > 0 && (
                        <>
                          <div style={presetSectionLabel}>Built-in</div>
                          {builtinPresets.map((p) => (
                            <PresetRow
                              key={p.id}
                              label={p.name}
                              sub={p.material}
                              onClick={() =>
                                applySettingsToGroup(group.group_id, p.settings, p.name)
                              }
                            />
                          ))}
                        </>
                      )}
                      {userPresets.length > 0 && (
                        <>
                          <div style={presetSectionLabel}>My Presets</div>
                          {userPresets.map((p) => (
                            <div key={p.id} style={{ display: "flex", alignItems: "center" }}>
                              <PresetRow
                                label={p.name}
                                onClick={() =>
                                  applySettingsToGroup(group.group_id, p.settings, p.name)
                                }
                                style={{ flex: 1 }}
                              />
                              <button
                                style={presetDeleteBtnStyle}
                                onClick={() => deleteUserPreset(p.id)}
                                title="Delete preset"
                              >
                                x
                              </button>
                            </div>
                          ))}
                        </>
                      )}
                      {builtinPresets.length === 0 && userPresets.length === 0 && (
                        <div style={{ fontSize: 11, color: "#999", padding: 6 }}>
                          No presets available
                        </div>
                      )}
                    </div>
                  )}

                  {/* Save preset form */}
                  {showSavePreset && (
                    <div style={savePresetFormStyle}>
                      <input
                        style={savePresetInputStyle}
                        placeholder="Preset name..."
                        value={newPresetName}
                        autoFocus
                        onChange={(e) => setNewPresetName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveAsPreset(group.group_id, newPresetName);
                          if (e.key === "Escape") {
                            setSavingPresetGroupId(null);
                            setNewPresetName("");
                          }
                        }}
                      />
                      <button
                        style={presetBtnStyle}
                        onClick={() => saveAsPreset(group.group_id, newPresetName)}
                      >
                        Save
                      </button>
                    </div>
                  )}

                  {/* Settings fields */}
                  {opsInGroup.length > 0 && (
                    <>
                      {/* Common fields */}
                      {group.operation_type === "drill" ? (
                        <NumberRow
                          label="Depth/peck (mm)"
                          value={group.settings.depth_per_peck ?? 6}
                          onChange={(v) =>
                            updateGroupSettings(group.group_id, "depth_per_peck", v)
                          }
                        />
                      ) : (
                        <NumberRow
                          label="Depth/pass (mm)"
                          value={group.settings.depth_per_pass}
                          onChange={(v) =>
                            updateGroupSettings(group.group_id, "depth_per_pass", v)
                          }
                        />
                      )}
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
                          updateGroupSettings(group.group_id, "spindle_speed", Math.round(v))
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

                      {/* Pocket-specific fields */}
                      {group.operation_type === "pocket" && (
                        <>
                          <div style={fieldRowStyle}>
                            <label style={fieldLabelStyle}>Pattern</label>
                            <select
                              style={selectStyle}
                              value={group.settings.pocket_pattern ?? "contour-parallel"}
                              onChange={(e) =>
                                updateGroupSettings(
                                  group.group_id,
                                  "pocket_pattern",
                                  e.target.value
                                )
                              }
                            >
                              <option value="contour-parallel">Contour Parallel</option>
                              <option value="raster">Raster (Zigzag)</option>
                            </select>
                          </div>
                          <NumberRow
                            label="Stepover (%)"
                            value={Math.round((group.settings.pocket_stepover ?? 0.5) * 100)}
                            step={5}
                            onChange={(v) =>
                              updateGroupSettings(
                                group.group_id,
                                "pocket_stepover",
                                Math.max(0.1, Math.min(1, v / 100))
                              )
                            }
                          />
                        </>
                      )}

                      {/* Contour-specific fields */}
                      {group.operation_type === "contour" && (
                        <>
                          <div style={fieldRowStyle}>
                            <label style={fieldLabelStyle}>Direction</label>
                            <select
                              style={selectStyle}
                              value={group.settings.direction}
                              onChange={(e) =>
                                updateGroupSettings(group.group_id, "direction", e.target.value)
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
                        </>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Divider */}
              {opsInGroup.length > 0 && (
                <div style={{ borderTop: "1px solid #e8e8e8", margin: "4px 0" }} />
              )}

              {/* Object rows */}
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
                    style={{ ...objectRowStyle, opacity: isDragged ? 0.4 : 1 }}
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
                            ⚠ sheet too thin
                          </span>
                        )}
                      </span>
                    </label>
                  </div>
                );
              })}

              {/* Empty group hint */}
              {opsInGroup.length === 0 && (
                <div
                  style={{
                    fontSize: 11,
                    color: "#aaa",
                    padding: "4px 8px",
                    fontStyle: "italic",
                  }}
                >
                  Drag objects here
                </div>
              )}
            </div>
          );
        })}

        {/* Add Setting buttons */}
        {operationTypes.map((opType) => (
          <button
            key={opType}
            onClick={() => handleAddSetting(opType)}
            style={addSettingBtnStyle}
          >
            + Add Setting ({opType})
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

function PresetRow({
  label,
  sub,
  onClick,
  style,
}: {
  label: string;
  sub?: string;
  onClick: () => void;
  style?: React.CSSProperties;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      style={{
        ...presetItemBaseStyle,
        background: hover ? "#f0f4ff" : "none",
        ...style,
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
    >
      {label}
      {sub && (
        <span style={{ fontSize: 10, color: "#999", marginLeft: 4 }}>{sub}</span>
      )}
    </button>
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

const labelEditStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  border: "1px solid #4a90d9",
  borderRadius: 3,
  padding: "1px 4px",
  outline: "none",
  width: 100,
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

const addSettingBtnStyle: React.CSSProperties = {
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

const presetBarStyle: React.CSSProperties = {
  display: "flex",
  gap: 4,
  marginBottom: 6,
};

const presetBtnStyle: React.CSSProperties = {
  fontSize: 10,
  color: "#555",
  background: "#fff",
  border: "1px solid #ccc",
  borderRadius: 4,
  padding: "2px 8px",
  cursor: "pointer",
};

const presetDropdownStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #ddd",
  borderRadius: 4,
  marginBottom: 6,
  maxHeight: 160,
  overflowY: "auto",
  padding: 4,
};

const presetSectionLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: "#888",
  padding: "4px 6px 2px",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

const presetItemBaseStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  fontSize: 11,
  background: "none",
  border: "none",
  padding: "4px 6px",
  cursor: "pointer",
  borderRadius: 3,
};

const presetDeleteBtnStyle: React.CSSProperties = {
  fontSize: 10,
  color: "#999",
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: "2px 6px",
};

const savePresetFormStyle: React.CSSProperties = {
  display: "flex",
  gap: 4,
  marginBottom: 6,
};

const savePresetInputStyle: React.CSSProperties = {
  fontSize: 11,
  border: "1px solid #ccc",
  borderRadius: 4,
  padding: "2px 6px",
  flex: 1,
};
