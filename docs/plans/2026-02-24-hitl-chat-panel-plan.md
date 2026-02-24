# HITL Chat Panel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** AIノードの生成結果をチャット形式で対話的にリファインできるサイドパネルを追加する

**Architecture:** 既存の `generate_with_history()` と SSE ストリーミング基盤を活用。新規 `/ai-cad/refine` SSE エンドポイント + フロントエンドの `AiCadChatPanel` コンポーネント。バックエンドは Qwen 直接呼び出し（2段階パイプラインなし）で低レイテンシ。

**Tech Stack:** FastAPI SSE, AsyncOpenAI (generate_with_history), React, PanelTabs context

---

### Task 1: DB スキーマに conversation_history カラム追加

**Files:**
- Modify: `backend/db.py:11-25` (schema), `backend/db.py:46-70` (save_generation)
- Test: `backend/tests/test_db.py` (新規作成)

**Step 1: Write the failing test**

Create `backend/tests/test_db.py`:

```python
"""Tests for GenerationDB conversation history."""

import pytest
import pytest_asyncio
import tempfile
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from db import GenerationDB


@pytest_asyncio.fixture
async def db():
    with tempfile.NamedTemporaryFile(suffix=".db") as f:
        d = GenerationDB(f.name)
        await d.init()
        yield d
        await d.close()


@pytest.mark.asyncio
async def test_save_and_get_conversation_history(db):
    """Save a generation with conversation_history and retrieve it."""
    history = '[{"role":"user","content":"make a box"},{"role":"assistant","content":"done"}]'
    gen_id = await db.save_generation(
        prompt="test", code="result = Box(10,10,10)",
        result_json=None, model_used="test", status="success",
        conversation_history=history,
    )
    row = await db.get_generation(gen_id)
    assert row is not None
    assert row["conversation_history"] == history


@pytest.mark.asyncio
async def test_update_conversation_history(db):
    """Update conversation_history on existing generation."""
    gen_id = await db.save_generation(
        prompt="test", code="result = Box(10,10,10)",
        result_json=None, model_used="test", status="success",
    )
    new_history = '[{"role":"user","content":"round the edges"}]'
    await db.update_generation(gen_id, conversation_history=new_history)
    row = await db.get_generation(gen_id)
    assert row["conversation_history"] == new_history


@pytest.mark.asyncio
async def test_update_generation_code_and_result(db):
    """Update code and result_json on existing generation."""
    gen_id = await db.save_generation(
        prompt="test", code="old code",
        result_json='{"old": true}', model_used="test", status="success",
    )
    await db.update_generation(gen_id, code="new code", result_json='{"new": true}')
    row = await db.get_generation(gen_id)
    assert row["code"] == "new code"
    assert row["result_json"] == '{"new": true}'
```

**Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_db.py -v`
Expected: FAIL (conversation_history column missing, update_generation method missing)

**Step 3: Write minimal implementation**

Modify `backend/db.py`:

1. Add `conversation_history TEXT` to `_SCHEMA`
2. Add `conversation_history` parameter to `save_generation()`
3. Add `update_generation()` method

```python
# In _SCHEMA, add after `tags TEXT,`:
#     conversation_history TEXT,

# In save_generation(), add parameter:
#     conversation_history: str | None = None,
# And update INSERT to include it

# New method:
async def update_generation(
    self,
    gen_id: str,
    **fields,
) -> None:
    """Update fields on an existing generation record."""
    allowed = {"code", "result_json", "step_path", "status",
               "error_message", "tags", "conversation_history"}
    updates = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if not updates:
        return
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [gen_id]
    await self._conn.execute(
        f"UPDATE generations SET {set_clause} WHERE id = ?", values
    )
    await self._conn.commit()
```

**Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_db.py -v`
Expected: 3 PASS

**Step 5: Commit**

```bash
git add backend/db.py backend/tests/test_db.py
git commit -m "Add conversation_history column and update_generation method to DB"
```

---

### Task 2: Pydantic スキーマ追加 (AiCadRefineRequest, AiCadRefineResult)

**Files:**
- Modify: `backend/schemas.py:431-478`

**Step 1: Write the failing test**

Add to `backend/tests/test_api_ai_cad.py`:

