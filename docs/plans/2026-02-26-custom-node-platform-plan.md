# Custom Node Platform — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** ユーザーがスキーマ定義（YAML）でカスタムノードを作成し、AIと対話しながら拡張できるプラットフォーム基盤を構築する。

**Architecture:** バックエンドにカスタムノード定義のCRUD + Python handler実行ランタイムを追加。フロントエンドでスキーマからReact Flowノードを動的生成する `DynamicNodeRenderer` を実装。AI統合は既存の2ステージパイプラインを活用。

**Tech Stack:** FastAPI, Pydantic, aiosqlite, PyYAML (backend) / React, React Flow, TypeScript (frontend)

**Design Doc:** `docs/plans/2026-02-26-custom-node-platform-design.md`

---

## Phase概要マップ

| Phase | 内容 | 成果物 |
|-------|------|--------|
| 1 | バックエンド基盤 | スキーマPydantic + CRUD API + execute + DB + テスト |
| 2 | フロントエンド動的レンダリング | DynamicNodeRenderer + form テンプレート + サイドバー統合 |
| 3 | AI統合 | Node Builder Panel + /custom-nodes/generate SSE |
| 4 | 追加UIテンプレート | canvas / composite / passthrough テンプレート |
| 5 | 既存ノード移行（オプション） | 既存ハードコードノードのスキーマベース化 |

---

## Phase 1: バックエンド基盤（詳細）

### Task 1: カスタムノードスキーマの Pydantic モデル

**Files:**
- Create: `backend/custom_node_schema.py`
- Test: `backend/tests/test_custom_node_schema.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_custom_node_schema.py
import pytest
import yaml
from custom_node_schema import CustomNodeSchema, NodeInput, NodeOutput, NodeParam, NodeUI


FILLET_YAML = """
name: fillet_edges
label: "フィレット追加"
description: "エッジにフィレットを追加する"
category: cad
icon: rounded_corner
version: 1
inputs:
  - name: brep
    type: geometry
    label: "入力ジオメトリ"
outputs:
  - name: result
    type: geometry
    label: "出力ジオメトリ"
params:
  - name: radius
    type: slider
    label: "フィレット半径"
    default: 2.0
    min: 0.1
    max: 50.0
    step: 0.1
    unit: mm
ui:
  template: form
  node_summary: "{radius}mm フィレット"
handler: |
  from build123d import *
  solid = inputs["brep"]
  radius = params["radius"]
  outputs["result"] = fillet(solid, radius)
"""


def test_parse_fillet_yaml():
    data = yaml.safe_load(FILLET_YAML)
    schema = CustomNodeSchema(**data)
    assert schema.name == "fillet_edges"
    assert schema.label == "フィレット追加"
    assert schema.category == "cad"
    assert len(schema.inputs) == 1
    assert schema.inputs[0].type == "geometry"
    assert len(schema.outputs) == 1
    assert len(schema.params) == 1
    assert schema.params[0].type == "slider"
    assert schema.params[0].min == 0.1
    assert schema.ui.template == "form"
    assert schema.handler is not None


def test_input_types_validated():
    with pytest.raises(ValueError):
        NodeInput(name="x", type="invalid_type", label="X")


def test_param_select_requires_options():
    with pytest.raises(ValueError):
        NodeParam(name="op", type="select", label="Op", default="a")
        # select にはoptionsが必須


def test_minimal_schema():
    """最小限のスキーマ（params/ui省略可能）"""
    data = {
        "name": "passthrough",
        "label": "Pass",
        "category": "utility",
        "inputs": [{"name": "in", "type": "any", "label": "In"}],
        "outputs": [{"name": "out", "type": "any", "label": "Out"}],
        "handler": "outputs['out'] = inputs['in']",
    }
    schema = CustomNodeSchema(**data)
    assert schema.params == []
    assert schema.ui.template == "form"  # デフォルト


def test_multi_io_schema():
    """複数入出力"""
    data = {
        "name": "boolean_op",
        "label": "Boolean",
        "category": "cad",
        "inputs": [
            {"name": "body_a", "type": "geometry", "label": "A"},
            {"name": "body_b", "type": "geometry", "label": "B"},
        ],
        "outputs": [
            {"name": "result", "type": "geometry", "label": "Result"},
            {"name": "removed", "type": "geometry", "label": "Removed"},
        ],
        "handler": "pass",
    }
    schema = CustomNodeSchema(**data)
    assert len(schema.inputs) == 2
    assert len(schema.outputs) == 2


def test_schema_to_yaml_roundtrip():
    data = yaml.safe_load(FILLET_YAML)
    schema = CustomNodeSchema(**data)
    dumped = yaml.safe_dump(schema.model_dump(), allow_unicode=True)
    reloaded = CustomNodeSchema(**yaml.safe_load(dumped))
    assert reloaded.name == schema.name
    assert len(reloaded.inputs) == len(schema.inputs)
```

**Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_custom_node_schema.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'custom_node_schema'`

**Step 3: Write implementation**

```python
# backend/custom_node_schema.py
"""カスタムノード定義スキーマ"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, field_validator, model_validator


HandleType = Literal[
    "geometry", "settings", "toolpath", "number", "text", "list", "any", "generic"
]

ParamType = Literal[
    "number", "text", "select", "boolean", "slider", "color", "file"
]

UITemplate = Literal["form", "canvas", "code", "composite", "passthrough"]

NodeCategory = Literal["cad", "cam", "utility", "custom"]


class NodeInput(BaseModel):
    name: str
    type: HandleType
    label: str
    required: bool = True


class NodeOutput(BaseModel):
    name: str
    type: HandleType
    label: str


class SelectOption(BaseModel):
    value: str
    label: str


class NodeParam(BaseModel):
    name: str
    type: ParamType
    label: str
    default: float | str | bool | None = None
    min: float | None = None
    max: float | None = None
    step: float | None = None
    unit: str | None = None
    options: list[SelectOption] | None = None
    placeholder: str | None = None

    @model_validator(mode="after")
    def select_requires_options(self):
        if self.type == "select" and not self.options:
            raise ValueError("select param requires 'options'")
        return self


class CompositeTab(BaseModel):
    label: str
    template: UITemplate


class CanvasConfig(BaseModel):
    width: int = 300
    height: int = 200


class NodeUI(BaseModel):
    template: UITemplate = "form"
    node_summary: str | None = None
    canvas: CanvasConfig | None = None
    tabs: list[CompositeTab] | None = None


class CustomNodeSchema(BaseModel):
    name: str
    label: str
    description: str = ""
    category: NodeCategory = "custom"
    icon: str | None = None
    color: str | None = None
    version: int = 1

    inputs: list[NodeInput] = []
    outputs: list[NodeOutput] = []
    params: list[NodeParam] = []

    ui: NodeUI = NodeUI()

    handler: str

    @field_validator("name")
    @classmethod
    def name_must_be_snake_case(cls, v: str) -> str:
        import re
        if not re.match(r"^[a-z][a-z0-9_]*$", v):
            raise ValueError("name must be snake_case")
        return v
```

**Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_custom_node_schema.py -v`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add backend/custom_node_schema.py backend/tests/test_custom_node_schema.py
git commit -m "feat(custom-node): add Pydantic schema for custom node definitions"
```

---

### Task 2: CustomNodesDB — データベース層

**Files:**
- Modify: `backend/db.py` — `CustomNodesDB` クラスを追加
- Test: `backend/tests/test_custom_nodes_db.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_custom_nodes_db.py
import pytest
import pytest_asyncio
from pathlib import Path
from db import CustomNodesDB

SAMPLE_SCHEMA = """
name: fillet_edges
label: "フィレット追加"
category: cad
inputs:
  - name: brep
    type: geometry
    label: "BREP"
outputs:
  - name: result
    type: geometry
    label: "Result"
params:
  - name: radius
    type: slider
    label: "Radius"
    default: 2.0
    min: 0.1
    max: 50.0
