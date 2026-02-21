# Phase 3: 加工設定ノード Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 加工パラメータを入力できるMachiningSettingsNodeを実装し、素材プリセット+バックエンドバリデーションで設定を管理する。

**Architecture:** バックエンドにYAMLプリセットファイルとGET/POSTの2エンドポイントを追加。フロントエンドに折りたたみセクション付きフォームUIのカスタムノードを作成。設定はReact Flowエッジ経由でContourExtractNodeに流す。

**Tech Stack:** FastAPI, Pydantic, PyYAML / React, TypeScript, @xyflow/react

---

### Task 1: Backend — Pydantic スキーマ追加

**Files:**
- Modify: `backend/schemas.py:73` (末尾に追加)
- Test: `backend/tests/test_machining_settings.py` (新規)

**Step 1: テストファイルを作成**

`backend/tests/test_machining_settings.py`:
```python
"""Tests for machining settings schemas and validation."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from schemas import MachiningSettings, Tool, FeedRate, TabSettings


def test_machining_settings_defaults():
    """MachiningSettings can be created with all required fields."""
    settings = MachiningSettings(
        operation_type="contour",
        tool=Tool(diameter=6.35, type="endmill", flutes=2),
        feed_rate=FeedRate(xy=75.0, z=25.0),
        jog_speed=200.0,
        spindle_speed=18000,
        depth_per_pass=6.0,
        total_depth=12.0,
        direction="climb",
        offset_side="outside",
        tabs=TabSettings(enabled=True, height=3.0, width=5.0, count=4),
    )
    assert settings.operation_type == "contour"
    assert settings.tool.diameter == 6.35
    assert settings.tabs.enabled is True


def test_machining_settings_serialization():
    """MachiningSettings round-trips through JSON."""
    settings = MachiningSettings(
        operation_type="contour",
        tool=Tool(diameter=6.35, type="endmill", flutes=2),
        feed_rate=FeedRate(xy=75.0, z=25.0),
        jog_speed=200.0,
        spindle_speed=18000,
        depth_per_pass=6.0,
        total_depth=12.0,
        direction="climb",
        offset_side="outside",
        tabs=TabSettings(enabled=False, height=0, width=0, count=0),
    )
    data = settings.model_dump()
    restored = MachiningSettings(**data)
    assert restored == settings
```

**Step 2: テストが失敗することを確認**

Run: `cd backend && uv run pytest tests/test_machining_settings.py -v`
Expected: FAIL — `ImportError: cannot import name 'MachiningSettings'`

**Step 3: スキーマを実装**

`backend/schemas.py` の末尾に追加:
```python
# --- Node 3: Machining Settings ---


class Tool(BaseModel):
    diameter: float  # mm
    type: str  # "endmill" | "ballnose" | "v_bit"
    flutes: int


class FeedRate(BaseModel):
    xy: float  # mm/s
    z: float  # mm/s


class TabSettings(BaseModel):
    enabled: bool
    height: float  # mm
    width: float  # mm
    count: int


class MachiningSettings(BaseModel):
    operation_type: str  # "contour" | "pocket" | "drill" | "engrave"
    tool: Tool
    feed_rate: FeedRate
    jog_speed: float  # mm/s
    spindle_speed: int  # RPM
    depth_per_pass: float  # mm
    total_depth: float  # mm
    direction: str  # "climb" | "conventional"
    offset_side: str  # "outside" | "inside" | "none"
    tabs: TabSettings


class PresetItem(BaseModel):
    id: str
    name: str
    material: str
    settings: MachiningSettings


class ValidateSettingsRequest(BaseModel):
    settings: MachiningSettings


class ValidateSettingsResponse(BaseModel):
    valid: bool
    settings: MachiningSettings
    warnings: list[str]
```

**Step 4: テストが通ることを確認**

Run: `cd backend && uv run pytest tests/test_machining_settings.py -v`
Expected: PASS (2 tests)

**Step 5: コミット**

```bash
git add backend/schemas.py backend/tests/test_machining_settings.py
git commit -m "Phase 3: Add Pydantic schemas for machining settings (#3)"
```

---

### Task 2: Backend — プリセットYAML + GET /api/presets

**Files:**
- Create: `backend/presets/materials.yaml`
- Modify: `backend/main.py`
- Test: `backend/tests/test_machining_settings.py` (追加)

**Step 1: テストを追加**

