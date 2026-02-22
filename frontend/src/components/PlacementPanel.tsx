import { useCallback, useEffect, useRef, useState } from "react";
import type { BrepObject, StockSettings, PlacementItem } from "../types";

interface Props {
  objects: BrepObject[];
  stockSettings: StockSettings;
  placements: PlacementItem[];
  onPlacementsChange: (placements: PlacementItem[]) => void;
  warnings: string[];
}

export default function PlacementPanel({
  objects,
  stockSettings,
  placements,
  onPlacementsChange,
  warnings,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState<{ mx: number; my: number; ox: number; oy: number } | null>(null);

  const stock = stockSettings.materials[0];

  const canvasW = 560;
  const canvasH = 400;
  const padding = 40;

  const scale = stock
    ? Math.min(
        (canvasW - 2 * padding) / stock.width,
        (canvasH - 2 * padding) / stock.depth
      )
    : 1;
  const offsetX = stock ? (canvasW - stock.width * scale) / 2 : 0;
  const offsetY = stock ? (canvasH - stock.depth * scale) / 2 : 0;

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
    if (!stock) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasW, canvasH);

    // Stock background
    const [sx0, sy0] = toCanvas(0, 0);
    const [sx1, sy1] = toCanvas(stock.width, stock.depth);
    ctx.fillStyle = "#f5f5f5";
    ctx.fillRect(sx0, sy1, sx1 - sx0, sy0 - sy1);
    ctx.strokeStyle = "#999";
    ctx.lineWidth = 1;
    ctx.strokeRect(sx0, sy1, sx1 - sx0, sy0 - sy1);

    // Stock dimensions
    ctx.fillStyle = "#999";
    ctx.font = "11px sans-serif";
    ctx.fillText(`${stock.width} \u00d7 ${stock.depth} mm`, sx0, sy1 - 6);

    // Origin
    ctx.fillStyle = "#333";
    ctx.beginPath();
    ctx.arc(sx0, sy0, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText("(0,0)", sx0 + 6, sy0 - 4);

    // Parts
    const colors = ["#4a90d9", "#7b61ff", "#43a047", "#ef5350"];
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      const obj = objects.find((o) => o.object_id === p.object_id);
      if (!obj) continue;

      const bb = obj.bounding_box;
      const [px0, py0] = toCanvas(p.x_offset, p.y_offset);
      const [px1, py1] = toCanvas(p.x_offset + bb.x, p.y_offset + bb.y);

      const isOut =
        p.x_offset + bb.x > stock.width ||
        p.y_offset + bb.y > stock.depth ||
        p.x_offset < 0 ||
        p.y_offset < 0;

      ctx.fillStyle = isOut ? "rgba(229,57,53,0.15)" : `${colors[i % colors.length]}22`;
      ctx.fillRect(px0, py1, px1 - px0, py0 - py1);
      ctx.strokeStyle = isOut ? "#e53935" : colors[i % colors.length];
      ctx.lineWidth = isOut ? 2 : 1.5;
      ctx.strokeRect(px0, py1, px1 - px0, py0 - py1);

      ctx.fillStyle = colors[i % colors.length];
      ctx.font = "bold 11px sans-serif";
      ctx.fillText(p.object_id, px0 + 4, py1 + 14);
    }
  }, [placements, objects, stock, toCanvas]);

  useEffect(() => { draw(); }, [draw]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (canvasW / rect.width);
    const cy = (e.clientY - rect.top) * (canvasH / rect.height);

    // Hit test: find which part is under cursor
    for (let i = placements.length - 1; i >= 0; i--) {
      const p = placements[i];
      const obj = objects.find((o) => o.object_id === p.object_id);
      if (!obj) continue;
      const [px0, py0] = toCanvas(p.x_offset, p.y_offset);
      const [px1, py1] = toCanvas(p.x_offset + obj.bounding_box.x, p.y_offset + obj.bounding_box.y);
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

  const handleNumericChange = (objectId: string, field: "x_offset" | "y_offset", value: number) => {
    const updated = placements.map((p) =>
      p.object_id === objectId ? { ...p, [field]: value } : p
    );
    onPlacementsChange(updated);
  };

  if (!stock) return null;

  return (
    <div style={panelStyle}>
      <div style={{ padding: 16 }}>
        <canvas
          ref={canvasRef}
          width={canvasW}
          height={canvasH}
          style={{ width: "100%", border: "1px solid #eee", borderRadius: 4, cursor: dragging ? "grabbing" : "default" }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
      </div>

      {warnings.length > 0 && (
        <div style={warningStyle}>
          {warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 11, color: "#d32f2f", padding: "2px 0" }}>{w}</div>
          ))}
        </div>
      )}

      <div style={inputsStyle}>
        <div style={inputsTitle}>Position (mm)</div>
        {placements.map((p) => {
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
              {obj && (
                <span style={{ fontSize: 10, color: "#888" }}>
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

const panelStyle: React.CSSProperties = { display: "flex", flexDirection: "column", height: "100%", overflow: "auto" };
const warningStyle: React.CSSProperties = { padding: "8px 16px", background: "#fff3e0", borderTop: "1px solid #ffe0b2" };
const inputsStyle: React.CSSProperties = { padding: "12px 16px", borderTop: "1px solid #f0f0f0" };
const inputsTitle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 1, paddingBottom: 8 };
const inputRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "4px 0" };
const labelStyle: React.CSSProperties = { fontSize: 11, display: "flex", alignItems: "center", gap: 4 };
const numInputStyle: React.CSSProperties = { width: 60, padding: "3px 6px", border: "1px solid #ddd", borderRadius: 4, fontSize: 12 };
