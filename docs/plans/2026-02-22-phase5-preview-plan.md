# Phase 5: CNC Code + Toolpath Preview Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** ToolpathGenNodeの出力を CNC Code ノード（コード表示+エクスポート）と Toolpath Preview ノード（2Dパス可視化）の2つの専用ノードで表示する。

**Architecture:** ToolpathGenNodeの出力ハンドルを2つに分け、それぞれ CncCodeNode と ToolpathPreviewNode に接続する。各ノードはコンパクト表示 + サイドパネルで詳細表示。バックエンド変更は命名リファクタのみ、新エンドポイント不要。

**Tech Stack:** React + TypeScript, Canvas API (2D描画), 正規表現ベースのシンタックスハイライト

---

### Task 1: リファクタリング — SbpGenResult → OutputResult（バックエンド）

**Files:**
- Modify: `backend/schemas.py:226-236`
- Modify: `backend/main.py:16-22,188-199`
- Modify: `backend/sbp_writer.py` (変更なし、SbpWriter自体はそのまま)

**Step 1: schemas.py を更新**

`backend/schemas.py` の `SbpGenResult` を `OutputResult` にリネーム:

```python
class SbpGenResult(BaseModel):
    sbp_code: str
    filename: str
```
↓
```python
class OutputResult(BaseModel):
    code: str
    filename: str
    format: str  # "sbp" | "gcode" | ...
```

`SbpGenRequest` はそのまま維持（これはリクエスト用なので変えない）。

**Step 2: main.py を更新**

import の `SbpGenResult` → `OutputResult` に変更。
`generate_sbp_endpoint` のレスポンスモデルと戻り値を更新:

```python
@app.post("/api/generate-sbp", response_model=OutputResult)
def generate_sbp_endpoint(req: SbpGenRequest):
    ...
    return OutputResult(code=sbp_code, filename="output.sbp", format="sbp")
```

**Step 3: バックエンドテスト実行**

Run: `cd backend && uv run python -m pytest tests/ -v`
Expected: 全テスト PASS

**Step 4: コミット**

```bash
git add backend/schemas.py backend/main.py
git commit -m "Rename SbpGenResult to OutputResult for post-processor agnostic naming (#5)"
```

---

### Task 2: リファクタリング — SbpGenResult → OutputResult（フロントエンド）

**Files:**
- Modify: `frontend/src/types.ts:195-198`
- Modify: `frontend/src/api.ts:126-147`
- Modify: `frontend/src/nodes/ToolpathGenNode.tsx:3-11,19,112-128,136-145,204-208`

**Step 1: types.ts を更新**

```typescript
export interface SbpGenResult {
  sbp_code: string;
  filename: string;
}
```
↓
```typescript
export interface OutputResult {
  code: string;
  filename: string;
  format: string;
}
```

**Step 2: api.ts を更新**

`generateSbp` の戻り値型を `SbpGenResult` → `OutputResult` に変更:

```typescript
export async function generateSbp(
  ...
): Promise<OutputResult> {
```

import も更新。

**Step 3: ToolpathGenNode.tsx を更新**

- import: `SbpGenResult` → `OutputResult`
- state: `sbpResult` → `outputResult`, 型は `OutputResult`
- node.data キー: `sbpResult` → `outputResult`
- handleDownload: `sbpResult.sbp_code` → `outputResult.code`, `sbpResult.filename` → `outputResult.filename`
- ボタンテキスト: `"Download SBP"` → `"Export"`
- ToolpathGenNodeの source ハンドルを1つから2つに分割:
  - `${id}-toolpath` (toolpathResult用)
  - `${id}-output` (outputResult用)

**Step 4: フロントエンドビルド確認**

Run: `cd frontend && npx tsc --noEmit`
Expected: エラーなし

**Step 5: コミット**

```bash
git add frontend/src/types.ts frontend/src/api.ts frontend/src/nodes/ToolpathGenNode.tsx
git commit -m "Rename SbpGenResult to OutputResult in frontend (#5)"
```

---

### Task 3: CncCodeNode — ノードコンポーネント作成

**Files:**
- Create: `frontend/src/nodes/CncCodeNode.tsx`

**Step 1: CncCodeNode.tsx を作成**

ToolpathGenNodeの出力 `outputResult` を受け取り表示するノード。