`backend/tests/test_machining_settings.py` に追加:
```python
import yaml
from pathlib import Path

PRESETS_DIR = Path(__file__).parent.parent / "presets"


def test_presets_yaml_valid():
    """Presets YAML loads and each preset produces valid MachiningSettings."""
    yaml_path = PRESETS_DIR / "materials.yaml"
    assert yaml_path.exists(), "materials.yaml not found"

    data = yaml.safe_load(yaml_path.read_text())
    assert "presets" in data
    assert len(data["presets"]) >= 1

    for p in data["presets"]:
        # Each preset must have id, name, material, and valid settings fields
        assert "id" in p
        assert "name" in p
        settings_fields = {k: v for k, v in p.items() if k not in ("id", "name", "material")}
        MachiningSettings(**settings_fields)
```

**Step 2: テストが失敗することを確認**

Run: `cd backend && uv run pytest tests/test_machining_settings.py::test_presets_yaml_valid -v`
Expected: FAIL — `materials.yaml not found`

**Step 3: プリセットYAMLを作成**

`backend/presets/materials.yaml`:
```yaml
presets:
  - id: plywood_12mm
    name: "合板 12mm"
    material: plywood
    operation_type: contour
    tool:
      diameter: 6.35
      type: endmill
      flutes: 2
    feed_rate:
      xy: 75.0
      z: 25.0
    jog_speed: 200.0
    spindle_speed: 18000
    depth_per_pass: 6.0
    total_depth: 12.0
    direction: climb
    offset_side: outside
    tabs:
      enabled: true
      height: 3.0
      width: 5.0
      count: 4

  - id: mdf_18mm
    name: "MDF 18mm"
    material: mdf
    operation_type: contour
    tool:
      diameter: 6.35
      type: endmill
      flutes: 2
    feed_rate:
      xy: 60.0
      z: 20.0
    jog_speed: 200.0
    spindle_speed: 16000
    depth_per_pass: 4.0
    total_depth: 18.0
    direction: climb
    offset_side: outside
    tabs:
      enabled: true
      height: 4.0
      width: 5.0
      count: 6

  - id: acrylic_5mm
    name: "アクリル 5mm"
    material: acrylic
    operation_type: contour
    tool:
      diameter: 3.175
      type: endmill
      flutes: 1
    feed_rate:
      xy: 30.0
      z: 10.0
    jog_speed: 150.0
    spindle_speed: 18000
    depth_per_pass: 1.5
    total_depth: 5.0
    direction: climb
    offset_side: outside
    tabs:
      enabled: true
      height: 2.0
      width: 3.0
      count: 4
```

**Step 4: YAMLテストが通ることを確認**

Run: `cd backend && uv run pytest tests/test_machining_settings.py::test_presets_yaml_valid -v`
Expected: PASS

**Step 5: APIエンドポイントのテストを追加**

`backend/tests/test_machining_settings.py` に追加:
```python
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_get_presets_endpoint():
    """GET /api/presets returns preset list."""
    res = client.get("/api/presets")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    first = data[0]
    assert "id" in first
    assert "name" in first
    assert "settings" in first
```

**Step 6: APIテストが失敗することを確認**

Run: `cd backend && uv run pytest tests/test_machining_settings.py::test_get_presets_endpoint -v`
Expected: FAIL — 404

**Step 7: GET /api/presets エンドポイントを実装**

`backend/main.py` に追加:

import追加:
```python
import yaml
from schemas import (
    BrepImportResult, ContourExtractRequest, ContourExtractResult,
    MachiningSettings, PresetItem,
)
```

PRESETS_DIR定義 (UPLOAD_DIR の下あたり):
```python
PRESETS_DIR = Path(__file__).parent / "presets"
```

エンドポイント追加:
```python
@app.get("/api/presets", response_model=list[PresetItem])
def get_presets():
    """Return available machining presets."""
    yaml_path = PRESETS_DIR / "materials.yaml"
    if not yaml_path.exists():
        return []
    data = yaml.safe_load(yaml_path.read_text())
    result = []
    for p in data.get("presets", []):
        preset_id = p["id"]
        name = p["name"]
        material = p.get("material", "unknown")
        settings_fields = {k: v for k, v in p.items() if k not in ("id", "name", "material")}
        result.append(PresetItem(
            id=preset_id,
            name=name,
            material=material,
            settings=MachiningSettings(**settings_fields),
        ))
    return result
```

**Step 8: APIテストが通ることを確認**

Run: `cd backend && uv run pytest tests/test_machining_settings.py -v`
Expected: PASS (4 tests)

**Step 9: コミット**

