# Phase 2 リファクタ: OperationNode 3D 対応 — 実装プラン

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** OperationNode を 3D 加工（3d_roughing）に対応させ、ThreeDMillingNode から設定 UI を除去して ToolpathGenNode と同じ「Generate のみ」パターンに統一する。

**Architecture:** OperationNode が upstream の `machining_type` を判定し、`"3d"` の場合はバックエンド detect-operations を呼ばずローカルで `3d_roughing` オペレーションを生成する。MachiningSettings に `z_step`, `stock_to_leave` を追加し、OperationDetailPanel に 3D 専用の設定 UI を表示する。ThreeDMillingNode は upstream から設定を読み、Generate ボタン + 結果表示のみに簡素化する。

**Tech Stack:** FastAPI (Python/Pydantic), React + TypeScript, React Flow

---

## Task 1: バックエンド — MachiningSettings に 3d_roughing 追加

**Files:**
- Modify: `backend/schemas.py`
- Test: `backend/tests/test_schemas_3d.py` (new)

**Step 1: テスト作成**

`backend/tests/test_schemas_3d.py`:
```python
"""Tests for 3D roughing schema additions."""
from schemas import MachiningSettings, DetectedOperation, default_settings_for, OperationGeometry, OffsetApplied, Contour


def test_3d_roughing_default_settings():
    settings = default_settings_for("3d_roughing")
    assert settings.operation_type == "3d_roughing"
    assert settings.tool.type == "ballnose"
    assert settings.tool.diameter == 6.35
    assert settings.z_step == 3.0
    assert settings.stock_to_leave == 0.5


def test_3d_roughing_machining_settings_valid():
    s = default_settings_for("3d_roughing")
    assert isinstance(s, MachiningSettings)
    assert s.z_step == 3.0
    assert s.stock_to_leave == 0.5


def test_2d_settings_ignore_3d_fields():
    s = default_settings_for("contour")
    assert s.z_step == 0  # default 0 for 2D
    assert s.stock_to_leave == 0  # default 0 for 2D


def test_detected_operation_3d_roughing():
    settings = default_settings_for("3d_roughing")
    op = DetectedOperation(
        operation_id="op_001",
        object_id="obj_1",
        operation_type="3d_roughing",
        geometry=OperationGeometry(
            contours=[],
            offset_applied=OffsetApplied(distance=0, side="none"),
            depth=50.0,
        ),
        suggested_settings=settings,
    )
    assert op.operation_type == "3d_roughing"
```

**Step 2: テスト実行して失敗を確認**

Run: `cd backend && uv run pytest tests/test_schemas_3d.py -v`
Expected: FAIL — `"3d_roughing"` が Literal に含まれていないため

**Step 3: schemas.py を修正**

`backend/schemas.py` の変更:

1. `MachiningSettings.operation_type` の Literal に `"3d_roughing"` 追加
2. `MachiningSettings` に `z_step: float = 0` と `stock_to_leave: float = 0` 追加
3. `DetectedOperation.operation_type` の Literal に `"3d_roughing"` 追加
4. `_DEFAULT_SETTINGS["3d_roughing"]` 追加（ballnose 6.35mm）

具体的な変更:

```python
# MachiningSettings.operation_type
operation_type: Literal["contour", "pocket", "drill", "engrave", "3d_roughing"]

# MachiningSettings に追加（depth_per_peck の後）
# 3D roughing-specific
z_step: float = 0  # mm, Z-axis step per waterline level (0 = unused for 2D)
stock_to_leave: float = 0  # mm, remaining material thickness (0 = unused for 2D)

# DetectedOperation.operation_type
operation_type: Literal["contour", "pocket", "drill", "engrave", "3d_roughing"]

# _DEFAULT_SETTINGS に追加
"3d_roughing": dict(
    operation_type="3d_roughing",
    tool=Tool(diameter=6.35, type="ballnose", flutes=2),
    feed_rate=FeedRate(xy=50, z=20),
    jog_speed=200,
    spindle_speed=18000,
    depth_per_pass=3.0,
    total_depth=50.0,
    direction="climb",
    offset_side="none",
    tabs=_DEFAULT_TABS_OFF,
    z_step=3.0,
    stock_to_leave=0.5,
),
```

