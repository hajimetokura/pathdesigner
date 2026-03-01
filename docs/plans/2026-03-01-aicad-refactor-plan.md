# AiCad ノード統合リファクタリング 実装計画

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** AiCadNode と Sketch2BrepNode の重複を解消し、TextNode + SketchNode + 統合AiCadNode の3ノード構成にリファクタリングする。

**Architecture:** 入力ノード（TextNode, SketchNode）と変換ノード（AiCadNode）を分離。バックエンドは `/ai-cad/generate` に統合し `/api/sketch-to-brep` を廃止。フロントエンドはSSE解析を共通ユーティリティに抽出。

**Tech Stack:** React + TypeScript, FastAPI + Python, SSE streaming, React Flow

**Design doc:** `docs/plans/2026-03-01-aicad-refactor-design.md`

---

## Task 1: バックエンド — AiCadRequest スキーマ拡張

**Files:**
- Modify: `backend/schemas.py:450-455`

**Step 1: AiCadRequest に coder_model フィールドを追加**

`backend/schemas.py` の `AiCadRequest` クラスを修正:

```python
class AiCadRequest(BaseModel):
    """Request to generate a 3D model from text/image prompt."""
    prompt: str
    image_base64: str | None = None
    model: str | None = None  # OpenRouter model ID; None = use default
    profile: str = "general"
    coder_model: str | None = None  # Override coder model for pipeline
```

**Step 2: SketchToBrepRequest を削除**

`backend/schemas.py` の524-529行を削除:

```python
# DELETE these lines:
class SketchToBrepRequest(BaseModel):
    """Request to convert a hand-drawn sketch image to a 3D BREP model."""
    image_base64: str
    prompt: str = ""
    profile: str = "sketch_cutout"
    coder_model: str | None = None
```

**Step 3: コミット**

```bash
git add backend/schemas.py
git commit -m "refactor: add coder_model to AiCadRequest, remove SketchToBrepRequest"
```

---

## Task 2: バックエンド — エンドポイント統合

**Files:**
- Modify: `backend/main.py:550-642` (ai_cad_generate を拡張)
- Modify: `backend/main.py:857-970` (sketch_to_brep を削除)

**Step 1: `/ai-cad/generate` を拡張**

`backend/main.py` の `ai_cad_generate` 関数を以下に置き換える。変更点:
- `coder_model` と `on_detail` を `generate_pipeline` に渡す
- `image_base64` がある場合はスケッチプリアンブルを自動付与
- `detail` SSEイベントを追加
- `file_id` プレフィックスを入力に応じて変更

