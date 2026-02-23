import { useCallback, useMemo, useState } from "react";
import type {
  OperationDetectResult,
  OperationAssignment,
  StockSettings,
  MachiningSettings,
  PlacementItem,
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

export default function OperationDetailPanel({
  detectedOperations,
  assignments,
  stockSettings,
  onAssignmentsChange,
  placements,
  stockIds,
  activeStockId,
}: Props) {
  const [expandedOp, setExpandedOp] = useState<string | null>(null);

  const materials = stockSettings?.materials ?? [];

  // Filter by active stock
  const activeObjectIds = useMemo(() => {
    return new Set(placements.filter((p) => p.stock_id === activeStockId).map((p) => p.object_id));
  }, [placements, activeStockId]);

  const filteredOps = useMemo(() => {
    return detectedOperations.operations.filter((op) => activeObjectIds.has(op.object_id));
  }, [detectedOperations, activeObjectIds]);

  const updateAssignment = useCallback(
    (opId: string, update: Partial<OperationAssignment>) => {
      const updated = assignments.map((a) =>
        a.operation_id === opId ? { ...a, ...update } : a
      );
      onAssignmentsChange(updated);
    },
    [assignments, onAssignmentsChange]
  );

  const updateSettings = useCallback(
    (opId: string, field: keyof MachiningSettings, value: unknown) => {
      const updated = assignments.map((a) =>
        a.operation_id === opId
          ? { ...a, settings: { ...a.settings, [field]: value } }
          : a
      );
      onAssignmentsChange(updated);
    },
    [assignments, onAssignmentsChange]
  );

  return (
    <div style={panelStyle}>
      <div style={panelBodyStyle}>
        {stockIds.length > 1 && (
          <StockBadge
            activeStockId={activeStockId}
            totalStocks={stockIds.length}
          />
        )}
        {filteredOps.map((op) => {
          const assignment = assignments.find(
            (a) => a.operation_id === op.operation_id
          );
          if (!assignment) return null;

          const isExpanded = expandedOp === op.operation_id;
          const detectedObj = op;

          // Warn if stock thickness < object depth
          const assignedMat = materials.find(
            (m) => m.material_id === assignment.material_id
          );
          const thicknessWarning =
            assignedMat && assignedMat.thickness < detectedObj.geometry.depth;

          return (
            <div key={op.operation_id} style={opCardStyle}>
              {/* Header row */}
              <div
                style={opCardHeaderStyle}
                onClick={() =>
                  setExpandedOp(isExpanded ? null : op.operation_id)
                }
              >
                <label
                  style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={assignment.enabled}
                    onChange={() =>
                      updateAssignment(op.operation_id, {
                        enabled: !assignment.enabled,
                      })
                    }
                  />
                  <span style={{ fontWeight: 600, fontSize: 12 }}>
                    {op.operation_type} — {op.object_id}
                  </span>
                </label>
                <span style={{ fontSize: 10, color: "#888" }}>
                  {isExpanded ? "\u25BC" : "\u25B6"}
                </span>
              </div>

              {/* Summary line */}
              <div style={{ fontSize: 11, color: "#666", padding: "2px 0 2px 22px" }}>
                depth: {op.geometry.depth.toFixed(1)}mm
                {thicknessWarning && (
                  <span style={{ color: "#e65100", marginLeft: 8 }}>
                    stock too thin!
                  </span>
                )}
              </div>

              {/* Material assignment */}
              <div style={{ padding: "4px 0 4px 22px" }}>
                <label style={{ fontSize: 11, color: "#555" }}>
                  Material:{" "}
                  <select
                    style={selectStyle}
                    value={assignment.material_id}
                    onChange={(e) =>
                      updateAssignment(op.operation_id, {
                        material_id: e.target.value,
                      })
                    }
                  >
                    {materials.map((m) => (
                      <option key={m.material_id} value={m.material_id}>
                        {m.label || m.material_id} ({m.thickness}mm)
                      </option>
                    ))}
                    {materials.length === 0 && (
                      <option value={assignment.material_id}>
                        {assignment.material_id}
                      </option>
                    )}
                  </select>
                </label>
              </div>

              {/* Expanded settings */}
              {isExpanded && (
                <div style={settingsBodyStyle}>
                  <NumberRow
                    label="Depth/pass (mm)"
                    value={assignment.settings.depth_per_pass}
                    onChange={(v) =>
                      updateSettings(op.operation_id, "depth_per_pass", v)
                    }
                  />
                  <NumberRow
                    label="Feed XY (mm/s)"
                    value={assignment.settings.feed_rate.xy}
                    onChange={(v) =>
                      updateSettings(op.operation_id, "feed_rate", {
                        ...assignment.settings.feed_rate,
                        xy: v,
                      })
                    }
                  />
                  <NumberRow
                    label="Feed Z (mm/s)"
                    value={assignment.settings.feed_rate.z}
                    onChange={(v) =>
                      updateSettings(op.operation_id, "feed_rate", {
                        ...assignment.settings.feed_rate,
                        z: v,
                      })
                    }
                  />
                  <NumberRow
                    label="Spindle (RPM)"
                    value={assignment.settings.spindle_speed}
                    step={1000}
                    onChange={(v) =>
                      updateSettings(op.operation_id, "spindle_speed", Math.round(v))
                    }
                  />
                  <NumberRow
                    label="Tool dia (mm)"
                    value={assignment.settings.tool.diameter}
                    step={0.1}
                    onChange={(v) =>
                      updateSettings(op.operation_id, "tool", {
                        ...assignment.settings.tool,
                        diameter: v,
                      })
                    }
                  />
                  <div style={fieldRowStyle}>
                    <label style={fieldLabelStyle}>Direction</label>
                    <select
                      style={selectStyle}
                      value={assignment.settings.direction}
                      onChange={(e) =>
                        updateSettings(op.operation_id, "direction", e.target.value)
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
                        checked={assignment.settings.tabs.enabled}
                        onChange={() =>
                          updateSettings(op.operation_id, "tabs", {
                            ...assignment.settings.tabs,
                            enabled: !assignment.settings.tabs.enabled,
                          })
                        }
                      />
                      {" "}enabled ({assignment.settings.tabs.count})
                    </label>
                  </div>
                </div>
              )}
            </div>
          );
        })}
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

const opCardStyle: React.CSSProperties = {
  border: "1px solid #eee",
  borderRadius: 6,
  marginBottom: 8,
  padding: 8,
};

const opCardHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  cursor: "pointer",
  userSelect: "none",
};

const settingsBodyStyle: React.CSSProperties = {
  marginTop: 8,
  paddingLeft: 22,
  borderTop: "1px solid #f0f0f0",
  paddingTop: 8,
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
