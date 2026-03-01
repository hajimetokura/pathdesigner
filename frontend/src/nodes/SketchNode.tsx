import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type NodeProps, useReactFlow } from "@xyflow/react";
import LabeledHandle from "./LabeledHandle";
import NodeShell from "../components/NodeShell";
import SketchCanvas, {
  renderStrokes,
  type Stroke,
  type SketchData,
} from "../components/SketchCanvas";
import { usePanelTabs } from "../contexts/PanelTabsContext";

const CANVAS_W = 560;
const CANVAS_H = 400;
const THUMB_W = 140;
const THUMB_H = 93;

export default function SketchNode({ id, selected }: NodeProps) {
  const { setNodes, getNode } = useReactFlow();
  const { openTab, updateTab } = usePanelTabs();

  // Read strokes from node data
  const node = getNode(id);
  const sketchData = node?.data?.sketchData as SketchData | undefined;
  const strokes: Stroke[] = sketchData?.strokes ?? [];

  // Panel state
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [penColor, setPenColor] = useState("#000000");
  const [penWidth, setPenWidth] = useState(4);
  const panelOpenRef = useRef(false);

  // Generate thumbnail from strokes
  const thumbnail = useMemo(() => {
    if (strokes.length === 0) return null;
    const offscreen = document.createElement("canvas");
    offscreen.width = CANVAS_W;
    offscreen.height = CANVAS_H;
    const ctx = offscreen.getContext("2d");
    if (!ctx) return null;
    renderStrokes(ctx, strokes, CANVAS_W, CANVAS_H);

    // Scale down to thumbnail
    const thumbCanvas = document.createElement("canvas");
    thumbCanvas.width = THUMB_W;
    thumbCanvas.height = THUMB_H;
    const thumbCtx = thumbCanvas.getContext("2d");
    if (!thumbCtx) return null;
    thumbCtx.drawImage(offscreen, 0, 0, THUMB_W, THUMB_H);
    return thumbCanvas.toDataURL("image/png");
  }, [strokes]);

  // Save strokes + image to node data
  const handleStrokesChange = useCallback(
    (newStrokes: Stroke[]) => {
      // Generate image_base64 from the new strokes
      const offscreen = document.createElement("canvas");
      offscreen.width = CANVAS_W;
      offscreen.height = CANVAS_H;
      const ctx = offscreen.getContext("2d");
      let imageBase64 = "";
      if (ctx) {
        renderStrokes(ctx, newStrokes, CANVAS_W, CANVAS_H);
        imageBase64 = offscreen
          .toDataURL("image/png")
          .replace(/^data:image\/png;base64,/, "");
      }

      const newSketchData: SketchData = {
        image_base64: imageBase64,
        strokes: newStrokes,
        canvas_width: CANVAS_W,
        canvas_height: CANVAS_H,
      };

      setNodes((nds) =>
        nds.map((n) =>
          n.id === id
            ? { ...n, data: { ...n.data, sketchData: newSketchData } }
            : n,
        ),
      );
    },
    [id, setNodes],
  );

  const handleUndo = useCallback(() => {
    if (strokes.length === 0) return;
    handleStrokesChange(strokes.slice(0, -1));
  }, [strokes, handleStrokesChange]);

  const handleClear = useCallback(() => {
    handleStrokesChange([]);
  }, [handleStrokesChange]);

  // Build panel content
  const buildPanelContent = useCallback(
    (
      currentStrokes: Stroke[],
      currentTool: "pen" | "eraser",
      currentColor: string,
      currentWidth: number,
    ) => (
      <SketchPanel
        strokes={currentStrokes}
        onStrokesChange={handleStrokesChange}
        tool={currentTool}
        onToolChange={setTool}
        penColor={currentColor}
        onPenColorChange={setPenColor}
        penWidth={currentWidth}
        onPenWidthChange={setPenWidth}
        onUndo={handleUndo}
        onClear={handleClear}
      />
    ),
    [handleStrokesChange, handleUndo, handleClear],
  );

  // Update panel when state changes
  useEffect(() => {
    if (!panelOpenRef.current) return;
    updateTab({
      id: `sketch-canvas-${id}`,
      label: "Sketch",
      icon: "\u270F",
      content: buildPanelContent(strokes, tool, penColor, penWidth),
    });
  }, [id, strokes, tool, penColor, penWidth, updateTab, buildPanelContent]);

  const handleEditSketch = useCallback(() => {
    panelOpenRef.current = true;
    openTab({
      id: `sketch-canvas-${id}`,
      label: "Sketch",
      icon: "\u270F",
      content: buildPanelContent(strokes, tool, penColor, penWidth),
    });
  }, [id, strokes, tool, penColor, penWidth, openTab, buildPanelContent]);

  return (
    <NodeShell category="utility" selected={selected}>
      <div style={headerStyle}>Sketch</div>

      {thumbnail ? (
        <img
          src={thumbnail}
          width={THUMB_W}
          height={THUMB_H}
          alt="sketch thumbnail"
          style={thumbStyle}
        />
      ) : (
        <div style={placeholderStyle}>No sketch</div>
      )}

      <button onClick={handleEditSketch} style={editBtnStyle}>
        Edit Sketch
      </button>

      <div style={infoStyle}>
        {strokes.length} stroke{strokes.length !== 1 ? "s" : ""}
      </div>

      <LabeledHandle
        type="source"
        id={`${id}-sketch`}
        label="sketch"
        dataType="sketch"
      />
    </NodeShell>
  );
}