```python
_SKETCH_PREAMBLE = (
    "以下はユーザーの手描きスケッチ画像です。"
    "この形状を忠実にbuild123dコードに変換してください。"
)


@app.post("/ai-cad/generate")
async def ai_cad_generate(req: AiCadRequest):
    """Generate 3D model from text/image prompt via LLM pipeline (SSE stream)."""
    llm = _get_llm()

    async def event_stream():
        # Build prompt — auto-prepend sketch preamble when image is present
        full_prompt = req.prompt
        if req.image_base64:
            full_prompt = _SKETCH_PREAMBLE
            if req.prompt:
                full_prompt += f"\n\nユーザーの補足: {req.prompt}"

        # Validate: need either prompt text or image
        if not full_prompt.strip() and not req.image_base64:
            data = json.dumps({"message": "prompt or image_base64 is required"})
            yield f"event: error\ndata: {data}\n\n"
            return

        event_queue: asyncio.Queue[tuple[str, str, str] | None] = asyncio.Queue()

        async def queue_stage(stage: str):
            messages = {
                "designing": "設計中...",
                "coding": "コーディング中...",
                "reviewing": "レビュー中...",
                "executing": "実行中...",
                "retrying": "リトライ中...",
            }
            await event_queue.put(("stage", stage, messages.get(stage, stage)))

        async def queue_detail(key: str, value: str):
            await event_queue.put(("detail", key, value))

        result_holder: dict = {}

        async def run_pipeline():
            try:
                code, objects, step_bytes = await llm.generate_pipeline(
                    full_prompt,
                    image_base64=req.image_base64,
                    profile=req.profile,
                    coder_model=req.coder_model,
                    on_stage=queue_stage,
                    on_detail=queue_detail,
                )
                result_holder["code"] = code
                result_holder["objects"] = objects
                result_holder["step_bytes"] = step_bytes
            except Exception as e:
                result_holder["error"] = str(e)
            finally:
                await event_queue.put(None)  # sentinel

        task = asyncio.create_task(run_pipeline())

        while True:
            event = await event_queue.get()
            if event is None:
                break
            event_type, key, value = event
            if event_type == "stage":
                data = json.dumps({"stage": key, "message": value})
                yield f"event: stage\ndata: {data}\n\n"
            elif event_type == "detail":
                data = json.dumps({"key": key, "value": value})
                yield f"event: detail\ndata: {data}\n\n"

        await task

        if "error" in result_holder:
            data = json.dumps({"message": result_holder["error"]})
            yield f"event: error\ndata: {data}\n\n"
            return

        code = result_holder["code"]
        objects = result_holder["objects"]
        step_bytes = result_holder["step_bytes"]

        # Save STEP + generation
        db = await _get_db()
        prefix = "sketch" if req.image_base64 else "ai-cad"
        file_id = f"{prefix}-{uuid.uuid4().hex[:8]}"
        brep_result = BrepImportResult(
            file_id=file_id, objects=objects, object_count=len(objects),
        )

        step_path = None
        if step_bytes:
            gen_dir = GENERATIONS_DIR / file_id
            gen_dir.mkdir(exist_ok=True)
            step_file = gen_dir / "model.step"
            step_file.write_bytes(step_bytes)
            step_path = str(step_file)
            (UPLOAD_DIR / f"{file_id}.step").write_bytes(step_bytes)

        gen_id = await db.save_generation(
            prompt=full_prompt, code=code,
            result_json=brep_result.model_dump_json(),
            model_used="pipeline", status="success",
            step_path=step_path,
        )

        result = AiCadResult(
            file_id=file_id, objects=objects, object_count=len(objects),
            generated_code=code, generation_id=gen_id,
            prompt_used=full_prompt, model_used="pipeline",
        )
        data = result.model_dump_json()
        yield f"event: result\ndata: {data}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
```

**Step 2: `/api/sketch-to-brep` エンドポイントを削除**

`backend/main.py` の857-970行を削除（`sketch_to_brep` 関数と `_SKETCH_PREAMBLE` 定数）。
`_SKETCH_PREAMBLE` は Step 1 で `ai_cad_generate` の上に移動済み。

**Step 3: SketchToBrepRequest の import を削除**

`backend/main.py` の import 文から `SketchToBrepRequest` を削除。

**Step 4: コミット**

```bash
git add backend/main.py
git commit -m "refactor: consolidate /ai-cad/generate to handle both text and sketch inputs"
```

---

## Task 3: バックエンドテスト更新

**Files:**
- Modify: `backend/tests/test_api_sketch.py`

**Step 1: テストを `/ai-cad/generate` に書き換え**

テストのエンドポイントを `/api/sketch-to-brep` → `/ai-cad/generate` に変更。
リクエストボディのキーも `AiCadRequest` 形式に揃える。
`mock_pipeline` のシグネチャに `coder_model` を追加。

