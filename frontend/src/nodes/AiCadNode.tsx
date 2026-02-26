import { useCallback, useEffect, useState } from "react";
import { Position, type NodeProps, useReactFlow } from "@xyflow/react";
import LabeledHandle from "./LabeledHandle";
import NodeShell from "../components/NodeShell";
import {
  generateAiCadStream,
  executeAiCadCode,
  fetchAiCadProfiles,
  fetchMeshData,
} from "../api";
import type { AiCadResult, AiCadRefineResult, ProfileInfo, ObjectMesh } from "../types";
import BrepImportPanel from "../components/BrepImportPanel";
import AiCadPanel from "../components/AiCadPanel";
import AiCadChatPanel from "../components/AiCadChatPanel";
import { usePanelTabs } from "../contexts/PanelTabsContext";

type Status = "idle" | "generating" | "success" | "error";

export default function AiCadNode({ id, selected }: NodeProps) {
  const { openTab } = usePanelTabs();
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<AiCadResult | null>(null);
  const [error, setError] = useState("");
  const [stage, setStage] = useState("");
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string>("general");
  const [meshes, setMeshes] = useState<ObjectMesh[]>([]);
  const { setNodes } = useReactFlow();

  // Load available profiles on mount
  useEffect(() => {
    fetchAiCadProfiles()
      .then((ps) => setProfiles(ps))
      .catch(() => {});
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    setStatus("generating");
    setError("");
    setStage("");
    try {
      const data = await generateAiCadStream(
        prompt,
        selectedProfile || undefined,
        (evt) => setStage(evt.message),
      );
      setResult(data);
      setStatus("success");
      setStage("");
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, brepResult: data } } : n,
        ),
      );
      try {
        const meshData = await fetchMeshData(data.file_id);
        setMeshes(meshData.objects);
      } catch {
        // non-critical
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
      setStatus("error");
      setStage("");
    }
  }, [id, prompt, selectedProfile, setNodes]);

  const handleCodeRerun = useCallback(
    async (code: string) => {
      setStatus("generating");
      setError("");
      try {
        const data = await executeAiCadCode(code);
        setResult(data);
        setStatus("success");
        setNodes((nds) =>
          nds.map((n) =>
            n.id === id ? { ...n, data: { ...n.data, brepResult: data } } : n,
          ),
        );
        try {
          const meshData = await fetchMeshData(data.file_id);
          setMeshes(meshData.objects);
        } catch {}
      } catch (e) {
        setError(e instanceof Error ? e.message : "Execution failed");
        setStatus("error");
      }
    },
    [id, setNodes],
  );

  const handleApplyRefinement = useCallback(
    async (refineResult: AiCadRefineResult) => {
      const updated: AiCadResult = {
        ...result!,
        file_id: refineResult.file_id,
        objects: refineResult.objects,
        object_count: refineResult.object_count,
        generated_code: refineResult.code,
      };
      setResult(updated);
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, brepResult: updated } } : n,
        ),
      );
      try {
        const meshData = await fetchMeshData(refineResult.file_id);
        setMeshes(meshData.objects);
      } catch {}
    },
    [id, result, setNodes],
  );

  const handleRefine = useCallback(() => {
    if (!result) return;
    openTab({
      id: `ai-cad-chat-${id}`,
      label: "Chat",
      icon: "💬",
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

  const handleView3D = useCallback(() => {
    if (!result) return;
    openTab({
      id: `ai-cad-3d-${id}`,
      label: "3D View",
      icon: "📦",
      content: <BrepImportPanel brepResult={result} meshes={meshes} />,
    });
  }, [id, result, meshes, openTab]);

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

  return (
    <NodeShell category="cad" selected={selected}>
      <div style={headerStyle}>AI CAD</div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe the part to generate..."
        style={textareaStyle}
        rows={3}
      />

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

      <button
        onClick={handleGenerate}
        disabled={status === "generating" || !prompt.trim()}
        style={{
          ...generateBtnStyle,
          opacity: status === "generating" || !prompt.trim() ? 0.5 : 1,
        }}
      >
        {status === "generating" ? "Generating..." : "Generate"}
      </button>

      {status === "generating" && stage && (
        <div style={{ fontSize: 11, color: "var(--text-secondary)", padding: "4px 0" }}>
          {stage}
        </div>
      )}

      {status === "error" && (
        <div style={{ color: "var(--color-error)", fontSize: 11, padding: "4px 0" }}>
          {error}
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
            {meshes.length > 0 && (
              <button onClick={handleView3D} style={viewBtnStyle}>
                View 3D
              </button>
            )}
            <button onClick={handleViewCode} style={viewBtnStyle}>
              View Code
            </button>
            <button onClick={handleRefine} style={viewBtnStyle}>
              Refine
            </button>
          </div>
        </div>
      )}

      <LabeledHandle
        type="source"
        position={Position.Bottom}
        id={`${id}-out`}
        label="out"
        dataType="geometry"
      />
    </NodeShell>
  );
}

const headerStyle: React.CSSProperties = {
  fontWeight: 700, fontSize: 13, marginBottom: 8, color: "var(--text-primary)",
};
const textareaStyle: React.CSSProperties = {
  width: "100%", border: "1px solid var(--border-color)", borderRadius: "var(--radius-control)",
  padding: "8px", fontSize: 12, resize: "vertical",
  fontFamily: "inherit", boxSizing: "border-box",
};
const selectStyle: React.CSSProperties = {
  width: "100%", padding: "4px 8px", border: "1px solid var(--border-color)",
  borderRadius: "var(--radius-control)", fontSize: 11, marginTop: 4,
  boxSizing: "border-box",
};
const generateBtnStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", border: "none", borderRadius: "var(--radius-control)",
  background: "var(--color-cad)", color: "white", cursor: "pointer",
  fontSize: 12, fontWeight: 600, marginTop: 6,
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