```python
def test_refine_schema_validation():
    """POST /ai-cad/refine with missing fields returns 422."""
    resp = client.post("/ai-cad/refine", json={"message": "round edges"})
    assert resp.status_code == 422
```

**Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_api_ai_cad.py::test_refine_schema_validation -v`
Expected: FAIL (404, endpoint doesn't exist yet)

**Step 3: Write minimal implementation**

Add to end of `backend/schemas.py`:

```python
class ChatMessage(BaseModel):
    """A single message in a refinement conversation."""
    role: Literal["user", "assistant"]
    content: str


class AiCadRefineRequest(BaseModel):
    """Request to refine AI-generated code via chat."""
    generation_id: str
    message: str
    history: list[ChatMessage] = []
    current_code: str
    profile: str = "general"


class AiCadRefineResult(BaseModel):
    """Result from a refinement turn."""
    code: str
    objects: list[BrepObject]
    object_count: int
    file_id: str
    generation_id: str
    ai_message: str
```

Do NOT implement the endpoint yet (Task 3). Just add schemas.

**Step 4: Run existing tests to verify nothing is broken**

Run: `cd backend && uv run pytest tests/test_api_ai_cad.py -v`
Expected: all existing tests PASS

**Step 5: Commit**

```bash
git add backend/schemas.py
git commit -m "Add AiCadRefineRequest/Result schemas for HITL chat"
```

---

### Task 3: `/ai-cad/refine` SSE エンドポイント実装

**Files:**
- Modify: `backend/main.py:428-634` (add new endpoint)
- Modify: `backend/llm_client.py:326-349` (add refine method)
- Test: `backend/tests/test_api_ai_cad.py`

**Step 1: Write the failing test**

Add to `backend/tests/test_api_ai_cad.py`:

```python
from unittest.mock import AsyncMock, patch, MagicMock


def test_refine_endpoint_with_mock_llm():
    """POST /ai-cad/refine streams SSE events and returns refined result."""
    # First create a generation to refine
    resp = client.post("/ai-cad/execute", json={"code": "result = Box(100, 50, 10)"})
    assert resp.status_code == 200
    gen_id = resp.json()["generation_id"]
    original_code = resp.json()["generated_code"]

    # Mock LLM to return modified code
    mock_code = "result = Box(100, 50, 20)"  # changed height

    with patch("main._get_llm") as mock_get_llm:
        mock_llm = MagicMock()
        mock_llm.refine_code = AsyncMock(return_value=mock_code)
        mock_get_llm.return_value = mock_llm

        resp = client.post("/ai-cad/refine", json={
            "generation_id": gen_id,
            "message": "高さを20mmに変更",
            "history": [],
            "current_code": original_code,
        })

    assert resp.status_code == 200
    text = resp.text
    assert "event: stage" in text
    assert "event: result" in text or "event: error" in text


def test_refine_validates_generation_id():
    """POST /ai-cad/refine with bad generation_id returns error SSE."""
    resp = client.post("/ai-cad/refine", json={
        "generation_id": "nonexistent",
        "message": "round edges",
        "history": [],
        "current_code": "result = Box(10,10,10)",
    })
    assert resp.status_code == 200  # SSE always 200
    assert "event: error" in resp.text
