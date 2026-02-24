# Code Library Node (Phase B) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** React Flow 上に Code Library Node を追加し、AI Node が生成したコードを名前・タグ付きで保存、ライブラリから取り出して再実行し下流ノードに接続できるようにする。

**Architecture:** バックエンドに `snippets` テーブル（`db.py`）と `/snippets` CRUD エンドポイント（`main.py`）を追加。フロントエンドに `SnippetDbNode` コンポーネントを新設し、`useUpstreamData` フックで上流 AI Node のデータを購読する。取り出し時は `POST /snippets/{id}/execute` でコードを再実行して AI Node 互換の `AiCadResult` を生成する。

**Tech Stack:** FastAPI, aiosqlite, React Flow (@xyflow/react), TypeScript, Three.js（サムネ生成）, pytest-asyncio

---

## Task 1: SnippetsDB クラスをバックエンドに追加

**Files:**
- Modify: `backend/db.py`

### Step 1: `_SNIPPETS_SCHEMA` 定数と `SnippetsDB` クラスを `db.py` の末尾に追加

`backend/db.py` のファイル末尾に追加:

```python
import json  # ファイル先頭に既存の場合はスキップ

_SNIPPETS_SCHEMA = """\
CREATE TABLE IF NOT EXISTS snippets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tags TEXT,
    code TEXT NOT NULL,
    thumbnail_png TEXT,
    source_generation_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""


class SnippetsDB:
    """Async SQLite wrapper for snippet storage."""

    def __init__(self, db_path: str | Path):
        self._db_path = str(db_path)
        self._conn: aiosqlite.Connection | None = None

    async def init(self):
        self._conn = await aiosqlite.connect(self._db_path)
        self._conn.row_factory = aiosqlite.Row
        await self._conn.executescript(_SNIPPETS_SCHEMA)
        await self._conn.commit()

    async def close(self):
        if self._conn:
            await self._conn.close()

    async def save_snippet(
        self,
        name: str,
        code: str,
        tags: list[str] | None = None,
        thumbnail_png: str | None = None,
        source_generation_id: str | None = None,
    ) -> str:
        snippet_id = uuid.uuid4().hex[:12]
        now = datetime.now(timezone.utc).isoformat()
        await self._conn.execute(
            "INSERT INTO snippets (id, name, tags, code, thumbnail_png, source_generation_id, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (snippet_id, name, json.dumps(tags or []), code, thumbnail_png, source_generation_id, now, now),
        )
        await self._conn.commit()
        return snippet_id

    async def get_snippet(self, snippet_id: str) -> dict | None:
        cursor = await self._conn.execute("SELECT * FROM snippets WHERE id = ?", (snippet_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None

    async def list_snippets(
        self, q: str = "", limit: int = 50, offset: int = 0
    ) -> tuple[list[dict], int]:
        search_val = f"%{q}%"
        cursor = await self._conn.execute(
            "SELECT * FROM snippets WHERE name LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (search_val, limit, offset),
        )
        rows = await cursor.fetchall()
        count_cursor = await self._conn.execute(
            "SELECT COUNT(*) FROM snippets WHERE name LIKE ?", (search_val,)
        )
        total = (await count_cursor.fetchone())[0]
        return [dict(r) for r in rows], total

    async def delete_snippet(self, snippet_id: str) -> bool:
        cursor = await self._conn.execute("DELETE FROM snippets WHERE id = ?", (snippet_id,))
        await self._conn.commit()
        return cursor.rowcount > 0
```

### Step 2: `db.py` の先頭に `import json` を確認・追加
既存の import にない場合のみ追加。

---

## Task 2: Pydantic スキーマ追加

**Files:**
- Modify: `backend/schemas.py`

### Step 1: 末尾に Snippet スキーマを追加