```typescript
import { useState } from "react";
import { Position, type NodeProps, useReactFlow } from "@xyflow/react";
import type { OutputResult } from "../types";
import LabeledHandle from "./LabeledHandle";
import CncCodePanel from "../components/CncCodePanel";

export default function CncCodeNode({ id }: NodeProps) {
  const [showPanel, setShowPanel] = useState(false);
  const { getNode, getEdges } = useReactFlow();

  // Get output data from upstream ToolpathGenNode
  const edges = getEdges();
  const inputEdge = edges.find(
    (e) => e.target === id && e.targetHandle === `${id}-in`
  );
  const sourceNode = inputEdge ? getNode(inputEdge.source) : null;
  const outputResult = sourceNode?.data?.outputResult as OutputResult | undefined;

  const lineCount = outputResult ? outputResult.code.split("\n").length : 0;

  const handleExport = () => {
    if (!outputResult) return;
    const blob = new Blob([outputResult.code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = outputResult.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div style={nodeStyle}>
        <LabeledHandle
          type="target"
          position={Position.Top}
          id={`${id}-in`}
          label="output"
          dataType="toolpath"
        />

        <div style={headerStyle}>CNC Code</div>

        {outputResult ? (
          <div style={resultStyle}>
            <div style={fileInfoStyle}>
              {outputResult.format.toUpperCase()} · {lineCount} lines
            </div>
            <button onClick={handleExport} style={exportBtnStyle}>
              Export
            </button>
            <button onClick={() => setShowPanel(true)} style={viewBtnStyle}>
              View Code
            </button>
          </div>
        ) : (
          <div style={emptyStyle}>No data</div>
        )}
      </div>

      {showPanel && outputResult && (
        <CncCodePanel
          outputResult={outputResult}
          onExport={handleExport}
          onClose={() => setShowPanel(false)}
        />
      )}
    </>
  );
}

const nodeStyle: React.CSSProperties = {
  background: "white",
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: "20px 12px",
  minWidth: 200,
  maxWidth: 280,
  boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
};

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
```

**Step 2: ビルド確認**

Run: `cd frontend && npx tsc --noEmit`
Expected: CncCodePanel がまだないのでエラー（次タスクで作成）

**Step 3: コミット**

Task 4 完了後にまとめてコミット。

---

### Task 4: CncCodePanel — サイドパネル作成

**Files:**
- Create: `frontend/src/components/CncCodePanel.tsx`

**Step 1: CncCodePanel.tsx を作成**

SBPコードをシンタックスハイライト付きで表示するサイドパネル。
OperationDetailPanel と同じパネルパターンを踏襲。

```typescript
import type { OutputResult } from "../types";

interface Props {
  outputResult: OutputResult;
  onExport: () => void;
  onClose: () => void;
}

export default function CncCodePanel({ outputResult, onExport, onClose }: Props) {
  const lines = outputResult.code.split("\n");

  return (
    <div style={panelStyle}>
      <div style={panelHeaderStyle}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>
          CNC Code — {outputResult.filename}
        </span>
        <button onClick={onClose} style={closeBtnStyle}>×</button>
      </div>

      <div style={toolbarStyle}>
        <span style={{ fontSize: 11, color: "#666" }}>
          {outputResult.format.toUpperCase()} · {lines.length} lines
        </span>
        <button onClick={onExport} style={exportSmallBtnStyle}>Export</button>
      </div>

      <div style={codeAreaStyle}>
        <pre style={preStyle}>
          {lines.map((line, i) => (
            <div key={i} style={lineStyle}>
              <span style={lineNumStyle}>{i + 1}</span>
              <span>{highlightSbpLine(line)}</span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}

/** Simple regex-based SBP syntax highlighting */
function highlightSbpLine(line: string): React.ReactNode {
  // Comment lines
  if (line.startsWith("'")) {
    return <span style={{ color: "#999" }}>{line}</span>;
  }
  // Control flow: IF, THEN, GOTO, END, PAUSE
  if (/^(IF|THEN|GOTO|END|PAUSE|SA|CN)\b/.test(line)) {
    return <span style={{ color: "#7b61ff" }}>{line}</span>;
  }
  // Movement commands: M3, J2, JZ, MZ
  if (/^(M3|M2|J2|JZ|MZ),/.test(line)) {
    return highlightCommand(line);
  }
  // Speed/settings: MS, JS, TR, C6, C7, C9
  if (/^(MS|JS|TR|C[0-9]+|&Tool)\b/.test(line)) {
    return highlightCommand(line);
  }
  // Label lines (e.g., UNIT_ERROR:)
  if (/^[A-Z_]+:/.test(line)) {
    return <span style={{ color: "#7b61ff" }}>{line}</span>;
  }
  return <span>{line}</span>;
}

function highlightCommand(line: string): React.ReactNode {
  const parts = line.split(",");
  const cmd = parts[0];
  const args = parts.slice(1).join(",");
  return (
    <span>
      <span style={{ color: "#1976d2", fontWeight: 600 }}>{cmd}</span>
      {args && <span style={{ color: "#e65100" }}>,{args}</span>}
    </span>
  );
}

/* --- Styles --- */
const panelStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  right: 0,
  width: 420,
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

const toolbarStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 16px",
  borderBottom: "1px solid #f0f0f0",
};

const exportSmallBtnStyle: React.CSSProperties = {
  padding: "4px 12px",
  border: "1px solid #66bb6a",
  borderRadius: 4,
  background: "#66bb6a",
  color: "white",
  cursor: "pointer",
  fontSize: 11,
  fontWeight: 600,
};

const codeAreaStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "8px 0",
  background: "#fafafa",
};

const preStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: "'SF Mono', 'Fira Code', monospace",
  fontSize: 12,
  lineHeight: 1.6,
};

const lineStyle: React.CSSProperties = {
  display: "flex",
  padding: "0 16px",
};

const lineNumStyle: React.CSSProperties = {
  width: 36,
  textAlign: "right",
  color: "#bbb",
  marginRight: 12,
  userSelect: "none",
  flexShrink: 0,
};
```