```python
"""Integration tests for /ai-cad/generate with sketch (image) input."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from main import app
from schemas import BrepObject, BoundingBox, Origin, FacesAnalysis


def _mock_objects():
    return [BrepObject(
        object_id="sketch-0", file_name="sketch_generated.step",
        bounding_box=BoundingBox(x=100, y=80, z=10),
        thickness=10,
        origin=Origin(position=[0, 0, 0], reference="bounding_box_min", description=""),
        unit="mm", is_closed=True, is_planar=True,
        machining_type="2d",
        faces_analysis=FacesAnalysis(
            top_features=False, bottom_features=False, freeform_surfaces=False,
        ),
        outline=[],
    )]


def test_generate_with_image_returns_sse_stages():
    """POST /ai-cad/generate with image_base64 returns SSE stream with stage and result events."""

    mock_objects = _mock_objects()

    async def mock_pipeline(prompt, *, image_base64=None, profile="general",
                            coder_model=None, on_stage=None, on_detail=None):
        if on_stage:
            await on_stage("designing")
            await on_stage("coding")
            await on_stage("reviewing")
            await on_stage("executing")
        return "result = Box(100, 80, 10)", mock_objects, b"STEP data"

    with patch("main._get_llm") as mock_get_llm, \
         patch("main._get_db") as mock_get_db:
        mock_llm = MagicMock()
        mock_llm.generate_pipeline = mock_pipeline
        mock_get_llm.return_value = mock_llm

        mock_db = AsyncMock()
        mock_db.save_generation = AsyncMock(return_value="gen-sketch-1")
        mock_get_db.return_value = mock_db

        client = TestClient(app)
        response = client.post(
            "/ai-cad/generate",
            json={
                "prompt": "四角い板",
                "image_base64": "data:image/png;base64,iVBORw0KGgo=",
                "profile": "sketch_cutout",
            },
            headers={"Accept": "text/event-stream"},
        )

        assert response.status_code == 200
        text = response.text
        assert "event: stage" in text
        assert '"designing"' in text
        assert "event: result" in text


def test_generate_with_image_includes_preamble():
    """Verify the prompt sent to LLM includes sketch-specific preamble when image is present."""
    mock_objects = _mock_objects()
    captured = {}

    async def mock_pipeline(prompt, *, image_base64=None, profile="general",
                            coder_model=None, on_stage=None, on_detail=None):
        captured["prompt"] = prompt
        captured["image_base64"] = image_base64
        captured["profile"] = profile
        if on_stage:
            await on_stage("executing")
        return "result = Box(10, 10, 10)", mock_objects, b"STEP"

    with patch("main._get_llm") as mock_get_llm, \
         patch("main._get_db") as mock_get_db:
        mock_llm = MagicMock()
        mock_llm.generate_pipeline = mock_pipeline
        mock_get_llm.return_value = mock_llm

        mock_db = AsyncMock()
        mock_db.save_generation = AsyncMock(return_value="gen-1")
        mock_get_db.return_value = mock_db

        client = TestClient(app)
        client.post(
            "/ai-cad/generate",
            json={
                "prompt": "丸い皿",
                "image_base64": "data:image/png;base64,abc123",
                "profile": "sketch_3d",
            },
        )

    assert "スケッチ" in captured["prompt"]
    assert "丸い皿" in captured["prompt"]
    assert captured["image_base64"] == "data:image/png;base64,abc123"
    assert captured["profile"] == "sketch_3d"


def test_generate_with_image_file_id_prefix():
    """Result file_id starts with 'sketch-' when image is provided."""
    mock_objects = _mock_objects()

    async def mock_pipeline(prompt, *, image_base64=None, profile="general",
                            coder_model=None, on_stage=None, on_detail=None):
        if on_stage:
            await on_stage("executing")
        return "result = Box(10, 10, 10)", mock_objects, b"STEP"

    with patch("main._get_llm") as mock_get_llm, \
         patch("main._get_db") as mock_get_db:
        mock_llm = MagicMock()
        mock_llm.generate_pipeline = mock_pipeline
        mock_get_llm.return_value = mock_llm

        mock_db = AsyncMock()
        mock_db.save_generation = AsyncMock(return_value="gen-1")
        mock_get_db.return_value = mock_db

        client = TestClient(app)
        response = client.post(
            "/ai-cad/generate",
            json={
                "prompt": "",
                "image_base64": "data:image/png;base64,abc123",
            },
        )

    text = response.text
    for line in text.split("\n"):
        if line.startswith("data: ") and "file_id" in line:
            data = json.loads(line[6:])
            assert data["file_id"].startswith("sketch-")
            break
    else:
        pytest.fail("No result event with file_id found")


def test_generate_text_only_file_id_prefix():
    """Result file_id starts with 'ai-cad-' when no image is provided."""
    mock_objects = _mock_objects()

    async def mock_pipeline(prompt, *, image_base64=None, profile="general",
                            coder_model=None, on_stage=None, on_detail=None):
        if on_stage:
            await on_stage("executing")
        return "result = Box(10, 10, 10)", mock_objects, b"STEP"

    with patch("main._get_llm") as mock_get_llm, \
         patch("main._get_db") as mock_get_db:
        mock_llm = MagicMock()
        mock_llm.generate_pipeline = mock_pipeline
        mock_get_llm.return_value = mock_llm

        mock_db = AsyncMock()
        mock_db.save_generation = AsyncMock(return_value="gen-1")
        mock_get_db.return_value = mock_db

        client = TestClient(app)
        response = client.post(
            "/ai-cad/generate",
            json={"prompt": "円柱を作って"},
        )

    text = response.text
    for line in text.split("\n"):
        if line.startswith("data: ") and "file_id" in line:
            data = json.loads(line[6:])
            assert data["file_id"].startswith("ai-cad-")
            break
    else:
        pytest.fail("No result event with file_id found")


def test_generate_with_coder_model():
    """Verify coder_model is passed through to generate_pipeline."""
    mock_objects = _mock_objects()
    captured = {}

    async def mock_pipeline(prompt, *, image_base64=None, profile="general",
                            coder_model=None, on_stage=None, on_detail=None):
        captured["coder_model"] = coder_model
        if on_stage:
            await on_stage("executing")
        return "result = Box(10, 10, 10)", mock_objects, b"STEP"

    with patch("main._get_llm") as mock_get_llm, \
         patch("main._get_db") as mock_get_db:
        mock_llm = MagicMock()
        mock_llm.generate_pipeline = mock_pipeline
        mock_get_llm.return_value = mock_llm

        mock_db = AsyncMock()
        mock_db.save_generation = AsyncMock(return_value="gen-1")
        mock_get_db.return_value = mock_db

        client = TestClient(app)
        client.post(
            "/ai-cad/generate",
            json={
                "prompt": "テスト",
                "image_base64": "data:image/png;base64,abc123",
                "coder_model": "deepseek/deepseek-r1",
            },
        )

    assert captured["coder_model"] == "deepseek/deepseek-r1"
```