```python
# ── Snippet DB ──────────────────────────────────────────────────────────────

class SnippetSaveRequest(BaseModel):
    """Request to save a snippet."""
    name: str
    tags: list[str] = []
    code: str
    thumbnail_png: str | None = None        # base64 PNG 128×128
    source_generation_id: str | None = None


class SnippetInfo(BaseModel):
    """A saved snippet record."""
    id: str
    name: str
    tags: list[str]
    code: str
    thumbnail_png: str | None
    source_generation_id: str | None
    created_at: str


class SnippetListResponse(BaseModel):
    snippets: list[SnippetInfo]
    total: int
```

---

## Task 3: バックエンドテスト（先にテスト）

**Files:**
- Create: `backend/tests/test_snippets.py`

### Step 1: テストファイル作成

```python
"""Tests for SnippetsDB and /snippets endpoints."""
import json
import pytest
import pytest_asyncio
from pathlib import Path
from fastapi.testclient import TestClient

from db import SnippetsDB


# ── DB unit tests ────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def snippets_db(tmp_path: Path):
    db = SnippetsDB(tmp_path / "test_snippets.db")
    await db.init()
    yield db
    await db.close()


@pytest.mark.asyncio
async def test_save_and_get_snippet(snippets_db: SnippetsDB):
    sid = await snippets_db.save_snippet(
        name="Simple Box",
        code="from build123d import *\nresult = Box(10, 10, 10)",
        tags=["box", "simple"],
    )
    assert sid is not None
    row = await snippets_db.get_snippet(sid)
    assert row["name"] == "Simple Box"
    assert json.loads(row["tags"]) == ["box", "simple"]
    assert "Box(10" in row["code"]


@pytest.mark.asyncio
async def test_get_nonexistent_snippet(snippets_db: SnippetsDB):
    row = await snippets_db.get_snippet("nonexistent")
    assert row is None


@pytest.mark.asyncio
async def test_list_snippets(snippets_db: SnippetsDB):
    await snippets_db.save_snippet(name="Box", code="result = Box(10,10,10)")
    await snippets_db.save_snippet(name="Cylinder", code="result = Cylinder(5,10)")
    rows, total = await snippets_db.list_snippets()
    assert total == 2
    assert len(rows) == 2


@pytest.mark.asyncio
async def test_list_snippets_search(snippets_db: SnippetsDB):
    await snippets_db.save_snippet(name="Simple Box", code="result = Box(10,10,10)")
    await snippets_db.save_snippet(name="Cylinder", code="result = Cylinder(5,10)")
    rows, total = await snippets_db.list_snippets(q="Box")
    assert total == 1
    assert rows[0]["name"] == "Simple Box"


@pytest.mark.asyncio
async def test_delete_snippet(snippets_db: SnippetsDB):
    sid = await snippets_db.save_snippet(name="Temp", code="result = Box(1,1,1)")
    deleted = await snippets_db.delete_snippet(sid)
    assert deleted is True
    assert await snippets_db.get_snippet(sid) is None


@pytest.mark.asyncio
async def test_delete_nonexistent(snippets_db: SnippetsDB):
    deleted = await snippets_db.delete_snippet("ghost")
    assert deleted is False


# ── API endpoint tests ───────────────────────────────────────────────────────

@pytest.fixture
def client():
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from main import app
    return TestClient(app)


def test_post_snippet(client: TestClient):
    resp = client.post("/snippets", json={
        "name": "Box",
        "tags": ["box"],
        "code": "from build123d import *\nresult = Box(10,10,10)",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Box"
    assert data["id"] is not None


def test_get_snippets_list(client: TestClient):
    client.post("/snippets", json={"name": "A", "code": "result = Box(1,1,1)"})
    resp = client.get("/snippets")
    assert resp.status_code == 200
    data = resp.json()
    assert "snippets" in data
    assert "total" in data


def test_get_snippets_search(client: TestClient):
    client.post("/snippets", json={"name": "SearchMe", "code": "result = Box(1,1,1)"})
    client.post("/snippets", json={"name": "Other", "code": "result = Box(2,2,2)"})
    resp = client.get("/snippets?q=SearchMe")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    assert data["snippets"][0]["name"] == "SearchMe"


def test_delete_snippet(client: TestClient):
    post_resp = client.post("/snippets", json={"name": "ToDelete", "code": "result = Box(1,1,1)"})
    sid = post_resp.json()["id"]
    del_resp = client.delete(f"/snippets/{sid}")
    assert del_resp.status_code == 200
    # 再取得できないことを確認
    list_resp = client.get(f"/snippets?q=ToDelete")
    assert list_resp.json()["total"] == 0


def test_execute_snippet(client: TestClient):
    post_resp = client.post("/snippets", json={
        "name": "Box",
        "code": "from build123d import *\nresult = Box(10, 10, 10)",
    })
    sid = post_resp.json()["id"]
    exec_resp = client.post(f"/snippets/{sid}/execute")
    assert exec_resp.status_code == 200
    data = exec_resp.json()
    assert data["object_count"] > 0
    assert data["generated_code"] is not None
    assert data["model_used"] == "snippet"


def test_execute_nonexistent_snippet(client: TestClient):
    resp = client.post("/snippets/nonexistent/execute")
    assert resp.status_code == 404


def test_execute_invalid_code_snippet(client: TestClient):
    post_resp = client.post("/snippets", json={
        "name": "Bad",
        "code": "this is not valid python!!!",
    })
    sid = post_resp.json()["id"]
    resp = client.post(f"/snippets/{sid}/execute")
    assert resp.status_code == 422
```