**Step 4: テスト実行して成功を確認**

Run: `cd backend && uv run pytest tests/test_schemas_3d.py -v`
Expected: 4 passed

**Step 5: 既存テスト全件パス確認**

Run: `cd backend && uv run pytest tests/ -v`
Expected: All passed (245+)

**Step 6: コミット**

```bash
git add backend/schemas.py backend/tests/test_schemas_3d.py
git commit -m "feat(Phase2): add 3d_roughing to MachiningSettings + DetectedOperation (#58)"
```

---

## Task 2: フロントエンド types.ts — 3d_roughing 対応

**Files:**
- Modify: `frontend/src/types.ts`

**Step 1: types.ts 更新**

```typescript
// MachiningSettings.operation_type に "3d_roughing" 追加
export interface MachiningSettings {
  operation_type: "contour" | "pocket" | "drill" | "engrave" | "3d_roughing";
  // ... existing fields ...
  // 3D roughing-specific (after depth_per_peck)
  z_step?: number;
  stock_to_leave?: number;
}

// DetectedOperation.operation_type に "3d_roughing" 追加
export interface DetectedOperation {
  operation_id: string;
  object_id: string;
  operation_type: "contour" | "pocket" | "drill" | "engrave" | "3d_roughing";
  geometry: OperationGeometry;
  suggested_settings: MachiningSettings;
  enabled: boolean;
}
```

**Step 2: ビルド確認**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: コミット**

```bash
git add frontend/src/types.ts
git commit -m "feat(Phase2): add 3d_roughing to frontend types (#58)"
```

---

## Task 3: OperationNode — 3D ローカル検出

**Files:**
- Modify: `frontend/src/nodes/OperationNode.tsx`

**Step 1: OperationNode を修正**

OperationNode の `useEffect`（auto-detect）内に分岐を追加：

- upstream の objects で `machining_type === "3d"` のオブジェクトがある場合、detect-operations API を呼ばずローカルで DetectedOperation を生成
- `machining_type !== "3d"` のオブジェクトは既存通り detectOperations API を呼ぶ
- 両方混在する場合は、3D はローカル、2D は API で検出し、結果をマージ

具体的な変更（useEffect 内）:

```typescript
// objects を 3D と 2D に分類
const obj3d = objects.filter((o) => o.machining_type === "3d");
const obj2d = objects.filter((o) => o.machining_type !== "3d");

// 3D objects: ローカルで DetectedOperation 生成
const local3dOps: DetectedOperation[] = obj3d.map((obj, i) => ({
  operation_id: `op_3d_${obj.object_id}_${i}`,
  object_id: obj.object_id,
  operation_type: "3d_roughing" as const,
  geometry: {
    contours: [],
    offset_applied: { distance: 0, side: "none" as const },
    depth: obj.thickness,
  },
  suggested_settings: {
    operation_type: "3d_roughing" as const,
    tool: { diameter: 6.35, type: "ballnose" as const, flutes: 2 },
    feed_rate: { xy: 50, z: 20 },
    jog_speed: 200,
    spindle_speed: 18000,
    depth_per_pass: 3.0,
    total_depth: obj.thickness,
    direction: "climb" as const,
    offset_side: "none" as const,
    tabs: { enabled: false, height: 0, width: 0, count: 0 },
    z_step: 3.0,
    stock_to_leave: 0.5,
  },
  enabled: true,
}));

// 2D objects: API 検出（既存ロジック）
let api2dOps: DetectedOperation[] = [];
if (obj2d.length > 0) {
  const apiResult = await detectOperations(fileId, obj2d.map((o) => o.object_id));
  api2dOps = apiResult.operations;
}

// マージ
const allOps = [...local3dOps, ...api2dOps];
const mergedResult: OperationDetectResult = { operations: allOps };
```

残りのロジック（assignments 生成、syncToNodeData）はそのまま。