**Step 2: テスト実行**

```bash
cd backend && uv run pytest tests/test_api_sketch.py -v
```

Expected: 全テスト PASS

**Step 3: コミット**

```bash
git add backend/tests/test_api_sketch.py
git commit -m "test: update sketch tests for consolidated /ai-cad/generate endpoint"
```

---

## Task 4: フロントエンド — SSE解析ユーティリティ抽出

**Files:**
- Create: `frontend/src/utils/parseSSEStream.ts`

**Step 1: 共通SSEパーサーを作成**

3箇所（generate, refine, sketch）に散在するSSE解析を統合。

```typescript
/**
 * Parse a Server-Sent Events stream, dispatching typed callbacks.
 * Returns the parsed result from the "result" event.
 */
export async function parseSSEStream<T>(
  response: Response,
  callbacks?: {
    onStage?: (data: { stage: string; message: string }) => void;
    onDetail?: (data: { key: string; value: string }) => void;
  },
): Promise<T> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let result: T | null = null;

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
        if (eventType === "stage" && callbacks?.onStage) {
          callbacks.onStage(data);
        } else if (eventType === "detail" && callbacks?.onDetail) {
          callbacks.onDetail(data);
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

**Step 2: コミット**

```bash
git add frontend/src/utils/parseSSEStream.ts
git commit -m "refactor: extract common SSE stream parser utility"
```

---

## Task 5: フロントエンド — api.ts リファクタリング

**Files:**
- Modify: `frontend/src/api.ts`

**Step 1: generateAiCadStream を拡張 + parseSSEStream を使用**

```typescript
import { parseSSEStream } from "./utils/parseSSEStream";

// ... existing imports ...