### Step 2: テストを実行して失敗することを確認

```bash
cd backend && uv run pytest tests/test_snippets.py -v
```

期待: 多数の `FAILED` / `ImportError`（実装前なので正常）

---

## Task 4: /snippets エンドポイントを main.py に追加

**Files:**
- Modify: `backend/main.py`

### Step 1: import に SnippetsDB と Snippet スキーマを追加

`main.py` の import セクション:

```python
from db import GenerationDB, SnippetsDB          # ← SnippetsDB を追加
from schemas import (
    ...
    SnippetSaveRequest, SnippetInfo, SnippetListResponse,  # ← 追加
)
```

### Step 2: `_snippets_db` グローバル変数と `_get_snippets_db()` を追加

`_db`, `_llm` 変数の近くに追記:

```python
_snippets_db: SnippetsDB | None = None


async def _get_snippets_db() -> SnippetsDB:
    global _snippets_db
    if _snippets_db is None:
        _snippets_db = SnippetsDB(DATA_DIR / "pathdesigner.db")
        await _snippets_db.init()
    return _snippets_db
```

### Step 3: `shutdown()` に close 処理を追加

```python
@app.on_event("shutdown")
async def shutdown():
    if _db is not None:
        await _db.close()
    if _snippets_db is not None:          # ← 追加
        await _snippets_db.close()        # ← 追加
```

### Step 4: エンドポイント群を追加（ai-cad セクションの後）