```bash
git add backend/presets/materials.yaml backend/main.py backend/tests/test_machining_settings.py
git commit -m "Phase 3: Add presets YAML and GET /api/presets endpoint (#3)"
```

---

### Task 3: Backend — POST /api/validate-settings

**Files:**
- Modify: `backend/main.py`
- Test: `backend/tests/test_machining_settings.py` (追加)

**Step 1: バリデーションテストを追加**

`backend/tests/test_machining_settings.py` に追加:
```python
def _make_settings(**overrides):
    """Helper to create a valid settings dict with overrides."""
    base = {
        "operation_type": "contour",
        "tool": {"diameter": 6.35, "type": "endmill", "flutes": 2},
        "feed_rate": {"xy": 75.0, "z": 25.0},
        "jog_speed": 200.0,
        "spindle_speed": 18000,
        "depth_per_pass": 6.0,
        "total_depth": 12.0,
        "direction": "climb",
        "offset_side": "outside",
        "tabs": {"enabled": True, "height": 3.0, "width": 5.0, "count": 4},
    }
    for key, val in overrides.items():
        if isinstance(val, dict) and key in base and isinstance(base[key], dict):
            base[key].update(val)
        else:
            base[key] = val
    return base


def test_validate_settings_valid():
    """Valid settings return valid=True with no warnings."""
    res = client.post("/api/validate-settings", json={"settings": _make_settings()})
    assert res.status_code == 200
    data = res.json()
    assert data["valid"] is True
    assert data["warnings"] == []


def test_validate_settings_low_spindle():
    """Low spindle speed produces a warning."""
    res = client.post(
        "/api/validate-settings",
        json={"settings": _make_settings(spindle_speed=3000)},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["valid"] is True  # warning, not error
    assert any("spindle" in w.lower() for w in data["warnings"])


def test_validate_settings_depth_exceeds_total():
    """depth_per_pass > total_depth produces a warning."""
    res = client.post(
        "/api/validate-settings",
        json={"settings": _make_settings(depth_per_pass=20.0, total_depth=12.0)},
    )
    assert res.status_code == 200
    data = res.json()
    assert any("depth" in w.lower() for w in data["warnings"])
```

**Step 2: テストが失敗することを確認**

Run: `cd backend && uv run pytest tests/test_machining_settings.py::test_validate_settings_valid -v`
Expected: FAIL — 404

**Step 3: POST /api/validate-settings を実装**

`backend/main.py` に追加:

import追加:
```python
from schemas import ValidateSettingsRequest, ValidateSettingsResponse
```

エンドポイント追加:
```python
@app.post("/api/validate-settings", response_model=ValidateSettingsResponse)
def validate_settings(req: ValidateSettingsRequest):
    """Validate machining settings and return warnings."""
    s = req.settings
    warnings: list[str] = []

    if s.spindle_speed < 5000:
        warnings.append(f"スピンドル速度が低すぎます ({s.spindle_speed} RPM < 5000)")
    if s.depth_per_pass > s.total_depth:
        warnings.append(
            f"パスあたりの深さ ({s.depth_per_pass}mm) が合計深さ ({s.total_depth}mm) を超えています"
        )
    if s.feed_rate.xy <= 0 or s.feed_rate.z <= 0:
        warnings.append("送り速度は正の値を指定してください")
    if s.tool.diameter <= 0:
        warnings.append("刃物径は正の値を指定してください")

    return ValidateSettingsResponse(
        valid=True,
        settings=s,
        warnings=warnings,
    )
```

**Step 4: テストが通ることを確認**

Run: `cd backend && uv run pytest tests/test_machining_settings.py -v`
Expected: PASS (7 tests)

**Step 5: コミット**

```bash
git add backend/main.py backend/tests/test_machining_settings.py
git commit -m "Phase 3: Add POST /api/validate-settings endpoint (#3)"
```

---

### Task 4: Frontend — TypeScript型 + API関数

**Files:**
- Modify: `frontend/src/types.ts:59` (末尾に追加)
- Modify: `frontend/src/api.ts:45` (末尾に追加)

**Step 1: TypeScript型を追加**

