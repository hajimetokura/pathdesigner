import { useRef, useEffect, useCallback } from "react";
import getStroke from "perfect-freehand";

export interface Stroke {
  points: [number, number][];
  color: string;
  width: number;
  tool: "pen" | "eraser";
}

export interface SketchData {
  image_base64: string;
  strokes: Stroke[];
  canvas_width: number;
  canvas_height: number;
}

interface Props {
  width?: number;
  height?: number;
  strokes: Stroke[];
  onStrokesChange: (strokes: Stroke[]) => void;
  penColor?: string;
  penWidth?: number;
  tool?: "pen" | "eraser";
}

/** Convert perfect-freehand outline points to a Path2D for ctx.fill() */
function outlineToPath(outline: number[][]): Path2D {
  const path = new Path2D();
  if (outline.length < 2) return path;

  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) {
    path.lineTo(outline[i][0], outline[i][1]);
  }
  path.closePath();
  return path;
}

/** Render all strokes onto a canvas 2D context. Exported for reuse (e.g. thumbnails). */
export function renderStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);
  // White background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  for (const stroke of strokes) {
    const outline = getStroke(stroke.points, {
      size: stroke.width,
      thinning: 0.5,
      smoothing: 0.5,
      streamline: 0.5,
    });

    if (stroke.tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
    } else {
      ctx.globalCompositeOperation = "source-over";
    }

    ctx.fillStyle = stroke.tool === "eraser" ? "#000000" : stroke.color;
    ctx.fill(outlineToPath(outline));
  }

  // Reset composite operation
  ctx.globalCompositeOperation = "source-over";
}

export default function SketchCanvas({
  width = 600,
  height = 400,
  strokes,
  onStrokesChange,
  penColor = "#000000",
  penWidth = 4,
  tool = "pen",
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentPointsRef = useRef<[number, number][] | null>(null);

  // Redraw all strokes when strokes array changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    renderStrokes(ctx, strokes, width, height);
  }, [strokes, width, height]);

  // Draw the in-progress stroke on top of existing strokes
  const drawCurrentStroke = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pts = currentPointsRef.current;
    if (!pts || pts.length < 2) return;

    // Re-render all committed strokes first
    renderStrokes(ctx, strokes, width, height);

    // Draw in-progress stroke on top
    const outline = getStroke(pts, {
      size: penWidth,
      thinning: 0.5,
      smoothing: 0.5,
      streamline: 0.5,
    });

    if (tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
    } else {
      ctx.globalCompositeOperation = "source-over";
    }

    ctx.fillStyle = tool === "eraser" ? "#000000" : penColor;
    ctx.fill(outlineToPath(outline));
    ctx.globalCompositeOperation = "source-over";
  }, [strokes, width, height, penColor, penWidth, tool]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.setPointerCapture(e.pointerId);

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      currentPointsRef.current = [[x, y]];
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!currentPointsRef.current) return;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      currentPointsRef.current.push([x, y]);
      drawCurrentStroke();
    },
    [drawCurrentStroke],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (canvas) canvas.releasePointerCapture(e.pointerId);

      const pts = currentPointsRef.current;
      if (!pts || pts.length < 2) {
        currentPointsRef.current = null;
        return;
      }

      const newStroke: Stroke = {
        points: [...pts],
        color: penColor,
        width: penWidth,
        tool,
      };
      currentPointsRef.current = null;
      onStrokesChange([...strokes, newStroke]);
    },
    [strokes, onStrokesChange, penColor, penWidth, tool],
  );

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        border: "1px solid var(--border-color, #ddd)",
        borderRadius: 8,
        cursor: "crosshair",
        touchAction: "none",
      }}
    />
  );
}
