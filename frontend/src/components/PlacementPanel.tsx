import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BrepObject, SheetSettings, PlacementItem } from "../types";
import { autoNesting } from "../api";
import SheetTabs from "./SheetTabs";
import { DEFAULT_SHEET_ID, DEFAULT_CLEARANCE_MM } from "../constants";
import { rotatePoint, rotatedAABB } from "../utils/coordinates";

interface Props {
  objects: BrepObject[];
  sheetSettings: SheetSettings;
  placements: PlacementItem[];
  onPlacementsChange: (placements: PlacementItem[]) => void;
  warnings: string[];
  activeSheetId: string;
  onActiveSheetChange: (sheetId: string) => void;
}

export default function PlacementPanel({
  objects,
  sheetSettings,
  placements,
  onPlacementsChange,
  warnings,
  activeSheetId,
  onActiveSheetChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState<{ mx: number; my: number; ox: number; oy: number } | null>(null);
  const [clearance, setClearance] = useState(DEFAULT_CLEARANCE_MM);
  const [nestingLoading, setNestingLoading] = useState(false);

  // Sheet list derived from placements
  const sheetIds = useMemo(() => {
    const ids = [...new Set(placements.map((p) => p.sheet_id))];
    if (ids.length === 0) ids.push(DEFAULT_SHEET_ID);
    return ids.sort();
  }, [placements]);

  // Filter placements to active sheet
  const activePlacements = useMemo(
    () => placements.filter((p) => p.sheet_id === activeSheetId),
    [placements, activeSheetId],
  );

  const handleAutoNesting = async () => {
    setNestingLoading(true);
    try {
      const result = await autoNesting(objects, sheetSettings, 6.35, clearance);
      onPlacementsChange(result.placements);
      if (result.placements.length > 0) {
        onActiveSheetChange(result.placements[0].sheet_id);
      }
    } catch (e) {
      console.error("Auto nesting failed:", e);
    } finally {
      setNestingLoading(false);
    }
  };

  const sheetMat = sheetSettings.materials[0];

  const canvasW = 560;
  const canvasH = 400;
  const padding = 40;

  const scale = sheetMat
    ? Math.min(
        (canvasW - 2 * padding) / sheetMat.width,
        (canvasH - 2 * padding) / sheetMat.depth
      )
    : 1;
  const offsetX = sheetMat ? (canvasW - sheetMat.width * scale) / 2 : 0;
  const offsetY = sheetMat ? (canvasH - sheetMat.depth * scale) / 2 : 0;

  const toCanvas = useCallback(
    (x: number, y: number): [number, number] => [
      x * scale + offsetX,
      canvasH - (y * scale + offsetY),
    ],
    [scale, offsetX, offsetY]
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!sheetMat) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasW, canvasH);

    // Sheet background
    const [sx0, sy0] = toCanvas(0, 0);
    const [sx1, sy1] = toCanvas(sheetMat.width, sheetMat.depth);
    ctx.fillStyle = "#f5f5f5";
    ctx.fillRect(sx0, sy1, sx1 - sx0, sy0 - sy1);
    ctx.strokeStyle = "#999";
    ctx.lineWidth = 1;
    ctx.strokeRect(sx0, sy1, sx1 - sx0, sy0 - sy1);

    // Sheet dimensions
    ctx.fillStyle = "#999";
    ctx.font = "11px sans-serif";
    ctx.fillText(`${sheetMat.width} \u00d7 ${sheetMat.depth} mm`, sx0, sy1 - 6);

    // Origin
    ctx.fillStyle = "#333";
    ctx.beginPath();
    ctx.arc(sx0, sy0, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText("(0,0)", sx0 + 6, sy0 - 4);

    // Parts (only active sheet)
    const colors = ["#4a90d9", "#7b61ff", "#43a047", "#ef5350"];
    for (let i = 0; i < activePlacements.length; i++) {
      const p = activePlacements[i];
      const obj = objects.find((o) => o.object_id === p.object_id);
      if (!obj) continue;

      const bb = obj.bounding_box;
      const rot = p.rotation || 0;
      const rcx = bb.x / 2;
      const rcy = bb.y / 2;

      // Out-of-bounds check using rotated AABB
      const aabb = rotatedAABB(bb.x, bb.y, rot);
      const isOut =
        p.x_offset + aabb.maxX > sheetMat.width ||
        p.y_offset + aabb.maxY > sheetMat.depth ||
        p.x_offset + aabb.minX < 0 ||
        p.y_offset + aabb.minY < 0;

      const fillColor = isOut ? "rgba(229,57,53,0.15)" : `${colors[i % colors.length]}22`;
      const strokeColor = isOut ? "#e53935" : colors[i % colors.length];
      const lineW = isOut ? 2 : 1.5;

      if (obj.outline && obj.outline.length > 2) {
        // Draw rotated outline
        ctx.beginPath();
        const [rx0, ry0] = rotatePoint(obj.outline[0][0], obj.outline[0][1], rot, rcx, rcy);
        const [cx0, cy0] = toCanvas(p.x_offset + rx0, p.y_offset + ry0);
        ctx.moveTo(cx0, cy0);
        for (let j = 1; j < obj.outline.length; j++) {
          const [rx, ry] = rotatePoint(obj.outline[j][0], obj.outline[j][1], rot, rcx, rcy);
          const [cx, cy] = toCanvas(p.x_offset + rx, p.y_offset + ry);
          ctx.lineTo(cx, cy);
        }
        ctx.closePath();
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = lineW;
        ctx.stroke();
      } else {
        // Fallback: rotated bounding box as polygon
        const bbCorners: [number, number][] = [[0, 0], [bb.x, 0], [bb.x, bb.y], [0, bb.y]];
        ctx.beginPath();
        for (let j = 0; j < bbCorners.length; j++) {
          const [rx, ry] = rotatePoint(bbCorners[j][0], bbCorners[j][1], rot, rcx, rcy);
          const [cx, cy] = toCanvas(p.x_offset + rx, p.y_offset + ry);
          if (j === 0) ctx.moveTo(cx, cy);
          else ctx.lineTo(cx, cy);
        }
        ctx.closePath();
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = lineW;
        ctx.stroke();
      }

      // Label (at rotated top-left corner)
      const [rlx, rly] = rotatePoint(0, bb.y, rot, rcx, rcy);
      const [lx, ly] = toCanvas(p.x_offset + rlx, p.y_offset + rly);
      ctx.fillStyle = colors[i % colors.length];
      ctx.font = "bold 11px sans-serif";
      ctx.fillText(p.object_id, lx + 4, ly + 14);
    }
  }, [activePlacements, objects, sheetMat, toCanvas]);

  useEffect(() => { draw(); }, [draw]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (canvasW / rect.width);
    const cy = (e.clientY - rect.top) * (canvasH / rect.height);

    // Hit test: find which part is under cursor (using rotated AABB)
    for (let i = activePlacements.length - 1; i >= 0; i--) {
      const p = activePlacements[i];
      const obj = objects.find((o) => o.object_id === p.object_id);
      if (!obj) continue;
      const bb = obj.bounding_box;
      const aabb = rotatedAABB(bb.x, bb.y, p.rotation || 0);
      const [px0, py0] = toCanvas(p.x_offset + aabb.minX, p.y_offset + aabb.minY);
      const [px1, py1] = toCanvas(p.x_offset + aabb.maxX, p.y_offset + aabb.maxY);
      if (cx >= px0 && cx <= px1 && cy >= py1 && cy <= py0) {
        setDragging(p.object_id);
        setDragStart({ mx: cx, my: cy, ox: p.x_offset, oy: p.y_offset });
        return;
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragging || !dragStart) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (canvasW / rect.width);
    const cy = (e.clientY - rect.top) * (canvasH / rect.height);
    const dx = (cx - dragStart.mx) / scale;
    const dy = -(cy - dragStart.my) / scale;
    const newPlacements = placements.map((p) =>
      p.object_id === dragging
        ? { ...p, x_offset: Math.round(dragStart.ox + dx), y_offset: Math.round(dragStart.oy + dy) }
        : p
    );
    onPlacementsChange(newPlacements);
  };

  const handleMouseUp = () => {
    setDragging(null);
    setDragStart(null);
  };

  const handleNumericChange = (objectId: string, field: "x_offset" | "y_offset" | "rotation", value: number) => {
    const updated = placements.map((p) =>
      p.object_id === objectId ? { ...p, [field]: value } : p
    );
    onPlacementsChange(updated);
  };

  const handleRotate = (objectId: string) => {
    const updated = placements.map((p) =>
      p.object_id === objectId
        ? { ...p, rotation: ((p.rotation || 0) + 45) % 360 }
        : p
    );
    onPlacementsChange(updated);
  };

  if (!sheetMat) return null;

  return (
    <div style={panelStyle}>
      <div style={{ padding: "12px 16px 0" }}>
        {/* Auto Nesting + Clearance */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <button
            onClick={handleAutoNesting}
            disabled={nestingLoading || objects.length === 0}
            style={nestingBtnStyle}
          >
            {nestingLoading ? "Nesting..." : "Auto Nesting"}
          </button>
          <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
            Clearance:
            <input
              type="number"
              value={clearance}
              onChange={(e) => setClearance(Number(e.target.value))}
              style={{ width: 50, padding: "3px 6px", border: "1px solid var(--border-color)", borderRadius: "var(--radius-item)", fontSize: 12, background: "var(--surface-bg)", color: "var(--text-primary)" }}
              min={0}
              step={1}
            />
            mm
          </label>
        </div>

        {/* Sheet Tabs */}
        <SheetTabs
          sheetIds={sheetIds}
          activeSheetId={activeSheetId}
          onChange={onActiveSheetChange}
          counts={Object.fromEntries(sheetIds.map((sid) => [sid, placements.filter((p) => p.sheet_id === sid).length]))}
        />
      </div>

      <div style={{ padding: "0 16px 16px" }}>
        <canvas
          ref={canvasRef}
          width={canvasW}
          height={canvasH}
          style={{ width: "100%", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-item)", cursor: dragging ? "grabbing" : "default" }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
      </div>

      {warnings.length > 0 && (
        <div style={warningStyle}>
          {warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 11, color: "var(--color-error)", padding: "2px 0" }}>{w}</div>
          ))}
        </div>
      )}

      <div style={inputsStyle}>
        <div style={inputsTitle}>Position (mm)</div>
        {activePlacements.map((p) => {
          const obj = objects.find((o) => o.object_id === p.object_id);
          return (
            <div key={p.object_id} style={inputRow}>
              <span style={{ fontSize: 12, fontWeight: 600, minWidth: 60 }}>{p.object_id}</span>
              <label style={labelStyle}>
                X:
                <input
                  type="number"
                  value={p.x_offset}
                  onChange={(e) => handleNumericChange(p.object_id, "x_offset", Number(e.target.value))}
                  style={numInputStyle}
                />
              </label>
              <label style={labelStyle}>
                Y:
                <input
                  type="number"
                  value={p.y_offset}
                  onChange={(e) => handleNumericChange(p.object_id, "y_offset", Number(e.target.value))}
                  style={numInputStyle}
                />
              </label>
              <button
                onClick={() => handleRotate(p.object_id)}
                style={rotBtnStyle}
                title="45° rotate"
              >
                {"\u27F3"} {p.rotation || 0}°
              </button>
              {obj && (
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  ({obj.bounding_box.x.toFixed(0)}{"\u00d7"}{obj.bounding_box.y.toFixed(0)})
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const nestingBtnStyle: React.CSSProperties = { padding: "4px 12px", fontSize: 12, background: "var(--color-accent)", color: "#fff", border: "none", borderRadius: "var(--radius-item)", cursor: "pointer", fontWeight: 600 };
const panelStyle: React.CSSProperties = { display: "flex", flexDirection: "column", height: "100%", overflow: "auto" };
const warningStyle: React.CSSProperties = { padding: "8px 16px", background: "#fff3e0", borderTop: "1px solid #ffe0b2" };
const inputsStyle: React.CSSProperties = { padding: "12px 16px", borderTop: "1px solid var(--surface-bg)" };
const inputsTitle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, paddingBottom: 8 };
const inputRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "4px 0" };
const labelStyle: React.CSSProperties = { fontSize: 11, display: "flex", alignItems: "center", gap: 4 };
const numInputStyle: React.CSSProperties = { width: 60, padding: "3px 6px", border: "1px solid var(--border-color)", borderRadius: "var(--radius-item)", fontSize: 12, background: "var(--surface-bg)", color: "var(--text-primary)" };
const rotBtnStyle: React.CSSProperties = { padding: "2px 6px", border: "1px solid var(--border-color)", borderRadius: "var(--radius-item)", fontSize: 11, background: "var(--surface-bg)", cursor: "pointer", whiteSpace: "nowrap" };