`frontend/src/types.ts` の末尾に追加:
```typescript
/** Node 3: Machining Settings types */

export interface Tool {
  diameter: number;
  type: string; // "endmill" | "ballnose" | "v_bit"
  flutes: number;
}

export interface FeedRate {
  xy: number; // mm/s
  z: number;  // mm/s
}

export interface TabSettings {
  enabled: boolean;
  height: number; // mm
  width: number;  // mm
  count: number;
}

export interface MachiningSettings {
  operation_type: string; // "contour" | "pocket" | "drill" | "engrave"
  tool: Tool;
  feed_rate: FeedRate;
  jog_speed: number;
  spindle_speed: number;
  depth_per_pass: number;
  total_depth: number;
  direction: string; // "climb" | "conventional"
  offset_side: string; // "outside" | "inside" | "none"
  tabs: TabSettings;
}

export interface PresetItem {
  id: string;
  name: string;
  material: string;
  settings: MachiningSettings;
}

export interface ValidateSettingsResponse {
  valid: boolean;
  settings: MachiningSettings;
  warnings: string[];
}
```

**Step 2: API関数を追加**

`frontend/src/api.ts` の末尾に追加:
```typescript
import type { PresetItem, ValidateSettingsResponse, MachiningSettings } from "./types";

export async function fetchPresets(): Promise<PresetItem[]> {
  const res = await fetch(`${API_URL}/api/presets`);
  if (!res.ok) {
    throw new Error(`Failed to fetch presets: HTTP ${res.status}`);
  }
  return res.json();
}

export async function validateSettings(
  settings: MachiningSettings
): Promise<ValidateSettingsResponse> {
  const res = await fetch(`${API_URL}/api/validate-settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Validation failed" }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}
```

注意: `api.ts` の既存import行を更新して型をまとめる:
```typescript
import type { BrepImportResult, ContourExtractResult, PresetItem, ValidateSettingsResponse, MachiningSettings } from "./types";
```

**Step 3: TypeScriptビルドが通ることを確認**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 4: コミット**

```bash
git add frontend/src/types.ts frontend/src/api.ts
git commit -m "Phase 3: Add frontend types and API for machining settings (#3)"
```

---

### Task 5: Frontend — MachiningSettingsNode コンポーネント

**Files:**
- Create: `frontend/src/nodes/MachiningSettingsNode.tsx`

**Step 1: コンポーネントを作成**

`frontend/src/nodes/MachiningSettingsNode.tsx`:

既存ノード（ContourExtractNode）のスタイルパターンに従う。折りたたみセクションUIで以下を含む:

- プリセット選択ドロップダウン（`fetchPresets()` でロード）
- Cutting セクション: operation_type, direction, offset_side
- Tool & Speed セクション: tool.diameter, feed_rate.xy/z, jog_speed, spindle_speed
- Depth セクション: depth_per_pass, total_depth
- Tabs セクション: enabled, height, width, count
- 警告表示エリア
- source Handle (settings dataType)

主な動作:
- マウント時に `fetchPresets()` でプリセットをロード
- プリセット選択時に全フィールドを反映
- 値変更時に `data.machiningSettings` をノードデータに保存
- 値変更時に `validateSettings()` を呼び、警告を表示（debounce 500ms）

コンポーネントの構造:
```tsx
import { useCallback, useEffect, useState } from "react";
import { Position, type NodeProps, useReactFlow } from "@xyflow/react";
import { fetchPresets, validateSettings } from "../api";
import type { MachiningSettings, PresetItem } from "../types";
import LabeledHandle from "./LabeledHandle";

const DEFAULT_SETTINGS: MachiningSettings = {
  operation_type: "contour",
  tool: { diameter: 6.35, type: "endmill", flutes: 2 },
  feed_rate: { xy: 75.0, z: 25.0 },
  jog_speed: 200.0,
  spindle_speed: 18000,
  depth_per_pass: 6.0,
  total_depth: 12.0,
  direction: "climb",
  offset_side: "outside",
  tabs: { enabled: true, height: 3.0, width: 5.0, count: 4 },
};