/* ---------- SketchPanel (panel content component) ---------- */

interface SketchPanelProps {
  strokes: Stroke[];
  onStrokesChange: (strokes: Stroke[]) => void;
  tool: "pen" | "eraser";
  onToolChange: (tool: "pen" | "eraser") => void;
  penColor: string;
  onPenColorChange: (color: string) => void;
  penWidth: number;
  onPenWidthChange: (width: number) => void;
  onUndo: () => void;
  onClear: () => void;
}

function SketchPanel({
  strokes,
  onStrokesChange,
  tool,
  onToolChange,
  penColor,
  onPenColorChange,
  penWidth,
  onPenWidthChange,
  onUndo,
  onClear,
}: SketchPanelProps) {
  return (
    <div style={panelStyle}>
      {/* Toolbar */}
      <div style={toolbarStyle}>
        <button
          onClick={() => onToolChange("pen")}
          style={{
            ...toolBtnStyle,
            background:
              tool === "pen" ? "var(--color-cad)" : "var(--surface-bg)",
            color: tool === "pen" ? "#fff" : "var(--text-primary)",
          }}
        >
          Pen
        </button>
        <button
          onClick={() => onToolChange("eraser")}
          style={{
            ...toolBtnStyle,
            background:
              tool === "eraser" ? "var(--color-cad)" : "var(--surface-bg)",
            color: tool === "eraser" ? "#fff" : "var(--text-primary)",
          }}
        >
          Eraser
        </button>

        <span style={separatorStyle} />

        <input
          type="color"
          value={penColor}
          onChange={(e) => onPenColorChange(e.target.value)}
          style={colorPickerStyle}
          title="Pen color"
        />

        <label style={sliderLabelStyle}>
          <span style={{ fontSize: 11 }}>Width</span>
          <input
            type="range"
            min={1}
            max={20}
            value={penWidth}
            onChange={(e) => onPenWidthChange(Number(e.target.value))}
            style={{ width: 60 }}
          />
          <span style={{ fontSize: 11, minWidth: 16, textAlign: "center" }}>
            {penWidth}
          </span>
        </label>

        <span style={separatorStyle} />

        <button onClick={onUndo} style={toolBtnStyle} title="Undo last stroke">
          Undo
        </button>
        <button onClick={onClear} style={toolBtnStyle} title="Clear all">
          Clear
        </button>
      </div>

      {/* Canvas */}
      <SketchCanvas
        width={CANVAS_W}
        height={CANVAS_H}
        strokes={strokes}
        onStrokesChange={onStrokesChange}
        penColor={penColor}
        penWidth={penWidth}
        tool={tool}
      />

      {/* Info */}
      <div style={panelInfoStyle}>
        {strokes.length} stroke{strokes.length !== 1 ? "s" : ""}
      </div>
    </div>
  );
}

/* ---------- Styles ---------- */

const headerStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 13,
  marginBottom: 8,
  color: "var(--text-primary)",
};

const thumbStyle: React.CSSProperties = {
  borderRadius: 4,
  border: "1px solid var(--border-color)",
  display: "block",
  marginBottom: 6,
};

const placeholderStyle: React.CSSProperties = {
  width: THUMB_W,
  height: THUMB_H,
  borderRadius: 4,
  border: "1px dashed var(--border-color)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 11,
  color: "var(--text-secondary)",
  marginBottom: 6,
};

const editBtnStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 12px",
  border: "1px solid var(--border-color)",
  borderRadius: "var(--radius-control)",
  background: "var(--node-bg)",
  color: "var(--text-primary)",
  cursor: "pointer",
  fontSize: 11,
  fontWeight: 600,
};

const infoStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--text-secondary)",
  marginTop: 4,
  textAlign: "center",
};

const panelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 12,
};

const toolbarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  flexWrap: "wrap",
};

const toolBtnStyle: React.CSSProperties = {
  padding: "4px 10px",
  border: "1px solid var(--border-color)",
  borderRadius: "var(--radius-control)",
  cursor: "pointer",
  fontSize: 11,
  fontWeight: 500,
};

const separatorStyle: React.CSSProperties = {
  width: 1,
  height: 20,
  background: "var(--border-color)",
};

const colorPickerStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  padding: 0,
  border: "1px solid var(--border-color)",
  borderRadius: 4,
  cursor: "pointer",
};

const sliderLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  color: "var(--text-primary)",
};

const panelInfoStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-secondary)",
};
