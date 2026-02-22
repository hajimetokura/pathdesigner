import { useCallback, useEffect, useRef, useState } from "react";
import { Position, type NodeProps, useReactFlow } from "@xyflow/react";
import type {
  BrepImportResult,
  StockSettings,
  PlacementItem,
} from "../types";
import { validatePlacement } from "../api";
import LabeledHandle from "./LabeledHandle";
import type { PanelTab } from "../components/SidePanel";
import PlacementPanel from "../components/PlacementPanel";
import { useUpstreamData } from "../hooks/useUpstreamData";

export default function PlacementNode({ id, data }: NodeProps) {
  const openTab = (data as Record<string, unknown>).openTab as ((tab: PanelTab) => void) | undefined;
  const updateTab = (data as Record<string, unknown>).updateTab as ((tab: PanelTab) => void) | undefined;
  const [placements, setPlacements] = useState<PlacementItem[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { setNodes } = useReactFlow();

  // Subscribe to upstream nodes' data (re-renders when they change)
  const extractBrep = useCallback((d: Record<string, unknown>) => d.brepResult as BrepImportResult | undefined, []);
  const extractStock = useCallback((d: Record<string, unknown>) => d.stockSettings as StockSettings | undefined, []);
  const brepResult = useUpstreamData(id, `${id}-brep`, extractBrep);
  const stockSettings = useUpstreamData(id, `${id}-stock`, extractStock);

  const syncToNodeData = useCallback(
    (p: PlacementItem[], brep: BrepImportResult, stock: StockSettings) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id
            ? {
                ...n,
                data: {
                  ...n.data,
                  placementResult: { placements: p, stock, objects: brep.objects },
                  fileId: brep.file_id,  // Pass file_id through for downstream
                },
              }
            : n
        )
      );
    },
    [id, setNodes]
  );

  // Auto-create placements when BREP data arrives
  useEffect(() => {
    if (!brepResult || !stockSettings) return;
    if (placements.length > 0) return; // already initialized

    const defaultMtl = stockSettings.materials[0]?.material_id ?? "mtl_1";
    const initial: PlacementItem[] = brepResult.objects.map((obj, i) => ({
      object_id: obj.object_id,
      material_id: defaultMtl,
      x_offset: 10 + i * 20,
      y_offset: 10 + i * 20,
      rotation: 0,
    }));
    setPlacements(initial);
    syncToNodeData(initial, brepResult, stockSettings);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brepResult, stockSettings]);

  // Re-sync downstream when stock settings change (after initial setup)
  useEffect(() => {
    if (brepResult && stockSettings && placements.length > 0) {
      syncToNodeData(placements, brepResult, stockSettings);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockSettings]);

  const handlePlacementsChange = useCallback(
    async (updated: PlacementItem[]) => {
      setPlacements(updated);
      if (brepResult && stockSettings) {
        syncToNodeData(updated, brepResult, stockSettings);

        // Validate (with outlines for collision detection)
        const bbs: Record<string, { x: number; y: number; z: number }> = {};
        const outlines: Record<string, number[][]> = {};
        for (const obj of brepResult.objects) {
          bbs[obj.object_id] = obj.bounding_box;
          if (obj.outline && obj.outline.length >= 3) {
            outlines[obj.object_id] = obj.outline;
          }
        }
        try {
          const result = await validatePlacement(updated, stockSettings, bbs, outlines);
          setWarnings(result.warnings);
        } catch {
          // validation failure is non-critical
        }
      }
    },
    [brepResult, stockSettings, syncToNodeData]
  );

  // Thumbnail draw
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !stockSettings || !brepResult) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const stock = stockSettings.materials[0];
    if (!stock) return;

    const sc = Math.min((w - 20) / stock.width, (h - 20) / stock.depth);
    const ox = (w - stock.width * sc) / 2;
    const oy = (h - stock.depth * sc) / 2;

    // Stock
    ctx.fillStyle = "#f0f0f0";
    ctx.fillRect(ox, h - oy - stock.depth * sc, stock.width * sc, stock.depth * sc);
    ctx.strokeStyle = "#999";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(ox, h - oy - stock.depth * sc, stock.width * sc, stock.depth * sc);

    // Parts
    const colors = ["#4a90d9", "#7b61ff", "#43a047", "#ef5350"];
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      const obj = brepResult.objects.find((o) => o.object_id === p.object_id);
      if (!obj) continue;

      ctx.fillStyle = `${colors[i % colors.length]}33`;
      ctx.strokeStyle = colors[i % colors.length];
      ctx.lineWidth = 1;

      const rot = p.rotation || 0;
      const bb = obj.bounding_box;
      const rcx = bb.x / 2;
      const rcy = bb.y / 2;

      const rp = (x: number, y: number): [number, number] => {
        if (rot === 0) return [x, y];
        const rad = (rot * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const dx = x - rcx;
        const dy = y - rcy;
        return [rcx + dx * cos - dy * sin, rcy + dx * sin + dy * cos];
      };

      if (obj.outline && obj.outline.length > 2) {
        // Draw rotated outline
        ctx.beginPath();
        const [rx0, ry0] = rp(obj.outline[0][0], obj.outline[0][1]);
        ctx.moveTo(ox + (p.x_offset + rx0) * sc, h - oy - (p.y_offset + ry0) * sc);
        for (let j = 1; j < obj.outline.length; j++) {
          const [rx, ry] = rp(obj.outline[j][0], obj.outline[j][1]);
          ctx.lineTo(ox + (p.x_offset + rx) * sc, h - oy - (p.y_offset + ry) * sc);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        // Fallback: rotated bounding box as polygon
        const corners: [number, number][] = [[0, 0], [bb.x, 0], [bb.x, bb.y], [0, bb.y]];
        ctx.beginPath();
        for (let j = 0; j < corners.length; j++) {
          const [rx, ry] = rp(corners[j][0], corners[j][1]);
          const cx = ox + (p.x_offset + rx) * sc;
          const cy = h - oy - (p.y_offset + ry) * sc;
          if (j === 0) ctx.moveTo(cx, cy);
          else ctx.lineTo(cx, cy);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
  }, [placements, brepResult, stockSettings]);

  useEffect(() => { draw(); }, [draw]);

  const hasData = brepResult && stockSettings;

  const handleOpenPanel = useCallback(() => {
    if (!hasData || !openTab) return;
    openTab({
      id: `placement-${id}`,
      label: "Placement",
      icon: "📐",
      content: (
        <PlacementPanel
          objects={brepResult.objects}
          stockSettings={stockSettings}
          placements={placements}
          onPlacementsChange={handlePlacementsChange}
          warnings={warnings}
        />
      ),
    });
  }, [id, hasData, brepResult, stockSettings, placements, warnings, handlePlacementsChange, openTab]);

  // Update tab content when placements/warnings change (only if tab is already open)
  useEffect(() => {
    if (hasData && updateTab) {
      updateTab({
        id: `placement-${id}`,
        label: "Placement",
        icon: "📐",
        content: (
          <PlacementPanel
            objects={brepResult.objects}
            stockSettings={stockSettings}
            placements={placements}
            onPlacementsChange={handlePlacementsChange}
            warnings={warnings}
          />
        ),
      });
    }
  }, [id, hasData, brepResult, stockSettings, placements, warnings, handlePlacementsChange, updateTab]);

  return (
    <div style={nodeStyle}>
      <LabeledHandle type="target" position={Position.Top} id={`${id}-brep`} label="brep" dataType="geometry" index={0} total={2} />
      <LabeledHandle type="target" position={Position.Top} id={`${id}-stock`} label="stock" dataType="settings" index={1} total={2} />

      <div style={headerStyle}>Placement</div>

      {hasData ? (
        <>
          <canvas
            ref={canvasRef}
            width={200}
            height={150}
            style={canvasStyle}
            onClick={handleOpenPanel}
          />
          <div style={hintStyle}>
            {placements.length} part{placements.length > 1 ? "s" : ""} — Click to edit
          </div>
          {warnings.length > 0 && (
            <div style={{ color: "#e65100", fontSize: 10, padding: "4px 0" }}>
              {warnings.length} warning{warnings.length > 1 ? "s" : ""}
            </div>
          )}
        </>
      ) : (
        <div style={emptyStyle}>Connect BREP + Stock</div>
      )}

      <LabeledHandle type="source" position={Position.Bottom} id={`${id}-out`} label="placement" dataType="geometry" />
    </div>
  );
}

const nodeStyle: React.CSSProperties = { background: "white", border: "1px solid #ddd", borderRadius: 8, padding: "20px 12px", width: 200, boxShadow: "0 2px 6px rgba(0,0,0,0.08)" };
const headerStyle: React.CSSProperties = { fontWeight: 700, fontSize: 13, marginBottom: 8, color: "#333" };
const canvasStyle: React.CSSProperties = { width: "100%", border: "1px solid #eee", borderRadius: 4, cursor: "pointer", background: "#fafafa" };
const hintStyle: React.CSSProperties = { fontSize: 10, color: "#aaa", textAlign: "center", marginTop: 2 };
const emptyStyle: React.CSSProperties = { color: "#999", fontSize: 11 };
