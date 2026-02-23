import { useCallback, useEffect, useRef, useState } from "react";
import { Position, type NodeProps, useReactFlow } from "@xyflow/react";
import type {
  BrepImportResult,
  SheetSettings,
  PlacementItem,
} from "../types";
import { validatePlacement } from "../api";
import LabeledHandle from "./LabeledHandle";
import NodeShell from "../components/NodeShell";
import PlacementPanel from "../components/PlacementPanel";
import { usePanelTabs } from "../contexts/PanelTabsContext";
import { useUpstreamData } from "../hooks/useUpstreamData";

export default function PlacementNode({ id, selected }: NodeProps) {
  const { openTab, updateTab } = usePanelTabs();
  const [placements, setPlacements] = useState<PlacementItem[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [activeSheetId, setActiveSheetId] = useState("sheet_1");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { setNodes } = useReactFlow();

  // Subscribe to upstream nodes' data (re-renders when they change)
  const extractBrep = useCallback((d: Record<string, unknown>) => d.brepResult as BrepImportResult | undefined, []);
  const extractSheet = useCallback((d: Record<string, unknown>) => d.sheetSettings as SheetSettings | undefined, []);
  const brepResult = useUpstreamData(id, `${id}-brep`, extractBrep);
  const sheetSettings = useUpstreamData(id, `${id}-sheet`, extractSheet);

  const syncToNodeData = useCallback(
    (p: PlacementItem[], brep: BrepImportResult, sheet: SheetSettings, sheetId?: string) => {
      const sid = sheetId ?? activeSheetId;
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id
            ? {
                ...n,
                data: {
                  ...n.data,
                  placementResult: { placements: p, sheet, objects: brep.objects },
                  fileId: brep.file_id,
                  activeSheetId: sid,
                },
              }
            : n
        )
      );
    },
    [id, setNodes, activeSheetId]
  );

  // Auto-create placements when BREP data arrives
  useEffect(() => {
    if (!brepResult || !sheetSettings) return;
    if (placements.length > 0) return; // already initialized

    const defaultMtl = sheetSettings.materials[0]?.material_id ?? "mtl_1";
    const initial: PlacementItem[] = brepResult.objects.map((obj, i) => ({
      object_id: obj.object_id,
      material_id: defaultMtl,
      sheet_id: "sheet_1",
      x_offset: 10 + i * 20,
      y_offset: 10 + i * 20,
      rotation: 0,
    }));
    setPlacements(initial);
    syncToNodeData(initial, brepResult, sheetSettings);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brepResult, sheetSettings]);

  // Re-sync downstream when sheet settings change (after initial setup)
  useEffect(() => {
    if (brepResult && sheetSettings && placements.length > 0) {
      syncToNodeData(placements, brepResult, sheetSettings);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetSettings]);

  const handleActiveSheetChange = useCallback(
    (sheetId: string) => {
      setActiveSheetId(sheetId);
      if (brepResult && sheetSettings) {
        syncToNodeData(placements, brepResult, sheetSettings, sheetId);
      }
    },
    [brepResult, sheetSettings, placements, syncToNodeData]
  );

  const handlePlacementsChange = useCallback(
    async (updated: PlacementItem[]) => {
      setPlacements(updated);
      if (brepResult && sheetSettings) {
        syncToNodeData(updated, brepResult, sheetSettings);

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
          const result = await validatePlacement(updated, sheetSettings, bbs, outlines);
          setWarnings(result.warnings);
        } catch {
          // validation failure is non-critical
        }
      }
    },
    [brepResult, sheetSettings, syncToNodeData]
  );

  // Thumbnail draw
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sheetSettings || !brepResult) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const sheetMat = sheetSettings.materials[0];
    if (!sheetMat) return;

    const sc = Math.min((w - 20) / sheetMat.width, (h - 20) / sheetMat.depth);
    const ox = (w - sheetMat.width * sc) / 2;
    const oy = (h - sheetMat.depth * sc) / 2;

    // Sheet
    ctx.fillStyle = "#f0f0f0";
    ctx.fillRect(ox, h - oy - sheetMat.depth * sc, sheetMat.width * sc, sheetMat.depth * sc);
    ctx.strokeStyle = "#999";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(ox, h - oy - sheetMat.depth * sc, sheetMat.width * sc, sheetMat.depth * sc);

    // Filter placements by active sheet
    const activePlacements = placements.filter((p) => p.sheet_id === activeSheetId);
    const sheetIdList = [...new Set(placements.map((p) => p.sheet_id))].sort();

    // Parts (only active sheet)
    const colors = ["#4a90d9", "#7b61ff", "#43a047", "#ef5350"];
    for (let i = 0; i < activePlacements.length; i++) {
      const p = activePlacements[i];
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

    // Sheet indicator (top-right)
    if (sheetIdList.length > 1) {
      const sheetIndex = sheetIdList.indexOf(activeSheetId) + 1;
      const label = `${sheetIndex}/${sheetIdList.length}`;
      ctx.fillStyle = "#666";
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(label, w - 6, 12);
      ctx.textAlign = "left";
    }
  }, [placements, brepResult, sheetSettings, activeSheetId]);

  useEffect(() => { draw(); }, [draw]);

  const hasData = brepResult && sheetSettings;

  const handleOpenPanel = useCallback(() => {
    if (!hasData) return;
    openTab({
      id: `placement-${id}`,
      label: "Placement",
      icon: "📐",
      content: (
        <PlacementPanel
          objects={brepResult.objects}
          sheetSettings={sheetSettings}
          placements={placements}
          onPlacementsChange={handlePlacementsChange}
          warnings={warnings}
          activeSheetId={activeSheetId}
          onActiveSheetChange={handleActiveSheetChange}
        />
      ),
    });
  }, [id, hasData, brepResult, sheetSettings, placements, warnings, handlePlacementsChange, openTab, activeSheetId, handleActiveSheetChange]);

  // Update tab content when placements/warnings change (only if tab is already open)
  useEffect(() => {
    if (hasData) {
      updateTab({
        id: `placement-${id}`,
        label: "Placement",
        icon: "📐",
        content: (
          <PlacementPanel
            objects={brepResult.objects}
            sheetSettings={sheetSettings}
            placements={placements}
            onPlacementsChange={handlePlacementsChange}
            warnings={warnings}
            activeSheetId={activeSheetId}
            onActiveSheetChange={handleActiveSheetChange}
          />
        ),
      });
    }
  }, [id, hasData, brepResult, sheetSettings, placements, warnings, handlePlacementsChange, updateTab, activeSheetId, handleActiveSheetChange]);

  return (
    <NodeShell category="cam" selected={selected}>
      <LabeledHandle type="target" position={Position.Top} id={`${id}-brep`} label="brep" dataType="geometry" index={0} total={2} />
      <LabeledHandle type="target" position={Position.Top} id={`${id}-sheet`} label="sheet" dataType="settings" index={1} total={2} />

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
            {placements.filter((p) => p.sheet_id === activeSheetId).length} part{placements.filter((p) => p.sheet_id === activeSheetId).length > 1 ? "s" : ""} — Click to edit
          </div>
          {warnings.length > 0 && (
            <div style={{ color: "#e65100", fontSize: 10, padding: "4px 0" }}>
              {warnings.length} warning{warnings.length > 1 ? "s" : ""}
            </div>
          )}
        </>
      ) : (
        <div style={emptyStyle}>Connect BREP + Sheet</div>
      )}

      <LabeledHandle type="source" position={Position.Bottom} id={`${id}-out`} label="placement" dataType="geometry" />
    </NodeShell>
  );
}

const headerStyle: React.CSSProperties = { fontWeight: 700, fontSize: 13, marginBottom: 8, color: "#333" };
const canvasStyle: React.CSSProperties = { width: "100%", border: "1px solid #eee", borderRadius: 4, cursor: "pointer", background: "#fafafa" };
const hintStyle: React.CSSProperties = { fontSize: 10, color: "#aaa", textAlign: "center", marginTop: 2 };
const emptyStyle: React.CSSProperties = { color: "#999", fontSize: 11 };
