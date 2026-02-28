import { useCallback, useEffect, useRef, useState } from "react";
import type { ToolpathGenResult, PlacementItem } from "../types";
import { outlineToSheet } from "../utils/coordinates";

interface Props {
  toolpathResult: ToolpathGenResult;
  placements?: PlacementItem[];
  activeSheetId?: string;
  boundingBoxes?: Record<string, { x: number; y: number; z: number }>;
  outlines?: Record<string, [number, number][]>;
}

export default function ToolpathPreviewPanel({
  toolpathResult,
  placements,
  activeSheetId,
  boundingBoxes,
  outlines,
}: Props) {
  // Transform outline coords (BB-min-local) to sheet-space using shared util
  const outlineToSheetCb = useCallback(
    (
      coords: [number, number][],
      objectId: string,
      placement: PlacementItem | undefined,
    ): [number, number][] => {
      const bb = boundingBoxes?.[objectId];
      return outlineToSheet(
        coords,
        placement?.rotation ?? 0,
        bb ? bb.x / 2 : 0,
        bb ? bb.y / 2 : 0,
        placement?.x_offset ?? 0,
        placement?.y_offset ?? 0,
      );
    },
    [boundingBoxes],
  );

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const stats = calcStats(toolpathResult);

  // Compute base transform (auto-fit) once
  const computeBase = useCallback(
    (w: number, h: number) => {
      const allPoints: [number, number][] = [];
      for (const tp of toolpathResult.toolpaths) {
        for (const pass of tp.passes) {
          for (const pt of pass.path) allPoints.push(pt);
        }
      }
      // Include original outlines in bounds (transformed to sheet-space)
      if (outlines && placements) {
        const sheetId = activeSheetId ?? "sheet_1";
        const placementMap = new Map(
          placements.filter((p) => p.sheet_id === sheetId).map((p) => [p.object_id, p])
        );
        for (const [objId, coords] of Object.entries(outlines)) {
          const pl = placementMap.get(objId);
          if (!pl) continue;
          const sheetCoords = outlineToSheetCb(coords, objId, pl);
          for (const pt of sheetCoords) allPoints.push(pt);
        }
      }
      if (toolpathResult.sheet_width && toolpathResult.sheet_depth) {
        allPoints.push([0, 0]);
        allPoints.push([toolpathResult.sheet_width, toolpathResult.sheet_depth]);
      } else {
        allPoints.push([0, 0]);
      }
      if (allPoints.length === 0) return { scale: 1, offsetX: 0, offsetY: 0, minX: 0, minY: 0 };

      const xs = allPoints.map((p) => p[0]);
      const ys = allPoints.map((p) => p[1]);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const rangeX = maxX - minX || 1;
      const rangeY = maxY - minY || 1;
      const padding = 0.08;
      const scale = Math.min(
        (w * (1 - 2 * padding)) / rangeX,
        (h * (1 - 2 * padding)) / rangeY
      );
      const offsetX = (w - rangeX * scale) / 2;
      const offsetY = (h - rangeY * scale) / 2;
      return { scale, offsetX, offsetY, minX, minY };
    },
    [toolpathResult, outlines, placements, activeSheetId, outlineToSheetCb]
  );

  const draw = useCallback(
    (canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const base = computeBase(w, h);
      const s = base.scale * zoom;

      const toCanvas = (x: number, y: number): [number, number] => [
        (x - base.minX) * s + base.offsetX * zoom + panX,
        h - ((y - base.minY) * s + base.offsetY * zoom + panY),
      ];

      const allZ = toolpathResult.toolpaths.flatMap((tp) =>
        tp.passes.map((p) => p.z_depth)
      );
      const minZ = Math.min(...allZ);
      const maxZ = Math.max(...allZ);
      const zRange = maxZ - minZ || 1;

      // Read CSS variables from canvas element
      const cs = getComputedStyle(canvas);
      const textMuted = cs.getPropertyValue("--text-muted").trim() || "#aaa";
      const textPrimary = cs.getPropertyValue("--text-primary").trim() || "#333";
      const borderClr = cs.getPropertyValue("--border-color").trim() || "#ccc";
      const colorError = cs.getPropertyValue("--color-error").trim() || "#e53935";
      const colorSuccess = cs.getPropertyValue("--color-success").trim() || "#43a047";
      const colorWarning = cs.getPropertyValue("--color-warning").trim() || "#ff5722";

      // --- Sheet bounds ---
      if (toolpathResult.sheet_width && toolpathResult.sheet_depth) {
        const sw = toolpathResult.sheet_width;
        const sd = toolpathResult.sheet_depth;
        const [sx0, sy0] = toCanvas(0, 0);
        const [sx1, sy1] = toCanvas(sw, sd);
        ctx.save();
        ctx.strokeStyle = borderClr;
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(sx0, sy1, sx1 - sx0, sy0 - sy1);
        ctx.setLineDash([]);
        ctx.fillStyle = textMuted;
        ctx.font = "10px sans-serif";
        ctx.fillText(`${sw} × ${sd} mm`, sx0, sy1 - 4);
        ctx.restore();
      }

      // --- Origin axes ---
      const [ox, oy] = toCanvas(0, 0);
      const axisLen = 30;
      ctx.save();
      ctx.strokeStyle = colorError;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox + axisLen, oy);
      ctx.stroke();
      ctx.fillStyle = colorError;
      ctx.font = "bold 10px sans-serif";
      ctx.fillText("X", ox + axisLen + 2, oy + 3);
      ctx.strokeStyle = colorSuccess;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox, oy - axisLen);
      ctx.stroke();
      ctx.fillStyle = colorSuccess;
      ctx.fillText("Y", ox - 4, oy - axisLen - 4);
      ctx.fillStyle = textPrimary;
      ctx.beginPath();
      ctx.arc(ox, oy, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // --- Original object outlines (pre-offset geometry, transformed to sheet-space) ---
      if (outlines && placements) {
        const sheetId = activeSheetId ?? "sheet_1";
        const placementMap = new Map(
          placements.filter((p) => p.sheet_id === sheetId).map((p) => [p.object_id, p])
        );
        ctx.save();
        ctx.strokeStyle = textMuted;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        for (const [objId, coords] of Object.entries(outlines)) {
          const pl = placementMap.get(objId);
          if (!pl || coords.length < 2) continue;
          const sheetCoords = outlineToSheetCb(coords, objId, pl);
          ctx.beginPath();
          const [cx0, cy0] = toCanvas(sheetCoords[0][0], sheetCoords[0][1]);
          ctx.moveTo(cx0, cy0);
          for (let i = 1; i < sheetCoords.length; i++) {
            const [cx, cy] = toCanvas(sheetCoords[i][0], sheetCoords[i][1]);
            ctx.lineTo(cx, cy);
          }
          ctx.closePath();
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.restore();
      }

      // --- Toolpath lines ---
      for (const tp of toolpathResult.toolpaths) {
        const opType = tp.settings?.operation_type ?? "contour";

        // Collect all pass points into one connected path per operation
        const allPts: [number, number][] = [];
        let deepestT = 0;
        for (const pass of tp.passes) {
          const t = (pass.z_depth - minZ) / zRange;
          if (t > deepestT) deepestT = t;
          for (const pt of pass.path) allPts.push(pt);
        }

        if (allPts.length === 0) continue;

        if (opType === "pocket") {
          const r = Math.round(156 - deepestT * 60);
          const g = Math.round(39 + deepestT * 20);
          const b = Math.round(176 - deepestT * 60);
          ctx.strokeStyle = `rgba(${r},${g},${b},0.7)`;
          ctx.lineWidth = 0.8;
        } else if (opType === "drill") {
          ctx.strokeStyle = `rgba(255,${Math.round(152 - deepestT * 80)},0,0.9)`;
          ctx.lineWidth = 2;
        } else {
          const r = Math.round(0 + deepestT * 0);
          const g = Math.round(188 - deepestT * 120);
          const b = Math.round(212 - deepestT * 100);
          ctx.strokeStyle = `rgb(${r},${g},${b})`;
          ctx.lineWidth = 1.5;
        }

        ctx.beginPath();
        const [sx, sy] = toCanvas(allPts[0][0], allPts[0][1]);
        ctx.moveTo(sx, sy);
        for (let i = 1; i < allPts.length; i++) {
          const [px, py] = toCanvas(allPts[i][0], allPts[i][1]);
          ctx.lineTo(px, py);
        }
        ctx.stroke();

        // Draw tab markers
        for (const pass of tp.passes) {
          if (pass.tabs.length > 0) {
            ctx.fillStyle = colorWarning;
            for (const tab of pass.tabs) {
              const midIdx = Math.floor((tab.start_index + tab.end_index) / 2);
              if (midIdx < pass.path.length) {
                const [tx, ty] = toCanvas(pass.path[midIdx][0], pass.path[midIdx][1]);
                ctx.beginPath();
                ctx.arc(tx, ty, 4, 0, Math.PI * 2);
                ctx.fill();
              }
            }
          }
        }
      }

      // --- Zoom indicator ---
      if (zoom !== 1) {
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.font = "11px sans-serif";
        ctx.fillText(`${Math.round(zoom * 100)}%`, 8, h - 8);
        ctx.restore();
      }
    },
    [toolpathResult, outlines, placements, activeSheetId, zoom, panX, panY, computeBase, outlineToSheetCb]
  );

  useEffect(() => {
    if (canvasRef.current) draw(canvasRef.current);
  }, [draw]);

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = ((e.clientX - rect.left) / rect.width) * canvas.width;
      const my = ((e.clientY - rect.top) / rect.height) * canvas.height;

      setZoom((prev) => {
        const newZoom = Math.max(0.1, Math.min(prev * factor, 50));
        const ratio = newZoom / prev;
        setPanX((px) => mx - ratio * (mx - px));
        setPanY((py) => (canvas.height - my) - ratio * ((canvas.height - my) - py));
        return newZoom;
      });
    },
    []
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      setDragging(true);
      dragStartRef.current = { x: e.clientX, y: e.clientY, px: panX, py: panY };
    },
    [panX, panY]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!dragging || !dragStartRef.current || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const scaleX = canvasRef.current.width / rect.width;
      const scaleY = canvasRef.current.height / rect.height;
      const dx = (e.clientX - dragStartRef.current.x) * scaleX;
      const dy = (e.clientY - dragStartRef.current.y) * scaleY;
      setPanX(dragStartRef.current.px + dx);
      setPanY(dragStartRef.current.py - dy);
    },
    [dragging]
  );

  const handleMouseUp = useCallback(() => {
    setDragging(false);
    dragStartRef.current = null;
  }, []);

  const handleDoubleClick = useCallback(() => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  }, []);

  return (
    <div style={panelStyle}>
      {/* Canvas section */}
      <div style={canvasWrapStyle}>
        <canvas
          ref={canvasRef}
          width={600}
          height={450}
          style={{
            width: "100%",
            background: "var(--surface-bg)",
            borderRadius: "var(--radius-item)",
            cursor: dragging ? "grabbing" : "grab",
          }}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onDoubleClick={handleDoubleClick}
        />
        <div style={hintStyle}>Scroll to zoom / Drag to pan / Double-click to reset</div>
      </div>

      {/* Info section */}
      <div>
        <div style={summaryStyle}>
          <div style={summaryTitle}>Summary</div>
          <div style={summaryRow}>
            <span>Operations</span>
            <span>{stats.operationCount}</span>
          </div>
          <div style={summaryRow}>
            <span>Total passes</span>
            <span>{stats.totalPasses}</span>
          </div>
          <div style={summaryRow}>
            <span>Total distance</span>
            <span>{stats.totalDistance.toFixed(0)} mm</span>
          </div>
          <div style={summaryRow}>
            <span>Tab count</span>
            <span>{stats.tabCount}</span>
          </div>
          {/* Per-part breakdown */}
          {stats.partBreakdown.map(({ objectId, types }) => (
            <div key={objectId} style={{ marginTop: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)" }}>{objectId}</div>
              {types.map(({ contourType, passes, distance }) => (
                <div key={contourType} style={{ ...summaryRow, paddingLeft: 8, fontSize: 11 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: CONTOUR_COLORS[contourType], flexShrink: 0 }} />
                    {contourType}
                  </span>
                  <span>{passes}p / {distance.toFixed(0)}mm</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div style={legendStyle}>
          <div style={summaryTitle}>Legend</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, flexWrap: "wrap" }}>
            <span style={{ width: 16, height: 0, borderTop: "2px dashed var(--text-muted)", display: "inline-block" }} />
            <span>Original</span>
            <span style={{ width: 12, height: 12, background: "var(--color-cam)", borderRadius: 2, display: "inline-block" }} />
            <span>Contour</span>
            <span style={{ width: 12, height: 12, background: "var(--color-cad)", borderRadius: 2, display: "inline-block" }} />
            <span>Pocket</span>
            <span style={{ width: 12, height: 12, background: "var(--color-warning)", borderRadius: 2, display: "inline-block" }} />
            <span>Drill</span>
            <span style={{ width: 12, height: 12, background: "var(--color-warning)", borderRadius: "50%", display: "inline-block" }} />
            <span>Tab</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const CONTOUR_COLORS: Record<string, string> = {
  exterior: "#00bcd4",
  interior: "#4dd0e1",
  pocket: "#9c27b0",
  drill: "#ff9800",
};

interface PartTypeStats {
  contourType: string;
  passes: number;
  distance: number;
}

interface PartBreakdown {
  objectId: string;
  types: PartTypeStats[];
}

function calcStats(result: ToolpathGenResult) {
  let totalPasses = 0;
  let totalDistance = 0;
  let tabCount = 0;

  // Per-part, per-contour_type accumulator
  const partMap = new Map<string, Map<string, { passes: number; distance: number }>>();

  for (const tp of result.toolpaths) {
    const objId = tp.object_id || tp.operation_id;
    const cType = tp.contour_type || "contour";
    if (!partMap.has(objId)) partMap.set(objId, new Map());
    const typeMap = partMap.get(objId)!;
    if (!typeMap.has(cType)) typeMap.set(cType, { passes: 0, distance: 0 });
    const acc = typeMap.get(cType)!;

    for (const pass of tp.passes) {
      totalPasses++;
      acc.passes++;
      tabCount += pass.tabs.length;
      const pts = pass.path;
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i][0] - pts[i - 1][0];
        const dy = pts[i][1] - pts[i - 1][1];
        const d = Math.sqrt(dx * dx + dy * dy);
        totalDistance += d;
        acc.distance += d;
      }
    }
  }

  const partBreakdown: PartBreakdown[] = [...partMap.entries()].map(([objectId, typeMap]) => ({
    objectId,
    types: [...typeMap.entries()].map(([contourType, s]) => ({ contourType, ...s })),
  }));

  return {
    operationCount: result.toolpaths.length,
    totalPasses,
    totalDistance,
    tabCount,
    partBreakdown,
  };
}

/* --- Styles --- */
const panelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
};

const canvasWrapStyle: React.CSSProperties = {
  padding: 16,
  flex: 1,
  minHeight: 0,
};

const hintStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--text-muted)",
  textAlign: "center",
  marginTop: 4,
};

const summaryStyle: React.CSSProperties = {
  padding: "0 16px 12px",
  borderTop: "1px solid var(--surface-bg)",
};

const summaryTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: 1,
  padding: "8px 0 4px",
};

const summaryRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: 12,
  padding: "2px 0",
  color: "var(--text-secondary)",
};

const legendStyle: React.CSSProperties = {
  padding: "0 16px 16px",
};
