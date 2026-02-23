import { useCallback, useEffect, useRef } from "react";
import { Position, type NodeProps } from "@xyflow/react";
import type { ToolpathGenResult, StockSettings } from "../types";
import LabeledHandle from "./LabeledHandle";
import type { PanelTab } from "../components/SidePanel";
import ToolpathPreviewPanel from "../components/ToolpathPreviewPanel";
import { useUpstreamData } from "../hooks/useUpstreamData";
import { StockBadge } from "../components/StockBadge";

export default function ToolpathPreviewNode({ id, data }: NodeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const openTab = (data as Record<string, unknown>).openTab as ((tab: PanelTab) => void) | undefined;

  // Subscribe to upstream ToolpathGenNode data
  const extractUpstream = useCallback((d: Record<string, unknown>) => ({
    toolpathResult: d.toolpathResult as ToolpathGenResult | undefined,
    stockSettings: d.stockSettings as StockSettings | undefined,
    activeStockId: (d.activeStockId as string) || "stock_1",
    allStockIds: (d.allStockIds as string[]) || [],
  }), []);
  const upstream = useUpstreamData(id, `${id}-in`, extractUpstream);
  const toolpathResult = upstream?.toolpathResult;

  const drawToolpath = useCallback(
    (canvas: HTMLCanvasElement, result: ToolpathGenResult) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Collect all points to compute bounds
      const allPoints: [number, number][] = [];
      for (const tp of result.toolpaths) {
        for (const pass of tp.passes) {
          for (const pt of pass.path) {
            allPoints.push(pt);
          }
        }
      }
      // Include origin and stock bounds in view
      if (result.stock_width && result.stock_depth) {
        allPoints.push([0, 0]);
        allPoints.push([result.stock_width, result.stock_depth]);
      } else {
        allPoints.push([0, 0]);
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
      const padding = 0.1;
      const scale = Math.min(
        w * (1 - 2 * padding) / rangeX,
        h * (1 - 2 * padding) / rangeY
      );
      const offsetX = (w - rangeX * scale) / 2;
      const offsetY = (h - rangeY * scale) / 2;

      const toCanvas = (x: number, y: number): [number, number] => [
        (x - minX) * scale + offsetX,
        h - ((y - minY) * scale + offsetY), // Flip Y
      ];

      // Draw each pass with Z-depth-based color
      const allZ = result.toolpaths.flatMap((tp) =>
        tp.passes.map((p) => p.z_depth)
      );
      const minZ = Math.min(...allZ);
      const maxZ = Math.max(...allZ);
      const zRange = maxZ - minZ || 1;

      // Stock bounds (thumbnail)
      if (result.stock_width && result.stock_depth) {
        const [sx0, sy0] = toCanvas(0, 0);
        const [sx1, sy1] = toCanvas(result.stock_width, result.stock_depth);
        ctx.strokeStyle = "#ddd";
        ctx.lineWidth = 0.5;
        ctx.setLineDash([3, 2]);
        ctx.strokeRect(sx0, sy1, sx1 - sx0, sy0 - sy1);
        ctx.setLineDash([]);
      }
      // Origin marker (thumbnail)
      const [ox, oy] = toCanvas(0, 0);
      ctx.fillStyle = "#e53935";
      ctx.beginPath();
      ctx.arc(ox, oy, 2, 0, Math.PI * 2);
      ctx.fill();

      for (const tp of result.toolpaths) {
        for (const pass of tp.passes) {
          const t = (pass.z_depth - minZ) / zRange;
          // Light (shallow) -> Dark (deep)
          const r = Math.round(0 + t * 0);
          const g = Math.round(188 - t * 120);
          const b = Math.round(212 - t * 100);
          ctx.strokeStyle = `rgb(${r},${g},${b})`;
          ctx.lineWidth = 1;
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
        }
      }
    },
    []
  );

  useEffect(() => {
    if (canvasRef.current && toolpathResult) {
      drawToolpath(canvasRef.current, toolpathResult);
    }
  }, [toolpathResult, drawToolpath]);

  const handleEnlarge = useCallback(() => {
    if (!toolpathResult || !openTab) return;
    openTab({
      id: `preview-${id}`,
      label: "Preview",
      icon: "\ud83d\udc41",
      content: <ToolpathPreviewPanel toolpathResult={toolpathResult} />,
    });
  }, [id, toolpathResult, openTab]);

  return (
    <div style={nodeStyle}>
      <LabeledHandle
        type="target"
        position={Position.Top}
        id={`${id}-in`}
        label="toolpath"
        dataType="toolpath"
      />

      <div style={headerStyle}>Toolpath Preview</div>

      {upstream && upstream.allStockIds.length > 1 && (
        <StockBadge
          activeStockId={upstream.activeStockId}
          totalStocks={upstream.allStockIds.length}
        />
      )}

      {toolpathResult ? (
        <div>
          <canvas
            ref={canvasRef}
            width={200}
            height={150}
            style={canvasStyle}
            onClick={handleEnlarge}
          />
          <div style={hintStyle}>Click to enlarge</div>
        </div>
      ) : (
        <div style={emptyStyle}>No data</div>
      )}
    </div>
  );
}

const nodeStyle: React.CSSProperties = {
  background: "white",
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: "20px 12px",
  width: 200,
  boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
};

const headerStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 13,
  marginBottom: 8,
  color: "#333",
};

const canvasStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid #eee",
  borderRadius: 4,
  cursor: "pointer",
  background: "#fafafa",
};

const hintStyle: React.CSSProperties = {
  fontSize: 10,
  color: "#aaa",
  textAlign: "center",
  marginTop: 2,
};

const emptyStyle: React.CSSProperties = {
  color: "#999",
  fontSize: 11,
};