**Step 2: ビルド確認**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: コミット**

```bash
git add frontend/src/nodes/OperationNode.tsx
git commit -m "feat(Phase2): OperationNode local 3d_roughing detection (#58)"
```

---

## Task 4: OperationDetailPanel — 3d_roughing 設定 UI

**Files:**
- Modify: `frontend/src/components/OperationDetailPanel.tsx`

**Step 1: 3d_roughing 用設定セクション追加**

OperationDetailPanel の設定フィールド部分に `group.operation_type === "3d_roughing"` の分岐を追加。

2D 固有フィールド（tabs, pocket_pattern, offset_side, direction, depth_per_pass）は非表示にし、代わりに：
- Z Step (mm)
- Stock to Leave (mm)
- Tool Type (select: ballnose / endmill)
- Tool Diameter (mm)
- Feed XY (mm/s)
- Feed Z (mm/s)
- Spindle Speed (RPM)

を表示する。

具体的な変更（settings fields セクション内、`{opsInGroup.length > 0 && (` の中）:

```tsx
{group.operation_type === "3d_roughing" ? (
  <>
    <NumberRow
      label="Z Step (mm)"
      value={group.settings.z_step ?? 3.0}
      step={0.5}
      onChange={(v) => updateGroupSettings(group.group_id, "z_step", v)}
    />
    <NumberRow
      label="Stock to Leave (mm)"
      value={group.settings.stock_to_leave ?? 0.5}
      step={0.1}
      onChange={(v) => updateGroupSettings(group.group_id, "stock_to_leave", v)}
    />
    <div style={fieldRowStyle}>
      <label style={fieldLabelStyle}>Tool Type</label>
      <select
        style={selectStyle}
        value={group.settings.tool.type}
        onChange={(e) =>
          updateGroupSettings(group.group_id, "tool", {
            ...group.settings.tool,
            type: e.target.value,
          })
        }
      >
        <option value="ballnose">Ballnose</option>
        <option value="endmill">Endmill</option>
      </select>
    </div>
    <NumberRow
      label="Tool dia (mm)"
      value={group.settings.tool.diameter}
      step={0.1}
      onChange={(v) =>
        updateGroupSettings(group.group_id, "tool", {
          ...group.settings.tool,
          diameter: v,
        })
      }
    />
    <NumberRow
      label="Feed XY (mm/s)"
      value={group.settings.feed_rate.xy}
      onChange={(v) =>
        updateGroupSettings(group.group_id, "feed_rate", {
          ...group.settings.feed_rate,
          xy: v,
        })
      }
    />
    <NumberRow
      label="Feed Z (mm/s)"
      value={group.settings.feed_rate.z}
      onChange={(v) =>
        updateGroupSettings(group.group_id, "feed_rate", {
          ...group.settings.feed_rate,
          z: v,
        })
      }
    />
    <NumberRow
      label="Spindle (RPM)"
      value={group.settings.spindle_speed}
      step={1000}
      onChange={(v) =>
        updateGroupSettings(group.group_id, "spindle_speed", Math.round(v))
      }
    />
  </>
) : (
  // 既存の 2D 設定フィールド（そのまま）
  <>
    {/* existing depth_per_pass/peck, feed, spindle, tool, pocket/contour fields */}
  </>
)}
```

**Step 2: ビルド確認**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: コミット**

```bash
git add frontend/src/components/OperationDetailPanel.tsx
git commit -m "feat(Phase2): OperationDetailPanel 3d_roughing settings UI (#58)"
```

---

## Task 5: ThreeDMillingNode — 設定 UI 削除 + upstream 読み取り

**Files:**
- Modify: `frontend/src/nodes/ThreeDMillingNode.tsx`

**Step 1: ThreeDMillingNode をリファクタ**

設定 UI（z_step, stock_to_leave, tool, feed 等の state と input）をすべて削除。