```

**Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_api_ai_cad.py::test_refine_endpoint_with_mock_llm -v`
Expected: FAIL (endpoint doesn't exist)

**Step 3: Write minimal implementation**

3a. Add `refine_code()` method to `LLMClient` in `backend/llm_client.py`:

```python
# Add after generate_with_history() method (after line 349):

async def refine_code(
    self,
    current_code: str,
    message: str,
    history: list[dict],
    profile: str = "general",
) -> str:
    """Refine existing code based on user's modification instruction.

    Uses Qwen coder model directly (no design stage) for low latency.
    Returns modified Python code string.
    """
    coder_model = PIPELINE_MODELS["coder"]
    system = _build_system_prompt(profile, include_reference=False)

    # Build conversation: history + current code context + new instruction
    messages = list(history)
    messages.append({
        "role": "user",
        "content": (
            f"現在のコード:\n```python\n{current_code}\n```\n\n"
            f"修正指示: {message}\n\n"
            "修正後のコードのみを出力してください。"
        ),
    })

    full_messages = [{"role": "system", "content": system}] + messages

    response = await self._client.chat.completions.create(
        model=coder_model,
        messages=full_messages,
    )
    raw = response.choices[0].message.content or ""
    return _strip_code_fences(raw)
```

3b. Add `/ai-cad/refine` endpoint in `backend/main.py`:

```python
# Add import at top:
from schemas import (
    ...,  # existing imports
    AiCadRefineRequest, AiCadRefineResult, ChatMessage,
)

# Add new endpoint after /ai-cad/execute:

@app.post("/ai-cad/refine")
async def ai_cad_refine(req: AiCadRefineRequest):
    """Refine AI-generated code via chat instruction (SSE stream)."""
    db = await _get_db()
    llm = _get_llm()

    # Verify generation exists
    gen_row = await db.get_generation(req.generation_id)

    async def event_stream():
        if not gen_row:
            data = json.dumps({"message": "Generation not found"})
            yield f"event: error\ndata: {data}\n\n"
            return

        try:
            # Stage: refining
            yield f"event: stage\ndata: {json.dumps({'stage': 'refining', 'message': '修正中...'})}\n\n"

            # Build history for LLM
            llm_history = [
                {"role": m.role, "content": m.content}
                for m in req.history
            ]

            code = await llm.refine_code(
                current_code=req.current_code,
                message=req.message,
                history=llm_history,
                profile=req.profile,
            )

            # Stage: executing
            yield f"event: stage\ndata: {json.dumps({'stage': 'executing', 'message': '実行中...'})}\n\n"

            try:
                objects, step_bytes = execute_build123d_code(code)
            except CodeExecutionError as exec_err:
                # Auto-retry once with error feedback
                yield f"event: stage\ndata: {json.dumps({'stage': 'retrying', 'message': 'リトライ中...'})}\n\n"

                retry_history = llm_history + [
                    {"role": "assistant", "content": code},
                    {"role": "user", "content": f"エラーが発生しました:\n{exec_err}\n\n修正してください。"},
                ]
                code = await llm.refine_code(
                    current_code=code,
                    message=f"前回のエラー: {exec_err}\n修正してください。",
                    history=retry_history,
                    profile=req.profile,
                )

                yield f"event: stage\ndata: {json.dumps({'stage': 'executing', 'message': '実行中...'})}\n\n"
                objects, step_bytes = execute_build123d_code(code)

            # Save STEP + update DB
            file_id = f"ai-cad-{uuid.uuid4().hex[:8]}"
            brep_result = BrepImportResult(
                file_id=file_id, objects=objects, object_count=len(objects),
            )

            if step_bytes:
                gen_dir = GENERATIONS_DIR / file_id
                gen_dir.mkdir(exist_ok=True)
                (gen_dir / "model.step").write_bytes(step_bytes)
                (UPLOAD_DIR / f"{file_id}.step").write_bytes(step_bytes)

            # Update generation record
            new_history = [m.model_dump() for m in req.history] + [
                {"role": "user", "content": req.message},
                {"role": "assistant", "content": code},
            ]
            await db.update_generation(
                req.generation_id,
                code=code,
                result_json=brep_result.model_dump_json(),
                step_path=str(GENERATIONS_DIR / file_id / "model.step") if step_bytes else None,
                conversation_history=json.dumps(new_history),
            )

            result = AiCadRefineResult(
                code=code,
                objects=objects,
                object_count=len(objects),
                file_id=file_id,
                generation_id=req.generation_id,
                ai_message="修正を適用しました。",
            )
            yield f"event: result\ndata: {result.model_dump_json()}\n\n"

        except CodeExecutionError as e:
            yield f"event: error\ndata: {json.dumps({'message': f'コード実行エラー: {e}'})}\n\n"
        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'message': str(e)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
```

**Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_api_ai_cad.py -v`
Expected: all tests PASS (new + existing)

**Step 5: Run full test suite**

Run: `cd backend && uv run pytest tests/ -v`
Expected: all tests PASS

**Step 6: Commit**

```bash
git add backend/main.py backend/llm_client.py backend/tests/test_api_ai_cad.py
git commit -m "Add /ai-cad/refine SSE endpoint for HITL chat refinement"
```

---

### Task 4: フロントエンド — TypeScript 型定義追加

**Files:**
- Modify: `frontend/src/types.ts:257-293`

**Step 1: Add types**

Add to end of `frontend/src/types.ts`:

```typescript
/** AI CAD Chat / Refine types */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  code?: string;            // AI response code (for collapsible display)
  result?: AiCadRefineResult; // Execution result if available
}

