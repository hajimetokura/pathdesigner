import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Position, type NodeProps, useReactFlow, useStore } from "@xyflow/react";
import type {
  BrepImportResult,
  StockSettings,
  PlacementItem,
} from "../types";
import { validatePlacement } from "../api";
import LabeledHandle from "./LabeledHandle";
import type { PanelTab } from "../components/SidePanel";
import PlacementPanel from "../components/PlacementPanel";

export default function PlacementNode({ id, data }: NodeProps) {
  const openTab = (data as Record<string, unknown>).openTab as ((tab: PanelTab) => void) | undefined;
  const [placements, setPlacements] = useState<PlacementItem[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { setNodes } = useReactFlow();

  // Subscribe to upstream nodes' data via useStore (re-renders when they change)
  const brepSelector = useMemo(() => (s: { edges: { target: string; targetHandle?: string | null; source: string }[]; nodeLookup: Map<string, { data: Record<string, unknown> }> }) => {
    const edge = s.edges.find((e) => e.target === id && e.targetHandle === `${id}-brep`);
    if (!edge) return undefined;
    return s.nodeLookup.get(edge.source)?.data?.brepResult as BrepImportResult | undefined;
  }, [id]);
  const stockSelector = useMemo(() => (s: { edges: { target: string; targetHandle?: string | null; source: string }[]; nodeLookup: Map<string, { data: Record<string, unknown> }> }) => {
    const edge = s.edges.find((e) => e.target === id && e.targetHandle === `${id}-stock`);
    if (!edge) return undefined;
    return s.nodeLookup.get(edge.source)?.data?.stockSettings as StockSettings | undefined;
  }, [id]);
  const brepResult = useStore(brepSelector);
  const stockSettings = useStore(stockSelector);

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

        // Validate
        const bbs: Record<string, { x: number; y: number; z: number }> = {};
        for (const obj of brepResult.objects) {
          bbs[obj.object_id] = obj.bounding_box;
        }
        try {
          const result = await validatePlacement(updated, stockSettings, bbs);
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

      if (obj.outline && obj.outline.length > 2) {
        // Draw actual outline
        ctx.beginPath();
        const [x0, y0] = [ox + (p.x_offset + obj.outline[0][0]) * sc, h - oy - (p.y_offset + obj.outline[0][1]) * sc];
        ctx.moveTo(x0, y0);
        for (let j = 1; j < obj.outline.length; j++) {
          ctx.lineTo(ox + (p.x_offset + obj.outline[j][0]) * sc, h - oy - (p.y_offset + obj.outline[j][1]) * sc);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        // Fallback: bounding box rectangle
        const px = ox + p.x_offset * sc;
        const py = h - oy - (p.y_offset + obj.bounding_box.y) * sc;
        const pw = obj.bounding_box.x * sc;
        const ph = obj.bounding_box.y * sc;
        ctx.fillRect(px, py, pw, ph);
        ctx.strokeRect(px, py, pw, ph);
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

  // Update tab content when placements/warnings change
  useEffect(() => {
    if (hasData && openTab) {
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
    }
  }, [id, hasData, brepResult, stockSettings, placements, warnings, handlePlacementsChange, openTab]);

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