代わりに:
1. upstream OperationNode から operations + assignments を `useUpstreamData` で読む
2. upstream PostProcessorNode から post_processor を読む（optional）
3. 3d_roughing の assignment から設定を取得
4. Generate ボタン → `/api/3d-roughing` を呼ぶ（設定は upstream から）
5. 結果表示（Z levels, passes 数）

入力ハンドルを変更:
- `mesh` ハンドル → そのまま（MeshImportResult 取得用）
- `operations` ハンドル追加（OperationNode からの設定取得用）

```tsx
// 新しい入力ハンドル構成
<LabeledHandle type="target" id={`${id}-mesh`} label="mesh" dataType="geometry" index={0} total={2} />
<LabeledHandle type="target" id={`${id}-operations`} label="operations" dataType="geometry" index={1} total={2} />

// upstream から operations を読み取り
const extractOps = useCallback((d: Record<string, unknown>) => {
  const assignments = d.assignments as OperationAssignment[] | undefined;
  if (!assignments?.length) return undefined;
  // 3d_roughing の assignment を探す
  const roughing = assignments.find((a) => a.settings.operation_type === "3d_roughing" && a.enabled);
  return roughing ?? undefined;
}, []);
const roughingAssignment = useUpstreamData(id, `${id}-operations`, extractOps);

// Generate ハンドラ
const handleGenerate = useCallback(async () => {
  if (!meshData?.mesh_file_path) return;
  const settings = roughingAssignment?.settings;
  const res = await generate3dRoughing(
    meshData.mesh_file_path,
    settings?.z_step ?? 3.0,
    settings?.stock_to_leave ?? 0.5,
    settings ? { diameter: settings.tool.diameter, type: settings.tool.type, flutes: settings.tool.flutes } : undefined,
    settings ? { xy: settings.feed_rate.xy, z: settings.feed_rate.z } : undefined,
    settings?.spindle_speed,
  );
  // ...
}, [meshData, roughingAssignment]);
```

**Step 2: ビルド確認**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: コミット**

```bash
git add frontend/src/nodes/ThreeDMillingNode.tsx
git commit -m "refactor(Phase2): ThreeDMillingNode remove settings UI, read from upstream (#58)"
```

---

## Task 6: Toolpath contour_type に 3d_roughing 追加

**Files:**
- Modify: `backend/schemas.py` (Toolpath.contour_type)
- Modify: `frontend/src/types.ts` (Toolpath.contour_type)
- Modify: `frontend/src/nodes/ToolpathGenNode.tsx` (CONTOUR_COLORS)

**Step 1: バックエンド Toolpath.contour_type に追加**

```python
# schemas.py — Toolpath
contour_type: Literal["exterior", "interior", "pocket", "drill", "3d_roughing"] = "exterior"
```

**Step 2: フロントエンド types.ts**

```typescript
// Toolpath.contour_type
contour_type: "exterior" | "interior" | "pocket" | "drill" | "3d_roughing";
```

**Step 3: ToolpathGenNode CONTOUR_COLORS**

```typescript
const CONTOUR_COLORS: Record<string, string> = {
  exterior: "#00bcd4",
  interior: "#4dd0e1",
  pocket: "#9c27b0",
  drill: "#ff9800",
  "3d_roughing": "#4caf50",
};
```

**Step 4: 既存テスト確認**

Run: `cd backend && uv run pytest tests/ -v`
Expected: All passed

**Step 5: コミット**

```bash
git add backend/schemas.py frontend/src/types.ts frontend/src/nodes/ToolpathGenNode.tsx
git commit -m "feat(Phase2): add 3d_roughing contour_type to Toolpath (#58)"
```

---

## Task 7: 全体テスト + ビルド確認

**Step 1: バックエンド全テスト**

Run: `cd backend && uv run pytest tests/ -v`
Expected: All passed

**Step 2: フロントエンドビルド**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: No errors

**Step 3: コミット（必要に応じて修正）**

---

## データフロー（完成形）

```
MeshImport → Placement → Operation（3d_roughing ローカル検出 + 設定 UI）
                                          ↓
                          ThreeDMillingNode（Generate のみ、設定は upstream）
                                          ↑
                                   PostProcessor
```