ui:
  template: form
  node_summary: "{radius}mm fillet"
handler: |
  outputs["result"] = inputs["brep"]
"""

SAMPLE_HANDLER = 'outputs["result"] = inputs["brep"]'


@pytest_asyncio.fixture
async def cn_db(tmp_path: Path):
    db = CustomNodesDB(tmp_path / "test_cn.db")
    await db.init()
    yield db
    await db.close()


@pytest.mark.asyncio
async def test_save_and_get(cn_db: CustomNodesDB):
    node_id = await cn_db.save(
        name="fillet_edges",
        label="フィレット追加",
        schema_yaml=SAMPLE_SCHEMA,
        python_code=SAMPLE_HANDLER,
        category="cad",
        icon="rounded_corner",
    )
    assert node_id  # non-empty string

    row = await cn_db.get(node_id)
    assert row is not None
    assert row["name"] == "fillet_edges"
    assert row["label"] == "フィレット追加"
    assert row["category"] == "cad"
    assert row["icon"] == "rounded_corner"


@pytest.mark.asyncio
async def test_list_all(cn_db: CustomNodesDB):
    await cn_db.save(name="node_a", label="A", schema_yaml="a", python_code="a", category="cad")
    await cn_db.save(name="node_b", label="B", schema_yaml="b", python_code="b", category="cam")
    rows = await cn_db.list_all()
    assert len(rows) == 2


@pytest.mark.asyncio
async def test_update(cn_db: CustomNodesDB):
    node_id = await cn_db.save(name="node_x", label="X", schema_yaml="x", python_code="x", category="cad")
    await cn_db.update(node_id, label="X Updated", python_code="new code")
    row = await cn_db.get(node_id)
    assert row["label"] == "X Updated"
    assert row["python_code"] == "new code"


@pytest.mark.asyncio
async def test_delete(cn_db: CustomNodesDB):
    node_id = await cn_db.save(name="node_y", label="Y", schema_yaml="y", python_code="y", category="cad")
    deleted = await cn_db.delete(node_id)
    assert deleted is True
    assert await cn_db.get(node_id) is None


@pytest.mark.asyncio
async def test_delete_nonexistent(cn_db: CustomNodesDB):
    deleted = await cn_db.delete("nonexistent")
    assert deleted is False


@pytest.mark.asyncio
async def test_unique_name_constraint(cn_db: CustomNodesDB):
    await cn_db.save(name="unique_node", label="A", schema_yaml="a", python_code="a", category="cad")
    with pytest.raises(Exception):  # IntegrityError
        await cn_db.save(name="unique_node", label="B", schema_yaml="b", python_code="b", category="cad")
```

**Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_custom_nodes_db.py -v`
Expected: FAIL — `ImportError: cannot import name 'CustomNodesDB' from 'db'`

**Step 3: Write implementation**

`db.py` に `CustomNodesDB` クラスを追加。既存の `SnippetsDB` パターンを踏襲。

```python
# db.py に追加

_CUSTOM_NODES_SCHEMA = """
CREATE TABLE IF NOT EXISTS custom_nodes (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    schema_yaml TEXT NOT NULL,
    python_code TEXT NOT NULL,
    category TEXT DEFAULT 'custom',
    icon TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""


class CustomNodesDB:
    def __init__(self, db_path: str | Path):
        self._db_path = str(db_path)
        self._conn: aiosqlite.Connection | None = None

    async def init(self):
        self._conn = await aiosqlite.connect(self._db_path)
        self._conn.row_factory = aiosqlite.Row
        await self._conn.executescript(_CUSTOM_NODES_SCHEMA)
        await self._conn.commit()

    async def close(self):
        if self._conn:
            await self._conn.close()

    async def save(
        self,
        name: str,
        label: str,
        schema_yaml: str,
        python_code: str,
        category: str = "custom",
        icon: str | None = None,
    ) -> str:
        node_id = uuid.uuid4().hex[:12]
        now = datetime.utcnow().isoformat()
        await self._conn.execute(
            "INSERT INTO custom_nodes (id, name, label, schema_yaml, python_code, category, icon, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (node_id, name, label, schema_yaml, python_code, category, icon, now, now),
        )
        await self._conn.commit()
        return node_id

    async def get(self, node_id: str) -> dict | None:
        async with self._conn.execute("SELECT * FROM custom_nodes WHERE id = ?", (node_id,)) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None

    async def list_all(self) -> list[dict]:
        async with self._conn.execute("SELECT * FROM custom_nodes ORDER BY created_at DESC") as cur:
            return [dict(r) for r in await cur.fetchall()]

    async def update(self, node_id: str, **fields) -> bool:
        allowed = {"name", "label", "schema_yaml", "python_code", "category", "icon"}
        updates = {k: v for k, v in fields.items() if k in allowed}
        if not updates:
            return False
        updates["updated_at"] = datetime.utcnow().isoformat()
        cols = ", ".join(f"{k} = ?" for k in updates)
        vals = list(updates.values()) + [node_id]
        async with self._conn.execute(f"UPDATE custom_nodes SET {cols} WHERE id = ?", vals) as cur:
            await self._conn.commit()
            return cur.rowcount > 0

    async def delete(self, node_id: str) -> bool:
        async with self._conn.execute("DELETE FROM custom_nodes WHERE id = ?", (node_id,)) as cur:
            await self._conn.commit()
            return cur.rowcount > 0
```

**Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_custom_nodes_db.py -v`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add backend/db.py backend/tests/test_custom_nodes_db.py
git commit -m "feat(custom-node): add CustomNodesDB for node definition persistence"
```

---

### Task 3: Pydantic リクエスト/レスポンススキーマ

**Files:**
- Modify: `backend/schemas.py` — カスタムノード API 用スキーマを追加

**Step 1: Write the failing test**

```python
# backend/tests/test_custom_node_schema.py に追記

from schemas import CustomNodeSaveRequest, CustomNodeInfo, CustomNodeListResponse


def test_save_request_schema():
    req = CustomNodeSaveRequest(
        schema_yaml=FILLET_YAML,
    )
    assert req.schema_yaml == FILLET_YAML


def test_node_info_schema():
    info = CustomNodeInfo(
        id="abc123",
        name="fillet_edges",
        label="フィレット追加",
        schema_yaml=FILLET_YAML,
        python_code="pass",
        category="cad",
        icon="rounded_corner",
        created_at="2026-02-26T00:00:00",
        updated_at="2026-02-26T00:00:00",
    )
    assert info.id == "abc123"


def test_execute_request():
    from schemas import CustomNodeExecuteRequest
    req = CustomNodeExecuteRequest(
        node_id="abc123",
        inputs={"brep": {"file_id": "test-1", "objects": [], "object_count": 0}},
        params={"radius": 2.0},
    )
    assert req.params["radius"] == 2.0
```

**Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_custom_node_schema.py::test_save_request_schema -v`
Expected: FAIL — `ImportError`

**Step 3: Write implementation**

```python
# schemas.py に追加

class CustomNodeSaveRequest(BaseModel):
    schema_yaml: str  # フルYAML（バックエンドでparse & validate）

class CustomNodeUpdateRequest(BaseModel):
    schema_yaml: str

class CustomNodeInfo(BaseModel):
    id: str
    name: str
    label: str
    schema_yaml: str
    python_code: str
    category: str
    icon: str | None
    created_at: str
    updated_at: str

class CustomNodeListResponse(BaseModel):
    nodes: list[CustomNodeInfo]

class CustomNodeExecuteRequest(BaseModel):
    node_id: str
    inputs: dict[str, object] = {}   # ハンドル名 → 上流データ
    params: dict[str, object] = {}   # パラメータ名 → 値
```

**Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_custom_node_schema.py -v`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add backend/schemas.py
git commit -m "feat(custom-node): add API request/response schemas"
```

---

### Task 4: CRUD API エンドポイント

**Files:**
- Modify: `backend/main.py` — カスタムノード CRUD エンドポイントを追加
- Test: `backend/tests/test_custom_nodes_api.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_custom_nodes_api.py
import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from db import CustomNodesDB

FILLET_YAML = """
name: fillet_edges
label: "フィレット追加"
category: cad
inputs:
  - name: brep
    type: geometry
    label: "BREP"
outputs:
  - name: result
    type: geometry
    label: "Result"
params:
  - name: radius
    type: slider
    label: "Radius"
    default: 2.0
    min: 0.1
    max: 50.0
ui:
  template: form
handler: |
  outputs["result"] = inputs["brep"]
"""


@pytest.fixture
def client(tmp_path: Path):
    import main as main_module
    from main import app
    from fastapi.testclient import TestClient

    isolated_db = CustomNodesDB(tmp_path / "test_cn_api.db")
    asyncio.get_event_loop().run_until_complete(isolated_db.init())

    original = main_module._custom_nodes_db
    main_module._custom_nodes_db = isolated_db

    yield TestClient(app)

    main_module._custom_nodes_db = original
    asyncio.get_event_loop().run_until_complete(isolated_db.close())


def test_create_custom_node(client):
    resp = client.post("/custom-nodes/", json={"schema_yaml": FILLET_YAML})
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "fillet_edges"
    assert data["label"] == "フィレット追加"
    assert data["category"] == "cad"
    assert data["id"]


def test_create_invalid_yaml(client):
    resp = client.post("/custom-nodes/", json={"schema_yaml": "not: valid: yaml: [["})
    assert resp.status_code == 422


def test_create_invalid_schema(client):
    resp = client.post("/custom-nodes/", json={"schema_yaml": "name: 123\nlabel: bad\nhandler: pass\n"})
    assert resp.status_code == 422


def test_list_custom_nodes(client):
    client.post("/custom-nodes/", json={"schema_yaml": FILLET_YAML})
    resp = client.get("/custom-nodes/")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["nodes"]) == 1


def test_get_custom_node(client):
    create_resp = client.post("/custom-nodes/", json={"schema_yaml": FILLET_YAML})
    node_id = create_resp.json()["id"]
    resp = client.get(f"/custom-nodes/{node_id}")
    assert resp.status_code == 200
    assert resp.json()["name"] == "fillet_edges"


def test_get_nonexistent(client):
    resp = client.get("/custom-nodes/nonexistent")
    assert resp.status_code == 404


def test_update_custom_node(client):
    create_resp = client.post("/custom-nodes/", json={"schema_yaml": FILLET_YAML})
    node_id = create_resp.json()["id"]

    updated_yaml = FILLET_YAML.replace("フィレット追加", "Fillet Updated")
    resp = client.put(f"/custom-nodes/{node_id}", json={"schema_yaml": updated_yaml})
    assert resp.status_code == 200
    assert resp.json()["label"] == "Fillet Updated"


def test_delete_custom_node(client):
    create_resp = client.post("/custom-nodes/", json={"schema_yaml": FILLET_YAML})
    node_id = create_resp.json()["id"]
    resp = client.delete(f"/custom-nodes/{node_id}")
    assert resp.status_code == 200

    resp = client.get(f"/custom-nodes/{node_id}")
    assert resp.status_code == 404


def test_delete_nonexistent(client):
    resp = client.delete("/custom-nodes/nonexistent")
    assert resp.status_code == 404
```

**Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_custom_nodes_api.py -v`
Expected: FAIL

**Step 3: Write implementation**

`main.py` に追加:

```python
# --- グローバル変数 ---
_custom_nodes_db: CustomNodesDB | None = None

async def _get_custom_nodes_db() -> CustomNodesDB:
    global _custom_nodes_db
    if _custom_nodes_db is None:
        _custom_nodes_db = CustomNodesDB(DATA_DIR / "pathdesigner.db")
        await _custom_nodes_db.init()
    return _custom_nodes_db


# --- CRUD エンドポイント ---

@app.post("/custom-nodes/", response_model=CustomNodeInfo)
async def create_custom_node(req: CustomNodeSaveRequest):
    import yaml
    from custom_node_schema import CustomNodeSchema

    try:
        data = yaml.safe_load(req.schema_yaml)
    except yaml.YAMLError as e:
        raise HTTPException(status_code=422, detail=f"Invalid YAML: {e}")

    try:
        schema = CustomNodeSchema(**data)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Invalid schema: {e}")

    db = await _get_custom_nodes_db()
    node_id = await db.save(
        name=schema.name,
        label=schema.label,
        schema_yaml=req.schema_yaml,
        python_code=schema.handler,
        category=schema.category,
        icon=schema.icon,
    )
    row = await db.get(node_id)
    return CustomNodeInfo(
        id=row["id"], name=row["name"], label=row["label"],
        schema_yaml=row["schema_yaml"], python_code=row["python_code"],
        category=row["category"], icon=row["icon"],
        created_at=row["created_at"], updated_at=row["updated_at"],
    )


@app.get("/custom-nodes/", response_model=CustomNodeListResponse)
async def list_custom_nodes():
    db = await _get_custom_nodes_db()
    rows = await db.list_all()
    nodes = [
        CustomNodeInfo(
            id=r["id"], name=r["name"], label=r["label"],
            schema_yaml=r["schema_yaml"], python_code=r["python_code"],
            category=r["category"], icon=r["icon"],
            created_at=r["created_at"], updated_at=r["updated_at"],
        )
        for r in rows
    ]
    return CustomNodeListResponse(nodes=nodes)


@app.get("/custom-nodes/{node_id}", response_model=CustomNodeInfo)
async def get_custom_node(node_id: str):
    db = await _get_custom_nodes_db()
    row = await db.get(node_id)
    if not row:
        raise HTTPException(status_code=404, detail="Custom node not found")
    return CustomNodeInfo(
        id=row["id"], name=row["name"], label=row["label"],
        schema_yaml=row["schema_yaml"], python_code=row["python_code"],
        category=row["category"], icon=row["icon"],
        created_at=row["created_at"], updated_at=row["updated_at"],
    )


@app.put("/custom-nodes/{node_id}", response_model=CustomNodeInfo)
async def update_custom_node(node_id: str, req: CustomNodeUpdateRequest):
    import yaml
    from custom_node_schema import CustomNodeSchema

    try:
        data = yaml.safe_load(req.schema_yaml)
    except yaml.YAMLError as e:
        raise HTTPException(status_code=422, detail=f"Invalid YAML: {e}")

    try:
        schema = CustomNodeSchema(**data)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Invalid schema: {e}")

    db = await _get_custom_nodes_db()
    existing = await db.get(node_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Custom node not found")

    await db.update(
        node_id,
        name=schema.name,
        label=schema.label,
        schema_yaml=req.schema_yaml,
        python_code=schema.handler,
        category=schema.category,
        icon=schema.icon,
    )
    row = await db.get(node_id)
    return CustomNodeInfo(
        id=row["id"], name=row["name"], label=row["label"],
        schema_yaml=row["schema_yaml"], python_code=row["python_code"],
        category=row["category"], icon=row["icon"],
        created_at=row["created_at"], updated_at=row["updated_at"],
    )


@app.delete("/custom-nodes/{node_id}")
async def delete_custom_node(node_id: str):
    db = await _get_custom_nodes_db()
    deleted = await db.delete(node_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Custom node not found")
    return {"ok": True}
```

**Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_custom_nodes_api.py -v`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add backend/main.py backend/tests/test_custom_nodes_api.py
git commit -m "feat(custom-node): add CRUD API endpoints for custom node definitions"
```

---

### Task 5: カスタムノード実行エンドポイント

**Files:**
- Modify: `backend/main.py` — `/custom-nodes/execute` エンドポイントを追加
- Modify: `backend/nodes/ai_cad.py` — handler実行ラッパーを追加（`execute_custom_handler`）
- Test: `backend/tests/test_custom_nodes_api.py` に実行テストを追加

**Step 1: Write the failing test**

```python
# backend/tests/test_custom_nodes_api.py に追記

SIMPLE_PASSTHROUGH_YAML = """
name: simple_pass
label: "Simple Pass"
category: utility
inputs:
  - name: value
    type: number
    label: "Value"
outputs:
  - name: result
    type: number
    label: "Result"
params:
  - name: multiplier
    type: number
    label: "Multiplier"
    default: 2.0
handler: |
  outputs["result"] = inputs["value"] * params["multiplier"]
"""


def test_execute_custom_node(client):
    # 1. ノードを作成
    create_resp = client.post("/custom-nodes/", json={"schema_yaml": SIMPLE_PASSTHROUGH_YAML})
    node_id = create_resp.json()["id"]

    # 2. 実行
    resp = client.post("/custom-nodes/execute", json={
        "node_id": node_id,
        "inputs": {"value": 5},
        "params": {"multiplier": 3.0},
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["outputs"]["result"] == 15.0


def test_execute_nonexistent_node(client):
    resp = client.post("/custom-nodes/execute", json={
        "node_id": "nonexistent",
        "inputs": {},
        "params": {},
    })
    assert resp.status_code == 404


def test_execute_handler_error(client):
    error_yaml = """
name: error_node
label: "Error"
category: utility
inputs: []
outputs:
  - name: out
    type: number
    label: "Out"
handler: |
  raise ValueError("test error")
"""
    create_resp = client.post("/custom-nodes/", json={"schema_yaml": error_yaml})
    node_id = create_resp.json()["id"]

    resp = client.post("/custom-nodes/execute", json={
        "node_id": node_id,
        "inputs": {},
        "params": {},
    })
    assert resp.status_code == 422
    assert "test error" in resp.json()["detail"]


def test_execute_forbidden_code(client):
    forbidden_yaml = """
name: bad_node
label: "Bad"
category: utility
inputs: []
outputs:
  - name: out
    type: text
    label: "Out"
handler: |
  import os
  outputs["out"] = os.getcwd()
"""
    create_resp = client.post("/custom-nodes/", json={"schema_yaml": forbidden_yaml})
    node_id = create_resp.json()["id"]

    resp = client.post("/custom-nodes/execute", json={
        "node_id": node_id,
        "inputs": {},
        "params": {},
    })
    assert resp.status_code == 422
```

**Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_custom_nodes_api.py::test_execute_custom_node -v`
Expected: FAIL

**Step 3: Write implementation**

`backend/nodes/ai_cad.py` に追加:
```python
def execute_custom_handler(
    code: str,
    inputs: dict[str, object],
    params: dict[str, object],
) -> dict[str, object]:
    """カスタムノードのhandlerコードを実行する。

    Returns: outputs dict
    Raises: CodeExecutionError
    """
    if _FORBIDDEN_PATTERNS.search(code):
        raise CodeExecutionError("Forbidden code pattern detected")

    outputs: dict[str, object] = {}
    exec_globals = {
        "__builtins__": __builtins__,
        "inputs": inputs,
        "params": params,
        "outputs": outputs,
    }
    # build123d もグローバルに入れる（CADノードで使えるように）
    try:
        import build123d
        for name in dir(build123d):
            if not name.startswith("_"):
                exec_globals[name] = getattr(build123d, name)
    except ImportError:
        pass

    try:
        exec(code, exec_globals)
    except SyntaxError as e:
        raise CodeExecutionError(f"Syntax error: {e}")
    except CodeExecutionError:
        raise
    except Exception as e:
        raise CodeExecutionError(f"Execution error: {e}")

    return outputs
```

`main.py` に追加:
```python
from schemas import CustomNodeExecuteRequest

@app.post("/custom-nodes/execute")
async def execute_custom_node(req: CustomNodeExecuteRequest):
    from nodes.ai_cad import execute_custom_handler, CodeExecutionError

    db = await _get_custom_nodes_db()
    row = await db.get(req.node_id)
    if not row:
        raise HTTPException(status_code=404, detail="Custom node not found")

    try:
        result = execute_custom_handler(
            code=row["python_code"],
            inputs=req.inputs,
            params=req.params,
        )
    except CodeExecutionError as e:
        raise HTTPException(status_code=422, detail=str(e))

    return {"outputs": result}
```

**Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_custom_nodes_api.py -v`
Expected: ALL PASS

**Step 5: Run full test suite**

Run: `cd backend && uv run pytest tests/ -v`
Expected: ALL PASS（既存テストに影響なし）

**Step 6: Commit**

```bash
git add backend/nodes/ai_cad.py backend/main.py backend/tests/test_custom_nodes_api.py
git commit -m "feat(custom-node): add execute endpoint for custom node handlers"
```

---

## Phase 2: フロントエンド動的レンダリング（概要）

### Task 6: カスタムノード API クライアント
- **Files:** `frontend/src/api.ts`
- カスタムノード CRUD + execute の API 関数を追加
- `fetchCustomNodes()`, `createCustomNode()`, `executeCustomNode()` 等

### Task 7: カスタムノード TypeScript 型定義
- **Files:** `frontend/src/types.ts`
- `CustomNodeSchema`, `CustomNodeInfo`, `NodeInput`, `NodeOutput`, `NodeParam` 等

### Task 8: DynamicNodeRenderer コンポーネント
- **Files:** Create `frontend/src/nodes/DynamicNode.tsx`
- スキーマから動的にノードUIを生成するコンポーネント
- `LabeledHandle` を `inputs`/`outputs` 配列から動的に配置
- `NodeShell` でラップ、`node_summary` テンプレートを展開
- ノードクリック時にパネルを開く

### Task 9: DynamicNodePanel — form テンプレート実装
- **Files:** Create `frontend/src/nodes/DynamicNodePanel.tsx`
- `params` 配列から自動フォーム生成
- param type → UI コンポーネント マッピング（number→input, slider→range, select→dropdown, boolean→checkbox）
- パラメータ変更 → executeCustomNode → outputs を node.data に書き込み

### Task 10: nodeRegistry への動的登録
- **Files:** Modify `frontend/src/nodeRegistry.ts`, `frontend/src/App.tsx`
- 起動時に `GET /custom-nodes/` を呼び、動的に nodeTypes に登録
- Sidebar にカスタムノードカテゴリを追加

---

## Phase 3: AI統合（概要）

### Task 11: Node Builder バックエンド
- **Files:** Modify `backend/main.py`, `backend/llm_client.py`
- `POST /custom-nodes/generate` — SSEストリーミングでスキーマ+handler生成
- Stage 1 (Gemini): ユーザー要求 → スキーマYAML生成
- Stage 2 (Qwen): スキーマ → Python handler実装

### Task 12: Node Builder Panel フロントエンド
- **Files:** Create `frontend/src/nodes/NodeBuilderPanel.tsx`
- チャットUIでAIと対話してノードを定義
- スキーマプレビュー + コードプレビュー
- 「作成」ボタンで保存 → サイドバーに即追加

---

## Phase 4: 追加UIテンプレート（概要）

### Task 13: canvas テンプレート
- ノード内ミニプレビュー（Canvas 2D）
- パネル内フルサイズCanvas

### Task 14: composite テンプレート
- タブ切替で複数パネルを管理
- 既存AiCadNodeのパターンを汎用化

### Task 15: passthrough テンプレート
- ハンドルのみ、UIなし
- データ変換・フィルター用

---

## Phase 5: 既存ノード移行（概要・オプション）

### Task 16: SheetNode をスキーマベースに移行（PoC）
- 最もシンプルな既存ノードをカスタムノード基盤で再実装
- 互換性検証、パフォーマンス比較

### Task 17: 段階的な既存ノード移行計画
- 移行対象の優先順位付け
- 移行ガイドライン策定