**Step 2: ビルド確認**

Run: `cd frontend && npx tsc --noEmit`
Expected: エラーなし

**Step 3: コミット**

```bash
git add frontend/src/nodes/CncCodeNode.tsx frontend/src/components/CncCodePanel.tsx
git commit -m "Add CNC Code node with syntax-highlighted side panel (#5)"
```

---

### Task 5: ToolpathPreviewNode — ノードコンポーネント作成

**Files:**
- Create: `frontend/src/nodes/ToolpathPreviewNode.tsx`

**Step 1: ToolpathPreviewNode.tsx を作成**

Canvas にツールパスを描画するノード。

```typescript
import { useCallback, useEffect, useRef, useState } from "react";
import { Position, type NodeProps, useReactFlow } from "@xyflow/react";
import type { ToolpathGenResult } from "../types";
import LabeledHandle from "./LabeledHandle";
import ToolpathPreviewPanel from "../components/ToolpathPreviewPanel";

export default function ToolpathPreviewNode({ id }: NodeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showPanel, setShowPanel] = useState(false);
  const { getNode, getEdges } = useReactFlow();

  const edges = getEdges();
  const inputEdge = edges.find(
    (e) => e.target === id && e.targetHandle === `${id}-in`
  );
  const sourceNode = inputEdge ? getNode(inputEdge.source) : null;
  const toolpathResult = sourceNode?.data?.toolpathResult as ToolpathGenResult | undefined;

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

      for (const tp of result.toolpaths) {
        for (const pass of tp.passes) {
          const t = (pass.z_depth - minZ) / zRange;
          // Light (shallow) → Dark (deep)
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

  return (
    <>
      <div style={nodeStyle}>
        <LabeledHandle
          type="target"
          position={Position.Top}
          id={`${id}-in`}
          label="toolpath"
          dataType="toolpath"
        />

        <div style={headerStyle}>Toolpath Preview</div>

        {toolpathResult ? (
          <div>
            <canvas
              ref={canvasRef}
              width={200}
              height={150}
              style={canvasStyle}
              onClick={() => setShowPanel(true)}
            />
            <div style={hintStyle}>Click to enlarge</div>
          </div>
        ) : (
          <div style={emptyStyle}>No data</div>
        )}
      </div>

      {showPanel && toolpathResult && (
        <ToolpathPreviewPanel
          toolpathResult={toolpathResult}
          onClose={() => setShowPanel(false)}
        />
      )}
    </>
  );
}

const nodeStyle: React.CSSProperties = {
  background: "white",
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: "20px 12px",
  minWidth: 200,
  maxWidth: 280,
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
```

**Step 2: コミット**

Task 6 完了後にまとめてコミット。

---

### Task 6: ToolpathPreviewPanel — サイドパネル作成

**Files:**
- Create: `frontend/src/components/ToolpathPreviewPanel.tsx`

**Step 1: ToolpathPreviewPanel.tsx を作成**

大きな Canvas + パスサマリを表示するサイドパネル。