export default function MachiningSettingsNode({ id }: NodeProps) {
  const { setNodes } = useReactFlow();
  const [settings, setSettings] = useState<MachiningSettings>(DEFAULT_SETTINGS);
  const [presets, setPresets] = useState<PresetItem[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    cutting: true,
    toolSpeed: true,
    depth: false,
    tabs: false,
  });

  // Load presets on mount
  useEffect(() => {
    fetchPresets().then(setPresets).catch(console.error);
  }, []);

  // Sync settings to node data
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, machiningSettings: settings } } : n
      )
    );
  }, [id, settings, setNodes]);

  // Validate on settings change (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      validateSettings(settings)
        .then((res) => setWarnings(res.warnings))
        .catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [settings]);

  const handlePresetChange = useCallback((presetId: string) => {
    const preset = presets.find((p) => p.id === presetId);
    if (preset) setSettings(preset.settings);
  }, [presets]);

  const toggleSection = useCallback((key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const updateField = useCallback(<K extends keyof MachiningSettings>(
    key: K, value: MachiningSettings[K]
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  // ... render with sections (see full component in implementation)
}
```

各セクションの入力フィールド:
- `<select>` — operation_type, direction, offset_side, preset
- `<input type="number">` — 数値フィールド全般
- チェックボックス — tabs.enabled

スタイルは既存ノードの `nodeStyle`, `headerStyle` パターンに合わせる。
セクションヘッダーはクリックで開閉。`▼` / `▶` を先頭に表示。

**Step 2: TypeScriptビルドが通ることを確認**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: コミット**

```bash
git add frontend/src/nodes/MachiningSettingsNode.tsx
git commit -m "Phase 3: Add MachiningSettingsNode React Flow component (#3)"
```

---

### Task 6: Frontend — App.tsx + Sidebar 統合

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/Sidebar.tsx`

**Step 1: App.tsx を更新**

import追加:
```typescript
import MachiningSettingsNode from "./nodes/MachiningSettingsNode";
```

nodeTypes に追加:
```typescript
const nodeTypes = {
  brepImport: BrepImportNode,
  contourExtract: ContourExtractNode,
  machiningSettings: MachiningSettingsNode,
  debug: DebugNode,
};
```

initialNodes の id="3" を更新:
```typescript
{
  id: "3",
  type: "machiningSettings",
  position: { x: 350, y: 350 },
  data: {},
},
```

initialEdges の e3-2 を更新（sourceHandle追加）:
```typescript
{ id: "e3-2", source: "3", sourceHandle: "3-out", target: "2", targetHandle: "2-settings" },
```

**Step 2: Sidebar.tsx を更新**

nodeItems に追加:
```typescript
{ type: "machiningSettings", label: "Machining Settings", color: "#66bb6a" },
```

**Step 3: TypeScriptビルドが通ることを確認**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 4: コミット**

```bash
git add frontend/src/App.tsx frontend/src/Sidebar.tsx
git commit -m "Phase 3: Integrate MachiningSettingsNode into React Flow canvas (#3)"
```

---

### Task 7: ContourExtractNode — upstream settings 読み取り

**Files:**
- Modify: `frontend/src/nodes/ContourExtractNode.tsx`

**Step 1: ContourExtractNode を更新**

`handleExtract` 内で、settings ハンドルから upstream の MachiningSettings を読み取り、`extractContours()` の引数に渡す:

```typescript
// After getting brepData, read machining settings from upstream
const settingsEdge = edges.find(
  (e) => e.target === id && e.targetHandle === `${id}-settings`
);
const settingsNode = settingsEdge ? getNode(settingsEdge.source) : null;
const machiningSettings = settingsNode?.data?.machiningSettings as
  | { tool: { diameter: number }; offset_side: string }
  | undefined;

const toolDiameter = machiningSettings?.tool?.diameter ?? 6.35;
const offsetSide = machiningSettings?.offset_side ?? "outside";
```

`extractContours()` 呼び出しを更新:
```typescript
extractContours(brepData.file_id, obj.object_id, toolDiameter, offsetSide)
```

**Step 2: TypeScriptビルドが通ることを確認**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: コミット**

```bash
git add frontend/src/nodes/ContourExtractNode.tsx
git commit -m "Phase 3: ContourExtractNode reads upstream machining settings (#3)"
```

---

### Task 8: 統合テスト — make dev で動作確認

**Step 1: PyYAML依存を追加**

Run: `cd backend && uv add pyyaml`

注意: これはTask 2の前に行っても良い。テスト実行時にimportエラーが出たら先に追加する。

**Step 2: 全バックエンドテスト実行**

Run: `cd backend && uv run pytest tests/ -v`
Expected: PASS (全テスト)

**Step 3: フロントエンドビルド確認**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 4: make dev で起動、手動確認**

Run: `make dev`

確認項目:
- [ ] Sidebar に "Machining Settings" が表示される
- [ ] キャンバス上の id=3 ノードが MachiningSettingsNode になっている
- [ ] プリセット選択で値が反映される
- [ ] 各セクションが開閉できる
- [ ] 値を変更すると警告が表示される（例: spindle_speed を 3000 に変更）
- [ ] BREP Import → Machining Settings → Contour Extract の接続で、settings の tool_diameter が反映される

**Step 5: 最終コミット（必要に応じて修正後）**

```bash
git add -A
git commit -m "Phase 3: Integration fixes for machining settings (#3)"
```