export interface AiCadRefineResult {
  code: string;
  objects: BrepObject[];
  object_count: number;
  file_id: string;
  generation_id: string;
  ai_message: string;
}
```

**Step 2: Commit**

```bash
git add frontend/src/types.ts
git commit -m "Add ChatMessage and AiCadRefineResult frontend types"
```

---

### Task 5: フロントエンド — API 関数追加 (refineAiCadStream)

**Files:**
- Modify: `frontend/src/api.ts:238-336`

**Step 1: Add API function**

Add to `frontend/src/api.ts` after `generateAiCadStream`:

```typescript
import type {
  // ... existing imports ...
  ChatMessage,
  AiCadRefineResult,
  AiCadStageEvent,
} from "./types";

export async function refineAiCadStream(
  generationId: string,
  message: string,
  history: { role: string; content: string }[],
  currentCode: string,
  profile?: string,
  onStage?: (event: AiCadStageEvent) => void,
): Promise<AiCadRefineResult> {
  const response = await fetch(`${API_BASE_URL}/ai-cad/refine`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      generation_id: generationId,
      message,
      history,
      current_code: currentCode,
      profile,
    }),
  });

  if (!response.ok) {
    throw new Error(`Refine failed: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let result: AiCadRefineResult | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    let eventType = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        const data = JSON.parse(line.slice(6));
        if (eventType === "stage" && onStage) {
          onStage(data);
        } else if (eventType === "result") {
          result = data;
        } else if (eventType === "error") {
          throw new Error(data.message);
        }
        eventType = "";
      }
    }
  }

  if (!result) throw new Error("No result received");
  return result;
}
```

**Step 2: Commit**

```bash
git add frontend/src/api.ts frontend/src/types.ts
git commit -m "Add refineAiCadStream API function for HITL chat"
```

---

### Task 6: フロントエンド — AiCadChatPanel コンポーネント作成

**Files:**
- Create: `frontend/src/components/AiCadChatPanel.tsx`

**Step 1: Create the component**

Create `frontend/src/components/AiCadChatPanel.tsx`:

```typescript
import { useState, useRef, useEffect, useCallback } from "react";
import { refineAiCadStream } from "../api";
import type { ChatMessage, AiCadRefineResult, AiCadResult } from "../types";

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
            <div style={{ ...msgContent, color: "#888" }}>{stage}</div>
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
  marginBottom: 12, padding: "8px 12px", background: "#e3f2fd",
  borderRadius: 8, borderTopRightRadius: 2,
};
const aiMsgStyle: React.CSSProperties = {
  marginBottom: 12, padding: "8px 12px", background: "#f5f5f5",
  borderRadius: 8, borderTopLeftRadius: 2,
};
const roleLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: "#888", textTransform: "uppercase",
  letterSpacing: 1, marginBottom: 4,
};
const msgContent: React.CSSProperties = {
  fontSize: 13, lineHeight: 1.5, color: "#333", whiteSpace: "pre-wrap",
};
const codeBlockWrapper: React.CSSProperties = { marginTop: 8 };
const codeToggle: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  fontSize: 11, color: "#666", padding: 0,
};
const codePreStyle: React.CSSProperties = {
  background: "#1e1e1e", color: "#d4d4d4", padding: 12, borderRadius: 6,
  fontSize: 12, fontFamily: "'SF Mono', 'Fira Code', monospace",
  lineHeight: 1.4, margin: "8px 0 0", overflowX: "auto", whiteSpace: "pre-wrap",
};
const inputAreaStyle: React.CSSProperties = {
  display: "flex", gap: 8, padding: "8px 16px",
  borderTop: "1px solid #e0e0e0",
};
const inputStyle: React.CSSProperties = {
  flex: 1, padding: "8px 12px", border: "1px solid #ddd",
  borderRadius: 8, fontSize: 13, fontFamily: "inherit",
  resize: "none", boxSizing: "border-box",
};
const sendBtnStyle: React.CSSProperties = {
  padding: "8px 16px", border: "none", borderRadius: 8,
  background: "#e65100", color: "white", cursor: "pointer",
  fontSize: 12, fontWeight: 600, alignSelf: "flex-end",
};
const actionBarStyle: React.CSSProperties = {
  display: "flex", gap: 8, padding: "8px 16px",
  borderTop: "1px solid #e0e0e0",
};
const applyBtnStyle: React.CSSProperties = {
  flex: 1, padding: "8px 16px", border: "none", borderRadius: 8,
  background: "#2e7d32", color: "white", cursor: "pointer",
  fontSize: 12, fontWeight: 600,
};
```

**Step 2: Verify build**

Run: `cd frontend && npm run build`
Expected: no errors (component is not yet imported anywhere)

**Step 3: Commit**

```bash
git add frontend/src/components/AiCadChatPanel.tsx
git commit -m "Add AiCadChatPanel component for HITL chat refinement"
```

---

### Task 7: フロントエンド — AiCadNode に「Refine」ボタン + Chat タブ統合

**Files:**
- Modify: `frontend/src/nodes/AiCadNode.tsx:1-235`

**Step 1: Add Refine button and Chat tab integration**

Modify `frontend/src/nodes/AiCadNode.tsx`:

1. Import `AiCadChatPanel` and `fetchMeshData`
2. Add `handleRefine` callback that opens Chat tab via `openTab()`
3. Add callback `handleApplyRefinement` that updates node data + meshes
4. Add "Refine" button in the result section (next to View 3D / View Code)

Key changes:

```typescript
// Add import
import AiCadChatPanel from "../components/AiCadChatPanel";
import type { AiCadRefineResult } from "../types";

// Add handleApplyRefinement callback
const handleApplyRefinement = useCallback(
  async (refineResult: AiCadRefineResult) => {
    // Update node data with refined result
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
    // Refresh mesh
    try {
      const meshData = await fetchMeshData(refineResult.file_id);
      setMeshes(meshData.objects);
    } catch {}
  },
  [id, result, setNodes],
);

// Add handleRefine callback
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

// In the result section JSX, add Refine button:
// <button onClick={handleRefine} style={viewBtnStyle}>Refine</button>
```

Add the "Refine" button in the `<div style={{ display: "flex", gap: 4, marginTop: 8 }}>` section, after View Code.

**Step 2: Verify build**

Run: `cd frontend && npm run build`
Expected: no errors

**Step 3: Manual test**

Run: `make dev` (or `make front` + `make back`)
1. Open AI CAD node, generate a shape
2. Click "Refine" → Chat tab opens in side panel
3. Type a modification instruction → AI refines the code
4. Click "適用" → node updates with new result

**Step 4: Commit**

```bash
git add frontend/src/nodes/AiCadNode.tsx
git commit -m "Add Refine button to AiCadNode with Chat tab integration"
```

---

### Task 8: 全体テスト + 最終確認

**Files:**
- All files from Tasks 1-7

**Step 1: Run full backend test suite**

Run: `cd backend && uv run pytest tests/ -v`
Expected: all tests PASS

**Step 2: Run frontend build**

Run: `cd frontend && npm run build`
Expected: no errors

**Step 3: Commit any remaining changes**

```bash
git add -A
git commit -m "HITL Chat Panel: final polish and cleanup"
```

---

## Summary of files changed

| File | Action | Description |
|------|--------|-------------|
| `backend/db.py` | Modify | conversation_history column + update_generation() |
| `backend/schemas.py` | Modify | ChatMessage, AiCadRefineRequest, AiCadRefineResult |
| `backend/llm_client.py` | Modify | refine_code() method |
| `backend/main.py` | Modify | /ai-cad/refine SSE endpoint |
| `backend/tests/test_db.py` | Create | DB conversation history tests |
| `backend/tests/test_api_ai_cad.py` | Modify | Refine endpoint tests |
| `frontend/src/types.ts` | Modify | ChatMessage, AiCadRefineResult types |
| `frontend/src/api.ts` | Modify | refineAiCadStream() function |
| `frontend/src/components/AiCadChatPanel.tsx` | Create | Chat panel component |
| `frontend/src/nodes/AiCadNode.tsx` | Modify | Refine button + chat tab |
