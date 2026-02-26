import { useState, useRef, useEffect, useCallback } from "react";
import { refineAiCadStream } from "../api";
import type { ChatMessage, AiCadRefineResult } from "../types";

interface Props {
  generationId: string;
  initialCode: string;
  initialPrompt: string;
  profile: string;
  onApply: (result: AiCadRefineResult) => void;
}

export default function AiCadChatPanel({
  generationId,
  initialCode,
  initialPrompt,
  profile,
  onApply,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: `「${initialPrompt}」を生成しました。`,
      code: initialCode,
    },
  ]);
  const [input, setInput] = useState("");
  const [isRefining, setIsRefining] = useState(false);
  const [stage, setStage] = useState("");
  const [currentCode, setCurrentCode] = useState(initialCode);
  const [latestResult, setLatestResult] = useState<AiCadRefineResult | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, stage]);

  const handleSend = useCallback(async () => {
    const msg = input.trim();
    if (!msg || isRefining) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: msg }]);
    setIsRefining(true);
    setStage("");

    try {
      // Build history for API (just role + content)
      const history = messages.map((m) => ({
        role: m.role,
        content: m.code ? `${m.content}\n\nコード:\n${m.code}` : m.content,
      }));

      const result = await refineAiCadStream(
        generationId,
        msg,
        history,
        currentCode,
        profile,
        (evt) => setStage(evt.message),
      );

      setCurrentCode(result.code);
      setLatestResult(result);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.ai_message,
          code: result.code,
          result,
        },
      ]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `エラー: ${e instanceof Error ? e.message : "修正に失敗しました"}`,
        },
      ]);
    } finally {
      setIsRefining(false);
      setStage("");
    }
  }, [input, isRefining, messages, currentCode, generationId, profile]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleApply = () => {
    if (latestResult) onApply(latestResult);
  };

  return (
    <div style={panelStyle}>
      {/* Chat history */}
      <div ref={scrollRef} style={historyStyle}>
        {messages.map((msg, i) => (
          <div key={i} style={msg.role === "user" ? userMsgStyle : aiMsgStyle}>
            <div style={roleLabel}>
              {msg.role === "user" ? "You" : "AI"}
            </div>
            <div style={msgContent}>{msg.content}</div>
            {msg.code && <CodeBlock code={msg.code} />}
          </div>
        ))}
        {isRefining && stage && (
          <div style={aiMsgStyle}>
            <div style={roleLabel}>AI</div>
            <div style={{ ...msgContent, color: "var(--text-muted)" }}>{stage}</div>
          </div>
        )}
      </div>

      {/* Input area */}
      <div style={inputAreaStyle}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="修正指示を入力... (Enter で送信)"
          style={inputStyle}
          rows={2}
          disabled={isRefining}
        />
        <button
          onClick={handleSend}
          disabled={isRefining || !input.trim()}
          style={{
            ...sendBtnStyle,
            opacity: isRefining || !input.trim() ? 0.5 : 1,
          }}
        >
          送信
        </button>
      </div>

      {/* Action bar */}
      <div style={actionBarStyle}>
        <button
          onClick={handleApply}
          disabled={!latestResult}
          style={{
            ...applyBtnStyle,
            opacity: latestResult ? 1 : 0.5,
          }}
        >
          適用
        </button>
      </div>
    </div>
  );
}

function CodeBlock({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={codeBlockWrapper}>
      <button onClick={() => setOpen(!open)} style={codeToggle}>
        {open ? "▼ コードを隠す" : "▶ コードを表示"}
      </button>
      {open && <pre style={codePreStyle}>{code}</pre>}
    </div>
  );
}

// --- Styles ---

const panelStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", height: "100%", overflow: "hidden",
};
const historyStyle: React.CSSProperties = {
  flex: 1, overflowY: "auto", padding: "12px 16px",
};
const userMsgStyle: React.CSSProperties = {
  marginBottom: 12, padding: "8px 12px", background: "var(--surface-bg)",
  borderRadius: 8, borderTopRightRadius: 2,
};
const aiMsgStyle: React.CSSProperties = {
  marginBottom: 12, padding: "8px 12px", background: "var(--surface-bg)",
  borderRadius: 8, borderTopLeftRadius: 2,
};
const roleLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase",
  letterSpacing: 1, marginBottom: 4,
};
const msgContent: React.CSSProperties = {
  fontSize: 13, lineHeight: 1.5, color: "var(--text-primary)", whiteSpace: "pre-wrap",
};
const codeBlockWrapper: React.CSSProperties = { marginTop: 8 };
const codeToggle: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  fontSize: 11, color: "var(--text-secondary)", padding: 0,
};
const codePreStyle: React.CSSProperties = {
  background: "#1e1e1e", color: "#d4d4d4", padding: 12, borderRadius: "var(--radius-control)",
  fontSize: 12, fontFamily: "'SF Mono', 'Fira Code', monospace",
  lineHeight: 1.4, margin: "8px 0 0", overflowX: "auto", whiteSpace: "pre-wrap",
};
const inputAreaStyle: React.CSSProperties = {
  display: "flex", gap: 8, padding: "8px 16px",
  borderTop: "1px solid var(--border-subtle)",
};
const inputStyle: React.CSSProperties = {
  flex: 1, padding: "8px 12px", border: "1px solid var(--border-color)",
  borderRadius: 8, fontSize: 13, fontFamily: "inherit",
  resize: "none", boxSizing: "border-box",
  background: "var(--surface-bg)", color: "var(--text-primary)",
};
const sendBtnStyle: React.CSSProperties = {
  padding: "8px 16px", border: "none", borderRadius: 8,
  background: "var(--color-cad)", color: "white", cursor: "pointer",
  fontSize: 12, fontWeight: 600, alignSelf: "flex-end",
};
const actionBarStyle: React.CSSProperties = {
  display: "flex", gap: 8, padding: "8px 16px",
  borderTop: "1px solid var(--border-subtle)",
};
const applyBtnStyle: React.CSSProperties = {
  flex: 1, padding: "8px 16px", border: "none", borderRadius: 8,
  background: "var(--color-success)", color: "white", cursor: "pointer",
  fontSize: 12, fontWeight: 600,
};
