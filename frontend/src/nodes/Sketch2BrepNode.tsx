import { useCallback, useEffect, useRef, useState } from "react";
import { type NodeProps, useReactFlow } from "@xyflow/react";
import LabeledHandle from "./LabeledHandle";
import NodeShell from "../components/NodeShell";
import { sketchToBrepStream } from "../api";
import type { AiCadResult, SketchData } from "../types";
import { useUpstreamData } from "../hooks/useUpstreamData";
import { usePanelTabs } from "../contexts/PanelTabsContext";

type Status = "idle" | "converting" | "done" | "error";

export default function Sketch2BrepNode({ id, selected }: NodeProps) {
  const { setNodes } = useReactFlow();
  const { openTab, updateTab } = usePanelTabs();
  const panelOpenRef = useRef(false);

  const extractSketch = useCallback(
    (d: Record<string, unknown>) => d.sketchData as SketchData | undefined,
    [],
  );
  const sketchData = useUpstreamData(id, `${id}-sketch`, extractSketch);

  const [status, setStatus] = useState<Status>("idle");
  const [stage, setStage] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AiCadResult | null>(null);
  const [profile, setProfile] = useState("sketch_cutout");

  const handleConvert = useCallback(async () => {
    if (!sketchData?.image_base64) return;
    setStatus("converting");
    setError(null);
    setStage("");
    try {
      const data = await sketchToBrepStream(
        sketchData.image_base64,
        "",
        profile,
        (evt) => setStage(evt.message),
      );
      setResult(data);
      setCode(data.generated_code);
      setStatus("done");
      setStage("");
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, brepResult: data } } : n,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Conversion failed");
      setStatus("error");
      setStage("");
    }
  }, [id, sketchData, profile, setNodes]);

  // Keep panel content in sync when state changes
  useEffect(() => {
    if (!panelOpenRef.current) return;
    updateTab({
      id: `sketch2brep-${id}`,
      label: "Sketch\u2192BREP",
      icon: "\u2728",
      content: (
        <Sketch2BrepPanel
          status={status}
          stage={stage}
          error={error}
          code={code}
          result={result}
        />
      ),
    });
  }, [id, status, stage, error, code, result, updateTab]);

  const handleOpenPanel = useCallback(() => {
    panelOpenRef.current = true;
    openTab({
      id: `sketch2brep-${id}`,
      label: "Sketch\u2192BREP",
      icon: "\u2728",
      content: (
        <Sketch2BrepPanel
          status={status}
          stage={stage}
          error={error}
          code={code}
          result={result}
        />
      ),
    });
  }, [id, status, stage, error, code, result, openTab]);

  const statusColor =
    status === "idle"
      ? "var(--text-secondary)"
      : status === "converting"
        ? "#1976d2"
        : status === "done"
          ? "#2e7d32"
          : "var(--color-error)";

  const hasSketch = !!sketchData?.image_base64;

  return (
    <NodeShell category="cad" selected={selected}>
      <LabeledHandle
        type="target"
        id={`${id}-sketch`}
        label="sketch"
        dataType="sketch"
      />

      <div style={headerStyle}>Sketch &rarr; BREP</div>

      <select
        value={profile}
        onChange={(e) => setProfile(e.target.value)}
        style={selectStyle}
      >
        <option value="sketch_cutout">板材切削</option>
        <option value="sketch_3d">立体物</option>
      </select>

      <button
        onClick={handleConvert}
        disabled={!hasSketch || status === "converting"}
        style={{
          ...convertBtnStyle,
          opacity: !hasSketch || status === "converting" ? 0.5 : 1,
        }}
      >
        {status === "converting" ? "Converting..." : "Convert"}
      </button>

      {status === "converting" && stage && (
        <div style={{ fontSize: 11, color: "#1976d2", padding: "4px 0" }}>
          {stage}
        </div>
      )}

      <div style={{ fontSize: 11, color: statusColor, padding: "2px 0" }}>
        {status === "idle" && (hasSketch ? "Ready" : "No sketch connected")}
        {status === "converting" && "Converting..."}
        {status === "done" &&
          result &&
          `${result.object_count} object${result.object_count > 1 ? "s" : ""}`}
        {status === "error" && error}
      </div>

      {(status === "done" || status === "error") && (
        <button onClick={handleOpenPanel} style={detailsBtnStyle}>
          Details
        </button>
      )}

      <LabeledHandle
        type="source"
        id={`${id}-brepResult`}
        label="brep"
        dataType="geometry"
      />
    </NodeShell>
  );
}

/* ---------- Panel component ---------- */

interface Sketch2BrepPanelProps {
  status: Status;
  stage: string;
  error: string | null;
  code: string | null;
  result: AiCadResult | null;
}

function Sketch2BrepPanel({
  status,
  stage,
  error,
  code,
  result,
}: Sketch2BrepPanelProps) {
  return (
    <div style={panelStyle}>
      <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Sketch&rarr;BREP</h3>

      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>
        {status === "converting" && (stage || "Converting...")}
        {status === "done" &&
          result &&
          `Done - ${result.object_count} object${result.object_count > 1 ? "s" : ""}`}
        {status === "error" && (
          <span style={{ color: "var(--color-error)" }}>{error}</span>
        )}
        {status === "idle" && "Idle"}
      </div>

      {code && (
        <details style={{ marginTop: 4 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
            Generated Code
          </summary>
          <pre style={codeStyle}>{code}</pre>
        </details>
      )}
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

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "4px 8px",
  border: "1px solid var(--border-color)",
  borderRadius: "var(--radius-control)",
  fontSize: 11,
  marginBottom: 6,
  boxSizing: "border-box",
  background: "var(--surface-bg)",
  color: "var(--text-primary)",
};

const convertBtnStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  border: "none",
  borderRadius: "var(--radius-control)",
  background: "var(--handle-sketch, #e91e63)",
  color: "white",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
  marginBottom: 4,
};

const detailsBtnStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 12px",
  border: "1px solid var(--border-color)",
  borderRadius: "var(--radius-control)",
  background: "var(--node-bg)",
  color: "var(--text-primary)",
  cursor: "pointer",
  fontSize: 11,
  marginTop: 4,
};

const panelStyle: React.CSSProperties = {
  padding: 12,
};

const codeStyle: React.CSSProperties = {
  background: "var(--surface-bg)",
  padding: 8,
  borderRadius: 4,
  fontSize: 11,
  overflow: "auto",
  maxHeight: 400,
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
};
