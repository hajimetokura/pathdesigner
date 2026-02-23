import { useCallback, useState } from "react";
import { Position, type NodeProps } from "@xyflow/react";
import type {
  OutputResult,
  OperationAssignment,
  OperationDetectResult,
  SheetSettings,
  PostProcessorSettings,
  PlacementItem,
  BoundingBox,
} from "../types";
import type { PanelTab } from "../components/SidePanel";
import LabeledHandle from "./LabeledHandle";
import NodeShell from "../components/NodeShell";
import CncCodePanel from "../components/CncCodePanel";
import { useUpstreamData } from "../hooks/useUpstreamData";
import { generateSbpZip } from "../api";
import { SheetBadge } from "../components/SheetBadge";

interface UpstreamZipData {
  allSheetIds: string[];
  allPlacements: PlacementItem[];
  allAssignments: OperationAssignment[];
  detectedOperations: OperationDetectResult;
  objectOrigins: Record<string, [number, number]>;
  sheetSettings: SheetSettings;
  postProcessorSettings: PostProcessorSettings;
}

export default function CncCodeNode({ id, data, selected }: NodeProps) {
  const openTab = (data as Record<string, unknown>).openTab as ((tab: PanelTab) => void) | undefined;
  const [zipLoading, setZipLoading] = useState(false);

  // Subscribe to upstream ToolpathGenNode's outputResult
  const extractOutput = useCallback((d: Record<string, unknown>) => d.outputResult as OutputResult | undefined, []);
  const outputResult = useUpstreamData(id, `${id}-in`, extractOutput);

  // Subscribe to upstream data needed for ZIP download
  const extractZipData = useCallback((d: Record<string, unknown>): UpstreamZipData | undefined => {
    const allSheetIds = d.allSheetIds as string[] | undefined;
    const allPlacements = d.allPlacements as PlacementItem[] | undefined;
    const allAssignments = d.allAssignments as OperationAssignment[] | undefined;
    const detectedOperations = d.detectedOperations as OperationDetectResult | undefined;
    const objectOrigins = d.objectOrigins as Record<string, [number, number]> | undefined;
    const sheetSettings = d.sheetSettings as SheetSettings | undefined;
    const postProcessorSettings = d.postProcessorSettings as PostProcessorSettings | undefined;
    if (!allSheetIds || !allPlacements || !allAssignments || !detectedOperations || !sheetSettings || !postProcessorSettings) return undefined;
    return { allSheetIds, allPlacements, allAssignments, detectedOperations, objectOrigins: objectOrigins ?? {}, sheetSettings, postProcessorSettings };
  }, []);
  const zipData = useUpstreamData(id, `${id}-in`, extractZipData);

  // Subscribe to stock info for read-only indicator
  const extractSheetInfo = useCallback((d: Record<string, unknown>) => ({
    activeSheetId: (d.activeSheetId as string) || "sheet_1",
    allSheetIds: (d.allSheetIds as string[]) || [],
  }), []);
  const sheetInfo = useUpstreamData(id, `${id}-in`, extractSheetInfo);

  const lineCount = outputResult ? outputResult.code.split("\n").length : 0;
  const hasMultipleSheets = zipData && zipData.allSheetIds.length > 1;

  const handleExport = useCallback(() => {
    if (!outputResult) return;
    const blob = new Blob([outputResult.code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = outputResult.filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [outputResult]);

  const handleDownloadZip = useCallback(async () => {
    if (!zipData) return;
    setZipLoading(true);
    try {
      // Build bounding_boxes from detected operations
      const boundingBoxes: Record<string, BoundingBox> = {};
      for (const op of zipData.detectedOperations.operations) {
        if (!boundingBoxes[op.object_id]) {
          const contours = op.geometry.contours;
          if (contours.length > 0) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const c of contours) {
              for (const [x, y] of c.coords) {
                minX = Math.min(minX, x); minY = Math.min(minY, y);
                maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
              }
            }
            boundingBoxes[op.object_id] = { x: maxX - minX, y: maxY - minY, z: op.geometry.depth };
          }
        }
      }

      const blob = await generateSbpZip(
        zipData.allAssignments,
        zipData.detectedOperations,
        zipData.sheetSettings,
        zipData.allPlacements,
        zipData.objectOrigins,
        boundingBoxes,
        zipData.postProcessorSettings,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "pathdesigner_sheets.zip";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("ZIP download failed:", e);
    } finally {
      setZipLoading(false);
    }
  }, [zipData]);

  const handleViewCode = useCallback(() => {
    if (!outputResult || !openTab) return;
    openTab({
      id: `cnc-code-${id}`,
      label: "CNC Code",
      icon: "\ud83d\udcc4",
      content: <CncCodePanel outputResult={outputResult} onExport={handleExport} />,
    });
  }, [id, outputResult, handleExport, openTab]);


  return (
    <NodeShell category="cam" selected={selected}>
      <LabeledHandle
        type="target"
        position={Position.Top}
        id={`${id}-in`}
        label="output"
        dataType="toolpath"
      />

      <div style={headerStyle}>CNC Code</div>

      {sheetInfo && sheetInfo.allSheetIds.length > 1 && (
        <SheetBadge
          activeSheetId={sheetInfo.activeSheetId}
          totalSheets={sheetInfo.allSheetIds.length}
        />
      )}

      {outputResult ? (
        <div style={resultStyle}>
          <div style={fileInfoStyle}>
            {outputResult.format.toUpperCase()} · {lineCount} lines
          </div>
          <button onClick={handleExport} style={exportBtnStyle}>
            Export
          </button>
          {hasMultipleSheets && (
            <button onClick={handleDownloadZip} disabled={zipLoading} style={zipBtnStyle}>
              {zipLoading ? "Generating..." : `Download All (${zipData.allSheetIds.length} sheets) ZIP`}
            </button>
          )}
          <button onClick={handleViewCode} style={viewBtnStyle}>
            View Code
          </button>
        </div>
      ) : (
        <div style={emptyStyle}>No data</div>
      )}
    </NodeShell>
  );
}

const headerStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 13,
  marginBottom: 8,
  color: "#333",
};

const resultStyle: React.CSSProperties = {
  fontSize: 12,
};

const fileInfoStyle: React.CSSProperties = {
  color: "#666",
  marginBottom: 8,
};

const exportBtnStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  border: "1px solid #66bb6a",
  borderRadius: 6,
  background: "#66bb6a",
  color: "white",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
  marginBottom: 4,
};

const zipBtnStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  border: "1px solid #4a90d9",
  borderRadius: 6,
  background: "#4a90d9",
  color: "white",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
  marginBottom: 4,
};

const viewBtnStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 12px",
  border: "1px solid #ddd",
  borderRadius: 6,
  background: "white",
  color: "#333",
  cursor: "pointer",
  fontSize: 11,
};

const emptyStyle: React.CSSProperties = {
  color: "#999",
  fontSize: 11,
};