```python
# ── Snippet DB endpoints ─────────────────────────────────────────────────────

@app.post("/snippets", response_model=SnippetInfo)
async def save_snippet(req: SnippetSaveRequest):
    """Save a snippet to the library."""
    db = await _get_snippets_db()
    snippet_id = await db.save_snippet(
        name=req.name,
        code=req.code,
        tags=req.tags,
        thumbnail_png=req.thumbnail_png,
        source_generation_id=req.source_generation_id,
    )
    row = await db.get_snippet(snippet_id)
    return SnippetInfo(
        id=row["id"],
        name=row["name"],
        tags=json.loads(row["tags"] or "[]"),
        code=row["code"],
        thumbnail_png=row["thumbnail_png"],
        source_generation_id=row["source_generation_id"],
        created_at=row["created_at"],
    )


@app.get("/snippets", response_model=SnippetListResponse)
async def list_snippets(q: str = "", limit: int = 50, offset: int = 0):
    """List snippets with optional name search."""
    db = await _get_snippets_db()
    rows, total = await db.list_snippets(q=q, limit=limit, offset=offset)
    snippets = [
        SnippetInfo(
            id=r["id"],
            name=r["name"],
            tags=json.loads(r["tags"] or "[]"),
            code=r["code"],
            thumbnail_png=r["thumbnail_png"],
            source_generation_id=r["source_generation_id"],
            created_at=r["created_at"],
        )
        for r in rows
    ]
    return SnippetListResponse(snippets=snippets, total=total)


@app.delete("/snippets/{snippet_id}")
async def delete_snippet(snippet_id: str):
    """Delete a snippet by ID."""
    db = await _get_snippets_db()
    deleted = await db.delete_snippet(snippet_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Snippet not found")
    return {"ok": True}


@app.post("/snippets/{snippet_id}/execute", response_model=AiCadResult)
async def execute_snippet(snippet_id: str):
    """Execute a snippet's code and return AI-Node-compatible output."""
    snippets_db = await _get_snippets_db()
    row = await snippets_db.get_snippet(snippet_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Snippet not found")

    try:
        objects, step_bytes = execute_build123d_code(row["code"])
    except CodeExecutionError as e:
        raise HTTPException(status_code=422, detail=str(e))

    file_id = f"snippet-{uuid.uuid4().hex[:8]}"
    if step_bytes:
        (UPLOAD_DIR / f"{file_id}.step").write_bytes(step_bytes)
        gen_dir = GENERATIONS_DIR / file_id
        gen_dir.mkdir(exist_ok=True)
        (gen_dir / "model.step").write_bytes(step_bytes)

    result = BrepImportResult(file_id=file_id, objects=objects, object_count=len(objects))
    gen_db = await _get_db()
    gen_id = await gen_db.save_generation(
        prompt=f"(snippet: {row['name']})",
        code=row["code"],
        result_json=result.model_dump_json(),
        model_used="snippet",
        status="success",
    )

    return AiCadResult(
        file_id=file_id,
        objects=objects,
        object_count=len(objects),
        generated_code=row["code"],
        generation_id=gen_id,
        prompt_used=f"(snippet: {row['name']})",
        model_used="snippet",
    )
```

`main.py` の先頭 import に `json` がなければ追加（通常は既存）。
`BrepImportResult` を schemas から import していなければ追加。

### Step 5: テストを再実行してパスを確認

```bash
cd backend && uv run pytest tests/test_snippets.py -v
```

期待: 全テスト `PASSED`

### Step 6: 既存テストが壊れていないか確認

```bash
cd backend && uv run pytest tests/ -v --ignore=tests/test_llm_client.py
```

期待: 既存テストも全 PASSED

### Step 7: コミット

```bash
git add backend/db.py backend/schemas.py backend/main.py backend/tests/test_snippets.py
git commit -m "feat: add SnippetsDB, /snippets CRUD + execute endpoints (#35)"
```

---

## Task 5: フロントエンド型定義 + API 関数

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api.ts`

### Step 1: `types.ts` に Snippet 型を追加

`types.ts` の末尾に追加:

```typescript
// ── Snippet DB ────────────────────────────────────────────────────────────────

export interface SnippetInfo {
  id: string;
  name: string;
  tags: string[];
  code: string;
  thumbnail_png: string | null;
  source_generation_id: string | null;
  created_at: string;
}

export interface SnippetListResponse {
  snippets: SnippetInfo[];
  total: number;
}

export interface SnippetSaveRequest {
  name: string;
  tags: string[];
  code: string;
  thumbnail_png?: string;
  source_generation_id?: string;
}

