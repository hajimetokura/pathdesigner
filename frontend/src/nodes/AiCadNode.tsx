import { useCallback, useEffect, useRef, useState } from "react";
import { type NodeProps, useReactFlow } from "@xyflow/react";
import LabeledHandle from "./LabeledHandle";
import NodeShell from "../components/NodeShell";
import {
  generateAiCadStream,
  executeAiCadCode,
  fetchAiCadProfiles,
  fetchCoderModels,
  type SketchDetailEvent,
  type CoderModelInfo,
} from "../api";
import type {
  AiCadResult,
  AiCadRefineResult,
  ProfileInfo,
  SketchData,
  TextData,
} from "../types";
import AiCadPanel from "../components/AiCadPanel";
import AiCadChatPanel from "../components/AiCadChatPanel";
import { usePanelTabs } from "../contexts/PanelTabsContext";
import { useUpstreamData } from "../hooks/useUpstreamData";

type Status = "idle" | "generating" | "success" | "error";

export default function AiCadNode({ id, selected }: NodeProps) {
  const { setNodes } = useReactFlow();
  const { openTab, updateTab } = usePanelTabs();
  const panelOpenRef = useRef(false);

  // Upstream data
  const extractText = useCallback(
    (d: Record<string, unknown>) => d.textData as TextData | undefined,
    [],
  );
  const extractSketch = useCallback(
    (d: Record<string, unknown>) => d.sketchData as SketchData | undefined,
    [],
  );
  const textData = useUpstreamData(id, `${id}-text`, extractText);
  const sketchData = useUpstreamData(id, `${id}-sketch`, extractSketch);

  // State
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<AiCadResult | null>(null);
  const [error, setError] = useState("");
  const [stage, setStage] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string>("general");
  const [coderModel, setCoderModel] = useState("");
  const [coderModels, setCoderModels] = useState<CoderModelInfo[]>([]);
  const [details, setDetails] = useState<Record<string, string>>({});

  // Load profiles and coder models on mount
  useEffect(() => {
    fetchAiCadProfiles()
      .then((ps) => setProfiles(ps))
      .catch(() => {});
    fetchCoderModels()
      .then((models) => {
        setCoderModels(models);
        const def = models.find((m) => m.is_default);
        if (def) setCoderModel(def.id);
      })
      .catch(() => {});
  }, []);

  const hasInput = !!(textData?.prompt?.trim() || sketchData?.image_base64);

  const handleGenerate = useCallback(async () => {
    if (!hasInput) return;
    const prevError = error;
    const prevCode = code;
    const prevStatus = status;
    setStatus("generating");
    setError("");
    setStage("");
    setDetails({});

    // Build prompt — include retry context if previous attempt failed
    let prompt = textData?.prompt ?? "";
    if (prevError && prevCode && prevStatus === "error") {
      prompt +=
        `\n\n前回の生成コードでエラーが発生しました。同じ間違いを繰り返さないでください。\n` +
        `エラー: ${prevError}\n` +
        `失敗コード:\n\`\`\`python\n${prevCode}\n\`\`\``;
    }

    try {
      const data = await generateAiCadStream(
        prompt,
        selectedProfile || undefined,
        (evt) => setStage(evt.message),
        sketchData?.image_base64,
        coderModel || undefined,
        (evt: SketchDetailEvent) =>
          setDetails((prev) => ({ ...prev, [evt.key]: evt.value })),
      );
      setResult(data);
      setCode(data.generated_code);
      setStatus("success");
      setStage("");
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, brepResult: data } } : n,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
      setStatus("error");
      setStage("");
    }
  }, [id, hasInput, textData, sketchData, selectedProfile, coderModel, setNodes, error, code, status]);

  const handleCodeRerun = useCallback(
    async (rerunCode: string) => {
      setStatus("generating");
      setError("");
      try {
        const data = await executeAiCadCode(rerunCode);
        setResult(data);
        setCode(data.generated_code);
        setStatus("success");
        setNodes((nds) =>
          nds.map((n) =>
            n.id === id ? { ...n, data: { ...n.data, brepResult: data } } : n,
          ),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Execution failed");
        setStatus("error");
      }
    },
    [id, setNodes],
  );

  const handleApplyRefinement = useCallback(
    (refineResult: AiCadRefineResult) => {
      const updated: AiCadResult = {
        ...result!,
        file_id: refineResult.file_id,
        objects: refineResult.objects,
        object_count: refineResult.object_count,
        generated_code: refineResult.code,
      };
      setResult(updated);
      setCode(refineResult.code);
      setStatus("success");
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, brepResult: updated } } : n,
        ),
      );
    },
    [id, result, setNodes],
  );

  // Keep panel content in sync
  useEffect(() => {
    if (!panelOpenRef.current) return;
    updateTab({
      id: `ai-cad-details-${id}`,
      label: "AI CAD",
      icon: "\u2728",
      content: (
        <AiCadDetailsPanel
          status={status}
          stage={stage}
          error={error}
          code={code}
          result={result}
          details={details}
        />
      ),
    });
  }, [id, status, stage, error, code, result, details, updateTab]);

  const handleRefine = useCallback(() => {
    if (!result) return;
    openTab({
      id: `ai-cad-chat-${id}`,
      label: "Chat",
      icon: "\uD83D\uDCAC",
      content: (
        <AiCadChatPanel
          generationId={result.generation_id}
          initialCode={result.generated_code}
          initialPrompt={result.prompt_used}
          profile={selectedProfile}
          onApply={handleApplyRefinement}
        />
      ),
    });
  }, [id, result, selectedProfile, openTab, handleApplyRefinement]);

  const handleViewCode = useCallback(() => {
    if (!result) return;
    openTab({
      id: `ai-cad-code-${id}`,
      label: "Code",
      icon: "{}",
      content: (
        <AiCadPanel
          code={result.generated_code}
          prompt={result.prompt_used}
          model={result.model_used}
          onRerun={handleCodeRerun}
        />
      ),
    });
  }, [id, result, openTab, handleCodeRerun]);

  const handleOpenDetails = useCallback(() => {
    panelOpenRef.current = true;
    openTab({
      id: `ai-cad-details-${id}`,
      label: "AI CAD",
      icon: "\u2728",
      content: (
        <AiCadDetailsPanel
          status={status}
          stage={stage}
          error={error}
          code={code}
          result={result}
          details={details}
        />
      ),
    });
  }, [id, status, stage, error, code, result, details, openTab]);

  // Determine button label
  const buttonLabel =
    status === "generating"
      ? "Generating..."
      : status === "error"
        ? "Retry"
        : "Generate";

  return (
    <NodeShell category="cad" selected={selected}>
      <LabeledHandle
        type="target"
        id={`${id}-text`}
        label="text"
        dataType="generic"
        index={0}
        total={2}
      />
      <LabeledHandle
        type="target"
        id={`${id}-sketch`}
        label="sketch"
        dataType="sketch"
        index={1}
        total={2}
      />

      <div style={headerStyle}>AI CAD</div>

      {profiles.length > 1 && (
        <select
          value={selectedProfile}
          onChange={(e) => setSelectedProfile(e.target.value)}
          style={selectStyle}
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}

      {coderModels.length > 0 && (
        <select
          value={coderModel}
          onChange={(e) => setCoderModel(e.target.value)}
          style={selectStyle}
        >
          {coderModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}{m.is_default ? " \u2605" : ""}
            </option>
          ))}
        </select>
      )}

      <button
        onClick={handleGenerate}
        disabled={status === "generating" || !hasInput}
        style={{
          ...generateBtnStyle,
          opacity: status === "generating" || !hasInput ? 0.5 : 1,
        }}
      >
        {buttonLabel}
      </button>

      {status === "generating" && stage && (
        <div style={{ fontSize: 11, color: "var(--text-secondary)", padding: "4px 0" }}>
          {stage}
        </div>
      )}

      {!hasInput && status === "idle" && (
        <div style={{ fontSize: 11, color: "var(--text-secondary)", padding: "2px 0" }}>
          Connect text or sketch input
        </div>
      )}

      {status === "error" && (
        <div style={{ color: "var(--color-error)", fontSize: 11, padding: "4px 0" }}>
          {error && error.length > 60 ? error.slice(0, 60) + "\u2026" : error}
        </div>
      )}

      {status === "success" && result && (
        <div style={resultStyle}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {result.object_count} object{result.object_count > 1 ? "s" : ""}
          </div>
          {result.objects.map((obj) => (
            <div key={obj.object_id} style={objStyle}>
              <div style={{ fontSize: 11 }}>
                {obj.bounding_box.x.toFixed(1)} x {obj.bounding_box.y.toFixed(1)} x{" "}
                {obj.bounding_box.z.toFixed(1)} mm
              </div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
            <button onClick={handleViewCode} style={viewBtnStyle}>
              View Code
            </button>
            <button onClick={handleRefine} style={viewBtnStyle}>
              Refine
            </button>
            <button onClick={handleOpenDetails} style={viewBtnStyle}>
              Details
            </button>
          </div>
        </div>
      )}
      {status === "error" && (
        <button onClick={handleOpenDetails} style={{ ...viewBtnStyle, marginTop: 4 }}>
          Details
        </button>
      )}

      <LabeledHandle
        type="source"
        id={`${id}-out`}
        label="out"
        dataType="geometry"
      />
    </NodeShell>
  );
}

/* ---------- Details Panel (moved from Sketch2BrepNode) ---------- */

const DETAIL_LABELS: Record<string, string> = {
  design: "Gemini \u8A2D\u8A08",
  code: "Qwen \u751F\u6210\u30B3\u30FC\u30C9",
  reviewed_code: "\u30EC\u30D3\u30E5\u30FC\u5F8C\u30B3\u30FC\u30C9",
  execution_error: "\u5B9F\u884C\u30A8\u30E9\u30FC",
  retry_design: "\u30EA\u30C8\u30E9\u30A4\u8A2D\u8A08",
  retry_code: "\u30EA\u30C8\u30E9\u30A4\u30B3\u30FC\u30C9",
};

interface AiCadDetailsPanelProps {
  status: Status;
  stage: string;
  error: string;
  code: string | null;
  result: AiCadResult | null;
  details: Record<string, string>;
}

function AiCadDetailsPanel({
  status,
  stage,
  error,
  code,
  result,
  details,
}: AiCadDetailsPanelProps) {
  return (
    <div style={panelStyle}>
      <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>AI CAD Details</h3>

      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>
        {status === "generating" && (stage || "Generating...")}
        {status === "success" &&
          result &&
          `Done - ${result.object_count} object${result.object_count > 1 ? "s" : ""}`}
        {status === "error" && (
          <span style={{ color: "var(--color-error)" }}>{error}</span>
        )}
        {status === "idle" && "Idle"}
      </div>

      {Object.keys(details).length > 0 && (
        <div style={{ marginTop: 4 }}>
          {Object.entries(details).map(([key, value]) => (
            <details key={key} style={{ marginTop: 4 }} open={key === "execution_error"}>
              <summary style={{
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
                color: key === "execution_error" ? "var(--color-error)" : "var(--text-primary)",
              }}>
                {DETAIL_LABELS[key] ?? key}
              </summary>
              <pre style={codeBlockStyle}>{value}</pre>
            </details>
          ))}
        </div>
      )}

      {code && !details.code && (
        <details style={{ marginTop: 4 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
            Generated Code
          </summary>
          <pre style={codeBlockStyle}>{code}</pre>
        </details>
      )}
    </div>
  );
}

/* ---------- Styles ---------- */

const headerStyle: React.CSSProperties = {
  fontWeight: 700, fontSize: 13, marginBottom: 8, color: "var(--text-primary)",
};
const selectStyle: React.CSSProperties = {
  width: "100%", padding: "4px 8px", border: "1px solid var(--border-color)",
  borderRadius: "var(--radius-control)", fontSize: 11, marginBottom: 6,
  boxSizing: "border-box",
  background: "var(--surface-bg)", color: "var(--text-primary)",
};
const generateBtnStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", border: "none", borderRadius: "var(--radius-control)",
  background: "var(--color-cad)", color: "white", cursor: "pointer",
  fontSize: 12, fontWeight: 600, marginBottom: 4,
};
const resultStyle: React.CSSProperties = {
  marginTop: 8, fontSize: 12,
};
const objStyle: React.CSSProperties = {
  background: "var(--surface-bg)", borderRadius: "var(--radius-item)", padding: "4px 8px", marginTop: 4,
};
const viewBtnStyle: React.CSSProperties = {
  flex: 1, padding: "6px 12px", border: "1px solid var(--border-color)", borderRadius: "var(--radius-control)",
  background: "var(--node-bg)", color: "var(--text-primary)", cursor: "pointer", fontSize: 11,
};
const panelStyle: React.CSSProperties = {
  padding: 12,
};
const codeBlockStyle: React.CSSProperties = {
  background: "var(--surface-bg)", padding: 8, borderRadius: 4,
  fontSize: 11, overflow: "auto", maxHeight: 400,
  whiteSpace: "pre-wrap", wordBreak: "break-all",
};
