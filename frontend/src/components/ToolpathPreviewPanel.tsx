import { useCallback, useEffect, useRef } from "react";
import type { ToolpathGenResult } from "../types";

interface Props {
  toolpathResult: ToolpathGenResult;
  onClose: () => void;
}

export default function ToolpathPreviewPanel({ toolpathResult, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Calculate summary stats
  const stats = calcStats(toolpathResult);

  const draw = useCallback(
    (canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const allPoints: [number, number][] = [];
      for (const tp of toolpathResult.toolpaths) {
        for (const pass of tp.passes) {
          for (const pt of pass.path) {
            allPoints.push(pt);
          }
        }
      }
      if (allPoints.length === 0) return;

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
        w * (1 - 2 * padding) / rangeX,
        h * (1 - 2 * padding) / rangeY
      );
      const offsetX = (w - rangeX * scale) / 2;
      const offsetY = (h - rangeY * scale) / 2;

      const toCanvas = (x: number, y: number): [number, number] => [
        (x - minX) * scale + offsetX,
        h - ((y - minY) * scale + offsetY),
      ];

      const allZ = toolpathResult.toolpaths.flatMap((tp) =>
        tp.passes.map((p) => p.z_depth)
      );
      const minZ = Math.min(...allZ);
      const maxZ = Math.max(...allZ);
      const zRange = maxZ - minZ || 1;

      for (const tp of toolpathResult.toolpaths) {
        for (const pass of tp.passes) {
          const t = (pass.z_depth - minZ) / zRange;
          const r = Math.round(0 + t * 0);
          const g = Math.round(188 - t * 120);
          const b = Math.round(212 - t * 100);
          ctx.strokeStyle = `rgb(${r},${g},${b})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          const pts = pass.path;
          if (pts.length === 0) continue;
          const [sx, sy] = toCanvas(pts[0][0], pts[0][1]);
          ctx.moveTo(sx, sy);
          for (let i = 1; i < pts.length; i++) {
            const [px, py] = toCanvas(pts[i][0], pts[i][1]);
            ctx.lineTo(px, py);
          }
          ctx.stroke();

          // Draw tab markers on final pass
          if (pass.tabs.length > 0) {
            ctx.fillStyle = "#ff5722";
            for (const tab of pass.tabs) {
              const midIdx = Math.floor((tab.start_index + tab.end_index) / 2);
              if (midIdx < pts.length) {
                const [tx, ty] = toCanvas(pts[midIdx][0], pts[midIdx][1]);
                ctx.beginPath();
                ctx.arc(tx, ty, 4, 0, Math.PI * 2);
                ctx.fill();
              }
            }
          }
        }
      }
    },
    [toolpathResult]
  );

  useEffect(() => {
    if (canvasRef.current) {
      draw(canvasRef.current);
    }
  }, [draw]);

  return (
    <div style={panelStyle}>
      <div style={panelHeaderStyle}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>Toolpath Preview</span>
        <button onClick={onClose} style={closeBtnStyle}>×</button>
      </div>

      <div style={canvasWrapStyle}>
        <canvas
          ref={canvasRef}
          width={600}
          height={450}
          style={{ width: "100%", background: "#fafafa", borderRadius: 4 }}
        />
      </div>

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
      </div>

      <div style={legendStyle}>
        <div style={summaryTitle}>Depth legend</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
          <span style={{ width: 12, height: 12, background: "rgb(0,188,212)", borderRadius: 2, display: "inline-block" }} />
          <span>Shallow</span>
          <span style={{ width: 12, height: 12, background: "rgb(0,68,112)", borderRadius: 2, display: "inline-block" }} />
          <span>Deep</span>
          <span style={{ width: 12, height: 12, background: "#ff5722", borderRadius: "50%", display: "inline-block" }} />
          <span>Tab</span>
        </div>
      </div>
    </div>
  );
}

function calcStats(result: ToolpathGenResult) {
  let totalPasses = 0;
  let totalDistance = 0;
  let tabCount = 0;

  for (const tp of result.toolpaths) {
    for (const pass of tp.passes) {
      totalPasses++;
      tabCount += pass.tabs.length;
      const pts = pass.path;
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i][0] - pts[i - 1][0];
        const dy = pts[i][1] - pts[i - 1][1];
        totalDistance += Math.sqrt(dx * dx + dy * dy);
      }
    }
  }

  return {
    operationCount: result.toolpaths.length,
    totalPasses,
    totalDistance,
    tabCount,
  };
}

/* --- Styles --- */
const panelStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  right: 0,
  width: 480,
  height: "100vh",
  background: "white",
  borderLeft: "1px solid #ddd",
  boxShadow: "-4px 0 16px rgba(0,0,0,0.1)",
  zIndex: 100,
  display: "flex",
  flexDirection: "column",
};

const panelHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "12px 16px",
  borderBottom: "1px solid #eee",
};

const closeBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  fontSize: 16,
  cursor: "pointer",
  color: "#999",
  padding: "4px 8px",
};

const canvasWrapStyle: React.CSSProperties = {
  padding: 16,
  flex: 1,
  minHeight: 0,
};

const summaryStyle: React.CSSProperties = {
  padding: "0 16px 12px",
  borderTop: "1px solid #f0f0f0",
};

const summaryTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "#888",
  textTransform: "uppercase",
  letterSpacing: 1,
  padding: "8px 0 4px",
};

const summaryRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: 12,
  padding: "2px 0",
  color: "#555",
};

const legendStyle: React.CSSProperties = {
  padding: "0 16px 16px",
};