```typescript
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
```

**Step 2: ビルド確認**

Run: `cd frontend && npx tsc --noEmit`
Expected: エラーなし

**Step 3: コミット**

```bash
git add frontend/src/nodes/ToolpathPreviewNode.tsx frontend/src/components/ToolpathPreviewPanel.tsx
git commit -m "Add Toolpath Preview node with Canvas visualization and side panel (#5)"
```

---

### Task 7: App.tsx + Sidebar.tsx + ToolpathGenNode の統合

**Files:**
- Modify: `frontend/src/App.tsx:15-51`
- Modify: `frontend/src/Sidebar.tsx:1-8`
- Modify: `frontend/src/nodes/ToolpathGenNode.tsx` (source ハンドル更新)

**Step 1: App.tsx を更新**

import に CncCodeNode と ToolpathPreviewNode を追加。
nodeTypes に登録。
initialNodes のプレースホルダ Preview ノード (id: "7") を2つの実ノードに置き換え。
initialEdges に ToolpathGen → CncCode, ToolpathGen → ToolpathPreview のエッジを追加。

```typescript
// 追加 import
import CncCodeNode from "./nodes/CncCodeNode";
import ToolpathPreviewNode from "./nodes/ToolpathPreviewNode";

// nodeTypes に追加
const nodeTypes = {
  brepImport: BrepImportNode,
  stock: StockNode,
  operation: OperationNode,
  postProcessor: PostProcessorNode,
  toolpathGen: ToolpathGenNode,
  cncCode: CncCodeNode,
  toolpathPreview: ToolpathPreviewNode,
  debug: DebugNode,
};

// initialNodes: id "7" のプレースホルダを以下に置き換え
{ id: "7", type: "cncCode", position: { x: 150, y: 800 }, data: {} },
{ id: "8", type: "toolpathPreview", position: { x: 400, y: 800 }, data: {} },

// initialEdges: e6-7 を以下に置き換え
{ id: "e6-7", source: "6", sourceHandle: "6-output", target: "7", targetHandle: "7-in" },
{ id: "e6-8", source: "6", sourceHandle: "6-toolpath", target: "8", targetHandle: "8-in" },
```

**Step 2: Sidebar.tsx を更新**

nodeItems に追加:
```typescript
{ type: "cncCode", label: "CNC Code", color: "#66bb6a" },
{ type: "toolpathPreview", label: "Toolpath Preview", color: "#00bcd4" },
```

**Step 3: ToolpathGenNode.tsx — source ハンドルを2つに分割**

現在の `${id}-out` ハンドル1つを、以下の2つに変更:

```typescript
<LabeledHandle
  type="source"
  position={Position.Bottom}
  id={`${id}-toolpath`}
  label="toolpath"
  dataType="toolpath"
  index={0}
  total={2}
/>
<LabeledHandle
  type="source"
  position={Position.Bottom}
  id={`${id}-output`}
  label="output"
  dataType="toolpath"
  index={1}
  total={2}
/>
```

また、ToolpathGenNode 内のダウンロードボタン（`Download SBP`）を削除（CncCodeNode に移動済み）。

**Step 4: ビルド確認**

Run: `cd frontend && npx tsc --noEmit`
Expected: エラーなし

**Step 5: コミット**

```bash
git add frontend/src/App.tsx frontend/src/Sidebar.tsx frontend/src/nodes/ToolpathGenNode.tsx
git commit -m "Wire CNC Code and Toolpath Preview nodes into canvas (#5)"
```

---

### Task 8: 動作確認 + 最終調整

**Step 1: make dev で起動**

Run: `make dev`

**Step 2: 動作確認チェックリスト**

- [ ] STEP ファイルアップロード → Detect Operations → Generate → CNC Code ノードにデータが流れる
- [ ] CNC Code ノード: フォーマット・行数表示、Export ボタンでファイルダウンロード
- [ ] CNC Code ノード: View Code → サイドパネルにシンタックスハイライト付きコード表示
- [ ] Toolpath Preview ノード: Canvas にツールパス描画
- [ ] Toolpath Preview ノード: クリック → サイドパネルに拡大表示 + サマリ
- [ ] サイドにドラッグ可能なノードアイテム2つ追加
- [ ] ToolpathGenNode のダウンロードボタンが削除されている

**Step 3: 問題があれば修正してコミット**

**Step 4: 最終コミット**

```bash
git commit -m "Phase 5: CNC Code + Toolpath Preview nodes complete (#5)"
```