export async function generateAiCadStream(
  prompt: string,
  profile?: string,
  onStage?: (event: AiCadStageEvent) => void,
  imageBase64?: string,
  coderModel?: string,
  onDetail?: (event: SketchDetailEvent) => void,
): Promise<AiCadResult> {
  const body: Record<string, string | undefined> = { prompt, profile };
  if (imageBase64) body.image_base64 = imageBase64;
  if (coderModel) body.coder_model = coderModel;

  const response = await fetch(`${API_BASE_URL}/ai-cad/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`AI generation failed: ${response.status}`);
  }

  return parseSSEStream<AiCadResult>(response, {
    onStage: onStage,
    onDetail: onDetail,
  });
}
```

**Step 2: refineAiCadStream を parseSSEStream で書き換え**

```typescript
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

  return parseSSEStream<AiCadRefineResult>(response, { onStage });
}
```

**Step 3: sketchToBrepStream を削除**

api.ts の468-526行（`sketchToBrepStream` 関数）を削除。
`SketchDetailEvent` と `CoderModelInfo` の型定義は残す（AiCadNodeで使用するため）。

**Step 4: コミット**

```bash
git add frontend/src/api.ts frontend/src/utils/parseSSEStream.ts
git commit -m "refactor: consolidate API functions, use shared SSE parser"
```

---

## Task 6: フロントエンド — TextNode 作成

**Files:**
- Create: `frontend/src/nodes/TextNode.tsx`
- Modify: `frontend/src/types.ts`

**Step 1: TextData 型を types.ts に追加**

```typescript
// types.ts に追加
export interface TextData {
  prompt: string;
}
```

**Step 2: TextNode を作成**

```typescript
import { useCallback, useState } from "react";
import { type NodeProps, useReactFlow } from "@xyflow/react";
import LabeledHandle from "./LabeledHandle";
import NodeShell from "../components/NodeShell";

export default function TextNode({ id, selected }: NodeProps) {
  const [prompt, setPrompt] = useState("");
  const { setNodes } = useReactFlow();

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setPrompt(value);
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id
            ? { ...n, data: { ...n.data, textData: { prompt: value } } }
            : n,
        ),
      );
    },
    [id, setNodes],
  );

  return (
    <NodeShell category="utility" selected={selected}>
      <div style={headerStyle}>Text</div>

      <textarea
        value={prompt}
        onChange={handleChange}
        placeholder="Describe the part to generate..."
        style={textareaStyle}
        rows={3}
      />

      <LabeledHandle
        type="source"
        id={`${id}-text`}
        label="text"
        dataType="generic"
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
  background: "var(--surface-bg)", color: "var(--text-primary)",
};
```

**Step 3: コミット**

```bash
git add frontend/src/nodes/TextNode.tsx frontend/src/types.ts
git commit -m "feat: add TextNode for text prompt input"
```

---

## Task 7: フロントエンド — SketchCanvasNode を SketchNode にリネーム

**Files:**
- Rename: `frontend/src/nodes/SketchCanvasNode.tsx` → `frontend/src/nodes/SketchNode.tsx`
- Modify: `frontend/src/nodeRegistry.ts`

**Step 1: ファイルリネーム**

```bash
cd frontend/src/nodes && git mv SketchCanvasNode.tsx SketchNode.tsx
```

**Step 2: SketchNode.tsx 内の関数名を変更**

ファイル内の `SketchCanvasNode` → `SketchNode` にリネーム（`export default function` 行）。

**Step 3: コミット（ここではレジストリは次タスクでまとめて更新）**

```bash
git add frontend/src/nodes/SketchNode.tsx
git commit -m "refactor: rename SketchCanvasNode to SketchNode"
```

---

## Task 8: フロントエンド — AiCadNode 統合リライト

**Files:**
- Modify: `frontend/src/nodes/AiCadNode.tsx`

**Step 1: AiCadNode を統合変換ノードにリライト**

AiCadNode を完全書き換え。変更点:
- 内蔵 textarea を削除
- text 入力ハンドル + sketch 入力ハンドル追加
- `useUpstreamData` で上流データを読み取り
- `fetchCoderModels` でCoderモデルリスト取得
- `generateAiCadStream` に `imageBase64`, `coderModel`, `onDetail` を渡す
- リトライ時の前回エラーコンテキスト（Sketch2BrepNodeから移植）
- 詳細パネル（Sketch2BrepPanel を移植・統合）
- Profile + Coder model ドロップダウン

```typescript
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
    setStatus("generating");
    setError("");
    setStage("");
    setDetails({});

    // Build prompt — include retry context if previous attempt failed
    let prompt = textData?.prompt ?? "";
    if (prevError && prevCode && status === "error") {
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
        (evt) => setDetails((prev) => ({ ...prev, [evt.key]: evt.value })),
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
      icon: "✨",
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
      icon: "✨",
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
              {m.name}{m.is_default ? " ★" : ""}
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
          {error && error.length > 60 ? error.slice(0, 60) + "…" : error}
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
  design: "Gemini 設計",
  code: "Qwen 生成コード",
  reviewed_code: "レビュー後コード",
  execution_error: "実行エラー",
  retry_design: "リトライ設計",
  retry_code: "リトライコード",
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
```

**Step 2: コミット**

```bash
git add frontend/src/nodes/AiCadNode.tsx
git commit -m "refactor: rewrite AiCadNode as unified conversion node with text+sketch inputs"
```

---

## Task 9: フロントエンド — nodeRegistry 更新 + Sketch2BrepNode 削除

**Files:**
- Modify: `frontend/src/nodeRegistry.ts`
- Delete: `frontend/src/nodes/Sketch2BrepNode.tsx`

**Step 1: nodeRegistry.ts を更新**

```typescript
// import 変更
// 削除: import SketchCanvasNode from "./nodes/SketchCanvasNode";
// 削除: import Sketch2BrepNode from "./nodes/Sketch2BrepNode";
// 追加:
import SketchNode from "./nodes/SketchNode";
import TextNode from "./nodes/TextNode";

// NODE_REGISTRY 変更:
// 削除: sketchCanvas と sketch2Brep のエントリ
// 追加:
//   textNode: { component: TextNode, label: "Text", category: "utility" },
//   sketchNode: { component: SketchNode, label: "Sketch", category: "utility" },
// 注意: sketchNode のカテゴリを "cad" → "utility" に変更
```

具体的な変更:

`nodeRegistry.ts` の import:
- `import SketchCanvasNode from "./nodes/SketchCanvasNode";` → `import SketchNode from "./nodes/SketchNode";`
- `import Sketch2BrepNode from "./nodes/Sketch2BrepNode";` → 削除
- 追加: `import TextNode from "./nodes/TextNode";`

`NODE_REGISTRY` の変更:
- `sketchCanvas: { ... }` → `sketchNode: { component: SketchNode, label: "Sketch", category: "utility" },`
- `sketch2Brep: { ... }` → 削除
- 追加: `textNode: { component: TextNode, label: "Text", category: "utility" },`

**Step 2: Sketch2BrepNode.tsx を削除**

```bash
git rm frontend/src/nodes/Sketch2BrepNode.tsx
```

**Step 3: コミット**

```bash
git add frontend/src/nodeRegistry.ts
git commit -m "refactor: update node registry — add TextNode, rename SketchNode, remove Sketch2BrepNode"
```

---

## Task 10: 動作確認 + 全テスト実行

**Step 1: バックエンドテスト実行**

```bash
cd backend && uv run pytest tests/ -v
```

Expected: 全テスト PASS（スケッチテスト含む）

**Step 2: フロントエンドビルド確認**

```bash
cd frontend && npm run build
```

Expected: ビルド成功、型エラーなし

**Step 3: TypeScriptの未使用import/参照がないか確認**

`Sketch2BrepNode` や `sketchToBrepStream` への参照が残っていないことを確認:

```bash
grep -r "Sketch2Brep\|sketch2Brep\|sketchToBrepStream\|SketchCanvasNode\|sketchCanvas" frontend/src/ --include="*.ts" --include="*.tsx"
```

Expected: `SketchNode.tsx` 内の正当な参照のみ

**Step 4: 問題があれば修正してコミット**

---

## Task 11: 最終コミット + 整理

**Step 1: MEMORY.md 更新**

リファクタリング完了を記録。

**Step 2: 確認事項チェックリスト**

- [ ] `TextNode` → `AiCadNode` (text handle) 接続が動作する
- [ ] `SketchNode` → `AiCadNode` (sketch handle) 接続が動作する
- [ ] `TextNode` + `SketchNode` 両方接続で動作する
- [ ] Profile / Coder model 選択が動作する
- [ ] リファインメント（Chat パネル）が動作する
- [ ] View Code パネルが動作する
- [ ] Details パネルが動作する
- [ ] リトライ時に前回エラーコンテキストが含まれる
- [ ] 画像付きの場合 file_id が `sketch-` プレフィックス
- [ ] テキストのみの場合 file_id が `ai-cad-` プレフィックス
