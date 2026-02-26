// frontend/src/components/CodeEditorPanel.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { EditorView, basicSetup } from "codemirror";
import { python } from "@codemirror/lang-python";
import { autocompletion } from "@codemirror/autocomplete";
import { build123dCompletionSource } from "../lib/build123dCompletions";
import { executeAiCadCode, saveSnippet } from "../api";
import type { AiCadResult } from "../types";

const DEFAULT_CODE = `from build123d import *

result = Box(100, 100, 10)
`;

interface Props {
  initialCode?: string;
  onResult: (result: AiCadResult) => void;
  onCodeChange?: (code: string) => void;
}

type RunStatus = "idle" | "running" | "success" | "error";

export default function CodeEditorPanel({ initialCode, onResult, onCodeChange }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [runError, setRunError] = useState("");
  const [lastResult, setLastResult] = useState<AiCadResult | null>(null);

  // Save dialog state
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveTags, setSaveTags] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // CodeMirrorの初期化
  useEffect(() => {
    if (!editorRef.current) return;

    const view = new EditorView({
      doc: initialCode ?? DEFAULT_CODE,
      extensions: [
        basicSetup,
        python(),
        autocompletion({ override: [build123dCompletionSource] }),
        EditorView.theme({
          "&": { height: "360px", fontSize: "12px" },
          ".cm-scroller": { overflow: "auto", fontFamily: "monospace" },
        }),
      ],
      parent: editorRef.current,
    });
    viewRef.current = view;

    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // initialCode が変化したら editor の内容を更新
  useEffect(() => {
    const view = viewRef.current;
    if (!view || initialCode === undefined) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== initialCode) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: initialCode },
      });
    }
  }, [initialCode]);

  const getCode = () => viewRef.current?.state.doc.toString() ?? "";

  const handleRun = useCallback(async () => {
    const code = getCode();
    if (!code.trim()) return;
    onCodeChange?.(code);
    setRunStatus("running");
    setRunError("");
    try {
      const result = await executeAiCadCode(code);
      setLastResult(result);
      setRunStatus("success");
      onResult(result);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Execution failed");
      setRunStatus("error");
    }
  }, [onResult, onCodeChange]);

  const handleSaveToLibrary = useCallback(async () => {
    if (!saveName.trim()) return;
    setSaveStatus("saving");
    try {
      await saveSnippet({
        name: saveName.trim(),
        tags: saveTags.split(",").map((t) => t.trim()).filter(Boolean),
        code: getCode(),
      });
      setSaveStatus("saved");
      setTimeout(() => {
        setSaveStatus("idle");
        setShowSaveDialog(false);
        setSaveName("");
        setSaveTags("");
      }, 1500);
    } catch {
      setSaveStatus("error");
    }
  }, [saveName, saveTags]);

  return (
    <div style={containerStyle}>
      {/* エディタ */}
      <div ref={editorRef} style={editorWrapStyle} />

      {/* ツールバー */}
      <div style={toolbarStyle}>
        <button
          onClick={handleRun}
          disabled={runStatus === "running"}
          style={{ ...runBtnStyle, opacity: runStatus === "running" ? 0.5 : 1 }}
        >
          {runStatus === "running" ? "Running..." : "▶ Run"}
        </button>
        <button
          onClick={() => setShowSaveDialog((v) => !v)}
          style={saveBtnStyle}
        >
          Save to Library
        </button>
      </div>

      {/* 実行結果 */}
      {runStatus === "success" && lastResult && (
        <div style={resultStyle}>
          ✅ {lastResult.object_count} object{lastResult.object_count > 1 ? "s" : ""} generated
          {lastResult.objects.map((obj) => (
            <div key={obj.object_id} style={objStyle}>
              {obj.bounding_box.x.toFixed(1)} × {obj.bounding_box.y.toFixed(1)} × {obj.bounding_box.z.toFixed(1)} mm
            </div>
          ))}
        </div>
      )}
      {runStatus === "error" && (
        <div style={errorStyle}>{runError}</div>
      )}

      {/* ライブラリ保存ダイアログ */}
      {showSaveDialog && (
        <div style={dialogStyle}>
          <input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="スニペット名"
            style={inputStyle}
          />
          <input
            value={saveTags}
            onChange={(e) => setSaveTags(e.target.value)}
            placeholder="タグ (カンマ区切り)"
            style={inputStyle}
          />
          <button
            onClick={handleSaveToLibrary}
            disabled={!saveName.trim() || saveStatus === "saving"}
            style={runBtnStyle}
          >
            {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved!" : "Save"}
          </button>
          {saveStatus === "error" && <div style={errorStyle}>保存に失敗しました</div>}
        </div>
      )}
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 8, padding: 12, height: "100%",
};
const editorWrapStyle: React.CSSProperties = {
  border: "1px solid var(--border-color)", borderRadius: "var(--radius-control)", overflow: "hidden", flex: 1,
};
const toolbarStyle: React.CSSProperties = {
  display: "flex", gap: 8,
};
const runBtnStyle: React.CSSProperties = {
  padding: "6px 16px", border: "none", borderRadius: "var(--radius-control)",
  background: "var(--color-cad)", color: "white", cursor: "pointer", fontSize: 12, fontWeight: 600,
};
const saveBtnStyle: React.CSSProperties = {
  padding: "6px 16px", border: "1px solid var(--border-color)", borderRadius: "var(--radius-control)",
  background: "var(--node-bg)", color: "var(--text-primary)", cursor: "pointer", fontSize: 12,
};
const resultStyle: React.CSSProperties = {
  fontSize: 12, color: "var(--color-success)", background: "#f1f8e9", padding: "6px 10px", borderRadius: "var(--radius-control)",
};
const objStyle: React.CSSProperties = {
  color: "var(--text-secondary)", marginTop: 2, fontSize: 11,
};
const errorStyle: React.CSSProperties = {
  fontSize: 11, color: "var(--color-error)", background: "#fff3f3", padding: "6px 10px", borderRadius: "var(--radius-control)",
  whiteSpace: "pre-wrap",
};
const dialogStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 6, padding: "8px 0",
  borderTop: "1px solid var(--border-subtle)",
};
const inputStyle: React.CSSProperties = {
  padding: "6px 10px", border: "1px solid var(--border-color)", borderRadius: "var(--radius-control)", fontSize: 12,
  background: "var(--surface-bg)", color: "var(--text-primary)",
};