/** SnippetDbNode の node data */
export interface SnippetDbNodeData extends Record<string, unknown> {
  outputResult: AiCadResult | null;
}
```

### Step 2: `api.ts` に Snippet API 関数を追加

`api.ts` の末尾に追加（`SnippetInfo`, `SnippetListResponse`, `SnippetSaveRequest` を import に追加すること）:

```typescript
// ── Snippet DB ────────────────────────────────────────────────────────────────

export async function saveSnippet(req: SnippetSaveRequest): Promise<SnippetInfo> {
  const res = await fetch(`${API_BASE}/snippets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listSnippets(q?: string): Promise<SnippetListResponse> {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  const res = await fetch(`${API_BASE}/snippets?${params}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteSnippet(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/snippets/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}

export async function executeSnippet(id: string): Promise<AiCadResult> {
  const res = await fetch(`${API_BASE}/snippets/${id}/execute`, { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
```

### Step 3: ビルドエラーがないか確認

```bash
cd frontend && npm run build 2>&1 | tail -20
```

期待: エラーなし

---

## Task 6: SnippetDbNode コンポーネント作成

**Files:**
- Create: `frontend/src/nodes/SnippetDbNode.tsx`

### Step 1: コンポーネントを作成

`useUpstreamData` で上流 AI Node から `AiCadResult` を読み取り、保存フォームとライブラリグリッドを表示する。

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { Handle, Position, type NodeProps, useReactFlow } from "@xyflow/react";
import NodeShell from "../components/NodeShell";
import {
  saveSnippet,
  listSnippets,
  deleteSnippet,
  executeSnippet,
} from "../api";
import type { AiCadResult, SnippetInfo, SnippetDbNodeData } from "../types";
import { useUpstreamData } from "../hooks/useUpstreamData";

// ── オフスクリーン Three.js サムネ生成 ────────────────────────────────────────

async function renderThumbnail(meshUrl: string): Promise<string | null> {
  try {
    const { WebGLRenderer, Scene, PerspectiveCamera, AmbientLight, DirectionalLight, Box3, Vector3 } =
      await import("three");
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");

    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;

    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(128, 128);

    const scene = new Scene();
    scene.add(new AmbientLight(0xffffff, 0.8));
    const dir = new DirectionalLight(0xffffff, 0.6);
    dir.position.set(1, 2, 3);
    scene.add(dir);

    const camera = new PerspectiveCamera(45, 1, 0.01, 1000);

    const loader = new GLTFLoader();
    const gltf = await new Promise<{ scene: THREE.Group }>((res, rej) =>
      loader.load(meshUrl, res, undefined, rej),
    );
    scene.add(gltf.scene);

    const box = new Box3().setFromObject(gltf.scene);
    const center = new Vector3();
    box.getCenter(center);
    const size = box.getSize(new Vector3()).length();
    camera.position.copy(center).addScalar(size);
    camera.lookAt(center);

    renderer.render(scene, camera);
    const dataUrl = canvas.toDataURL("image/png");
    renderer.dispose();
    return dataUrl;
  } catch {
    return null;
  }
}

// ── コンポーネント ─────────────────────────────────────────────────────────────

export default function SnippetDbNode({ id, selected }: NodeProps) {
  const { setNodes } = useReactFlow();

  // 上流データ購読（AI Node または他の code 出力ノードから）
  const extractUpstream = useCallback(
    (d: Record<string, unknown>) => {
      const result = d.result as AiCadResult | undefined;
      return result ?? undefined;
    },
    [],
  );
  const upstream = useUpstreamData(id, `${id}-input`, extractUpstream);

  // 保存フォーム
  const [name, setName] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // ライブラリ
  const [snippets, setSnippets] = useState<SnippetInfo[]>([]);
  const [searchQ, setSearchQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 初回 + 検索変更でスニペット一覧を取得
  useEffect(() => {
    listSnippets(searchQ || undefined)
      .then((r) => setSnippets(r.snippets))
      .catch(() => setSnippets([]));
  }, [searchQ]);

  // 保存ハンドラ
  const handleSave = async () => {
    if (!upstream || !name.trim()) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      // オフスクリーンサムネ生成（失敗しても保存は続行）
      let thumbnail: string | undefined;
      if (upstream.file_id) {
        const meshUrl = `/files/${upstream.file_id}/mesh.glb`;
        thumbnail = (await renderThumbnail(meshUrl)) ?? undefined;
      }

      await saveSnippet({
        name: name.trim(),
        tags: tagsInput.split(",").map((t) => t.trim()).filter(Boolean),
        code: upstream.generated_code,
        thumbnail_png: thumbnail,
        source_generation_id: upstream.generation_id,
      });

      setSaveMsg("保存しました");
      setName("");
      setTagsInput("");
      // ライブラリ更新
      const refreshed = await listSnippets(searchQ || undefined);
      setSnippets(refreshed.snippets);
    } catch (e) {
      setSaveMsg(`エラー: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  // 取り出し＆実行ハンドラ
  const handleExecute = async () => {
    if (!selectedId) return;
    setExecuting(true);
    setError(null);
    try {
      const result = await executeSnippet(selectedId);
      // 自ノードの outputResult を更新 → 下流ノードが購読
      setNodes((nodes) =>
        nodes.map((n) =>
          n.id === id
            ? { ...n, data: { ...n.data, outputResult: result } }
            : n,
        ),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setExecuting(false);
    }
  };

  const handleDelete = async (sid: string) => {
    await deleteSnippet(sid).catch(() => {});
    if (selectedId === sid) setSelectedId(null);
    const refreshed = await listSnippets(searchQ || undefined);
    setSnippets(refreshed.snippets);
  };

  return (
    <NodeShell label="Code Library" selected={selected} category="cad">
      {/* Input handle */}
      <Handle
        type="target"
        position={Position.Left}
        id={`${id}-input`}
        style={{ top: "30%" }}
      />

      <div style={{ padding: "8px", minWidth: 220, fontSize: 12 }}>
        {/* ── 保存エリア ─────────────────────────── */}
        <div style={{ marginBottom: 10, opacity: upstream ? 1 : 0.4 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            保存 {upstream ? `— ${upstream.object_count} objects` : "（input 未接続）"}
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="名前（必須）"
            disabled={!upstream}
            style={{ width: "100%", marginBottom: 4, boxSizing: "border-box" }}
          />
          <input
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="タグ（カンマ区切り）"
            disabled={!upstream}
            style={{ width: "100%", marginBottom: 4, boxSizing: "border-box" }}
          />
          <button
            onClick={handleSave}
            disabled={!upstream || !name.trim() || saving}
            style={{ width: "100%" }}
          >
            {saving ? "保存中..." : "保存"}
          </button>
          {saveMsg && (
            <div style={{ marginTop: 4, color: saveMsg.startsWith("エラー") ? "red" : "green" }}>
              {saveMsg}
            </div>
          )}
        </div>

        {/* ── ライブラリ ─────────────────────────── */}
        <div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>ライブラリ</div>
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="🔍 検索..."
            style={{ width: "100%", marginBottom: 6, boxSizing: "border-box" }}
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, maxHeight: 200, overflowY: "auto" }}>
            {snippets.length === 0 && (
              <div style={{ gridColumn: "1/-1", color: "#888", textAlign: "center" }}>
                スニペットなし
              </div>
            )}
            {snippets.map((s) => (
              <div
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                style={{
                  border: `1px solid ${selectedId === s.id ? "#4a9eff" : "#555"}`,
                  borderRadius: 4,
                  padding: 4,
                  cursor: "pointer",
                  background: selectedId === s.id ? "#1a3a5c" : "#2a2a2a",
                  position: "relative",
                }}
              >
                {s.thumbnail_png ? (
                  <img
                    src={s.thumbnail_png}
                    alt={s.name}
                    style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 2 }}
                  />
                ) : (
                  <div style={{ width: "100%", aspectRatio: "1", background: "#3a3a3a", borderRadius: 2, display: "flex", alignItems: "center", justifyContent: "center", color: "#666" }}>
                    📦
                  </div>
                )}
                <div style={{ fontSize: 10, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.name}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
                  style={{ position: "absolute", top: 2, right: 2, fontSize: 9, padding: "0 3px", background: "#555", border: "none", borderRadius: 2, cursor: "pointer", color: "#fff" }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={handleExecute}
            disabled={!selectedId || executing}
            style={{ width: "100%", marginTop: 6 }}
          >
            {executing ? "実行中..." : "選択して実行"}
          </button>
          {error && <div style={{ color: "red", marginTop: 4 }}>{error}</div>}
        </div>
      </div>

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        id={`${id}-output`}
        style={{ top: "70%" }}
      />
    </NodeShell>
  );
}
```

### Step 2: ビルドエラーがないか確認

```bash
cd frontend && npm run build 2>&1 | tail -20
```

---

## Task 7: nodeRegistry に登録

**Files:**
- Modify: `frontend/src/nodeRegistry.ts`

### Step 1: import と registry エントリを追加

```typescript
import SnippetDbNode from "./nodes/SnippetDbNode";  // ← 追加

const NODE_REGISTRY: Record<string, NodeRegistryEntry> = {
  aiCad: { component: AiCadNode, label: "AI CAD", category: "cad" },
  snippetDb: { component: SnippetDbNode, label: "Code Library", category: "cad" },  // ← 追加
  brepImport: { component: BrepImportNode, label: "BREP Import", category: "cad" },
  // ... 既存エントリ
};
```

### Step 2: ビルドして動作確認

```bash
cd frontend && npm run build 2>&1 | tail -5
```

### Step 3: 手動動作確認

```bash
make dev
```

1. サイドバーの **CAD** グループに「Code Library」が表示されることを確認
2. キャンバスにドラッグ＆ドロップ → ノードが表示されることを確認
3. AI Node → Code Library Node に接続 → 保存エリアが有効化されることを確認
4. 名前・タグ入力 → 保存 → ライブラリに表示されることを確認
5. スニペット選択 → 「選択して実行」→ ログで AiCadResult が返ることを確認
6. Code Library Node → Operation Node に接続して動作確認

### Step 4: コミット

```bash
git add frontend/src/types.ts frontend/src/api.ts frontend/src/nodes/SnippetDbNode.tsx frontend/src/nodeRegistry.ts
git commit -m "feat: add Code Library Node frontend (SnippetDbNode) (#35)"
```

---

## Task 8: PR 作成・issue クローズ

### Step 1: PR 作成

```bash
git push origin feature/phase-b-code-library
gh pr create \
  --title "Phase B: Code Library Node — スニペットDB + 保存/取り出しノード" \
  --body "Closes #35" \
  --base main
```

### Step 2: テスト最終確認

```bash
cd backend && uv run pytest tests/ -v --ignore=tests/test_llm_client.py
```

期待: 全テスト PASSED（192 + 新規 ~12 件 = 204 件以上）

---

## 注意事項

- **同一 SQLite ファイル使用:** `SnippetsDB` と `GenerationDB` は同じ `pathdesigner.db` を参照するが、別コネクションを使用する。SQLite のデフォルト WAL モードなら問題なし
- **サムネ生成は失敗しても保存続行:** `renderThumbnail()` のエラーは握りつぶし、`thumbnail_png: null` で保存する
- **`useUpstreamData` の targetHandle:** `${id}-input` を Handle の `id` と一致させること
- **output handle の id:** `${id}-output` を使用。下流ノードが `useUpstreamData(nodeId, "${nodeId}-brep", ...)` 等で接続する場合は handle id を合わせること（既存 Operation Node との接続は別途確認）
