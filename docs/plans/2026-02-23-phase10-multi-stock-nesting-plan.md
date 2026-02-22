# Phase 10: マルチストック・ネスティング Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Auto Nesting機能で複数パーツを複数ストックに自動分配し、ストックごとにSBP出力をZIPでダウンロードできるようにする。

**Architecture:** PlacementNodeを拡張して複数ストックインスタンスを管理。PlacementItemに`stock_id`フィールドを追加し、下流ノードは`activeStockId`でフィルタ。BLF（Bottom-Left Fill）アルゴリズムでバックエンドが自動配置を計算。SBP出力は`/api/generate-sbp-zip`で全ストック分をZIPで返す。

**Tech Stack:** Shapely (BLF衝突判定), FastAPI (API), React Flow (UI), zipfile (ZIP生成)

**Design doc:** `docs/plans/2026-02-23-phase10-multi-stock-nesting-design.md`

---

## Task 10.1: スキーマ変更 — PlacementItem.stock_id 追加

**Files:**
- Modify: `backend/schemas.py:268-280` (PlacementItem)
- Modify: `frontend/src/types.ts:207-213` (PlacementItem)

**Step 1: backend/schemas.py の PlacementItem に stock_id 追加**

```python
# backend/schemas.py L268-280
class PlacementItem(BaseModel):
    object_id: str
    material_id: str = "mat_001"
    stock_id: str = "stock_1"         # NEW: 物理シート識別子
    x_offset: float = 0
    y_offset: float = 0
    rotation: int = 0

    @field_validator("rotation")
    @classmethod
    def validate_rotation(cls, v: int) -> int:
        if v % 45 != 0 or v < 0 or v >= 360:
            msg = "rotation must be 0, 45, 90, 135, 180, 225, 270, or 315"
            raise ValueError(msg)
        return v
```

**Step 2: frontend/src/types.ts の PlacementItem に stock_id 追加**

```typescript
// frontend/src/types.ts L207-213
export interface PlacementItem {
  object_id: string;
  material_id: string;
  stock_id: string;                   // NEW
  x_offset: number;
  y_offset: number;
  rotation: number;
}
```

**Step 3: 既存テストが壊れないことを確認**

Run: `cd backend && uv run python -m pytest tests/ -v --tb=short`
Expected: ALL PASS（stock_id はデフォルト値あり）

**Step 4: コミット**

```bash
git commit -m "Phase 10: Add stock_id field to PlacementItem (#22)"
```

---

## Task 10.2: Auto Nesting リクエスト/レスポンススキーマ追加

**Files:**
- Modify: `backend/schemas.py` (末尾に追加)
- Modify: `frontend/src/types.ts` (末尾に追加)

**Step 1: backend/schemas.py に AutoNesting スキーマ追加**

ファイル末尾（L299の後）に追加:

```python
class AutoNestingRequest(BaseModel):
    objects: list[BrepObject]
    stock: StockSettings
    tool_diameter: float = 6.35
    clearance: float = 5.0


class AutoNestingResponse(BaseModel):
    placements: list[PlacementItem]
    stock_count: int
    warnings: list[str] = []
```

**Step 2: frontend/src/types.ts に対応する型を追加**

ファイル末尾に追加:

```typescript
export interface AutoNestingResponse {
  placements: PlacementItem[];
  stock_count: number;
  warnings: string[];
}
```

**Step 3: コミット**

```bash
git commit -m "Phase 10: Add AutoNesting request/response schemas (#22)"
```

---

## Task 10.3: BLFネスティングアルゴリズム実装

**Files:**
- Create: `backend/nodes/nesting.py`
- Create: `backend/tests/test_nesting.py`

**Step 1: テスト作成**

```python
# backend/tests/test_nesting.py
import pytest
from schemas import BoundingBox, BrepObject, StockMaterial, StockSettings, PlacementItem
from nodes.nesting import auto_nesting


def _make_object(obj_id: str, w: float, d: float, t: float = 10.0) -> BrepObject:
    """テスト用BrepObjectを作成"""
    return BrepObject(
        object_id=obj_id,
        file_name="test.step",
        bounding_box=BoundingBox(x=w, y=d, z=t),
        thickness=t,
        unit="mm",
        is_closed=True,
        is_planar=True,
        machining_type="2d",
        outline=[[0, 0], [w, 0], [w, d], [0, d], [0, 0]],
    )


def _make_stock(width: float = 600, depth: float = 400, thickness: float = 18) -> StockSettings:
    return StockSettings(
        materials=[
            StockMaterial(
                material_id="mat_001",
                label="Plywood",
                width=width,
                depth=depth,
                thickness=thickness,
            )
        ]
    )


class TestAutoNesting:
    def test_single_part_bottom_left(self):
        """1パーツは左下に配置される"""
        objects = [_make_object("obj_001", 100, 50)]
        stock = _make_stock()
        result = auto_nesting(objects, stock)
        assert len(result) == 1
        p = result[0]
        assert p.object_id == "obj_001"
        assert p.stock_id == "stock_1"
        # マージン分だけオフセット（tool_diameter/2 + clearance = 3.175 + 5 = 8.175）
        assert p.x_offset >= 0
        assert p.y_offset >= 0

    def test_two_parts_no_overlap(self):
        """2パーツが重ならない"""
        objects = [
            _make_object("obj_001", 100, 50),
            _make_object("obj_002", 100, 50),
        ]
        stock = _make_stock()
        result = auto_nesting(objects, stock)
        assert len(result) == 2
        # 同じ stock_id（収まるはず）
        assert all(p.stock_id == "stock_1" for p in result)
        # 重ならない: BB が交差しない
        p1, p2 = result[0], result[1]
        assert not _bbs_overlap(p1, 100, 50, p2, 100, 50)

    def test_overflow_to_second_stock(self):
        """1枚に収まらないとき2枚目に溢れる"""
        # ストックが 200x200 で、100x100 パーツを 5 個
        objects = [_make_object(f"obj_{i:03d}", 100, 100) for i in range(5)]
        stock = _make_stock(width=200, depth=200)
        result = auto_nesting(objects, stock, tool_diameter=0, clearance=0)
        stock_ids = set(p.stock_id for p in result)
        assert len(stock_ids) >= 2, f"Expected 2+ stocks, got {stock_ids}"

    def test_all_parts_placed(self):
        """全パーツが配置される"""
        objects = [_make_object(f"obj_{i:03d}", 80, 60) for i in range(10)]
        stock = _make_stock()
        result = auto_nesting(objects, stock)
        assert len(result) == 10
        placed_ids = {p.object_id for p in result}
        expected_ids = {f"obj_{i:03d}" for i in range(10)}
        assert placed_ids == expected_ids

    def test_large_part_warning(self):
        """ストックより大きいパーツは stock_1 に配置して警告対象"""
        objects = [_make_object("obj_big", 700, 500)]  # ストック(600x400)より大きい
        stock = _make_stock()
        result = auto_nesting(objects, stock)
        assert len(result) == 1
        # 配置はされるがオフセット0（フォールバック）
        assert result[0].x_offset == 0
        assert result[0].y_offset == 0


def _bbs_overlap(
    p1: PlacementItem, w1: float, h1: float,
    p2: PlacementItem, w2: float, h2: float,
) -> bool:
    """2つのBBが重なるか（回転なし簡易チェック）"""
    return not (
        p1.x_offset + w1 <= p2.x_offset
        or p2.x_offset + w2 <= p1.x_offset
        or p1.y_offset + h1 <= p2.y_offset
        or p2.y_offset + h2 <= p1.y_offset
    )
```

**Step 2: テスト実行 → 失敗確認**

Run: `cd backend && uv run python -m pytest tests/test_nesting.py -v`
Expected: FAIL（`nodes.nesting` モジュールが存在しない）

**Step 3: BLFネスティングアルゴリズム実装**

```python
# backend/nodes/nesting.py
"""BLF (Bottom-Left Fill) nesting algorithm for multi-stock placement."""

from __future__ import annotations

from shapely.affinity import rotate as shapely_rotate
from shapely.affinity import translate as shapely_translate
from shapely.geometry import Polygon, box

from schemas import BrepObject, PlacementItem, StockSettings


def auto_nesting(
    objects: list[BrepObject],
    stock: StockSettings,
    tool_diameter: float = 6.35,
    clearance: float = 5.0,
) -> list[PlacementItem]:
    """Distribute parts across stock sheets using BLF algorithm.

    Returns a list of PlacementItem with stock_id assigned.
    Parts that don't fit get stock_id="stock_1" with offset (0,0) as fallback.
    """
    if not objects or not stock.materials:
        return []

    template = stock.materials[0]
    margin = tool_diameter / 2 + clearance

    # Sort by area descending (larger parts first)
    sorted_objects = sorted(
        objects,
        key=lambda o: o.bounding_box.x * o.bounding_box.y,
        reverse=True,
    )

    # Track placed polygons per stock
    stocks: dict[str, list[Polygon]] = {}
    placements: list[PlacementItem] = []

    for obj in sorted_objects:
        placed = False
        base_poly = _object_polygon(obj, margin)

        # Try existing stocks first, then a new one
        stock_ids = list(stocks.keys()) + [f"stock_{len(stocks) + 1}"]

        for sid in stock_ids:
            stock_poly = box(0, 0, template.width, template.depth)
            existing = stocks.get(sid, [])

            result = _try_place_blf(
                base_poly, stock_poly, existing, template.width, template.depth,
            )
            if result is not None:
                x, y, angle = result
                final_poly = _position_polygon(base_poly, x, y, angle)
                if sid not in stocks:
                    stocks[sid] = []
                stocks[sid].append(final_poly)
                placements.append(PlacementItem(
                    object_id=obj.object_id,
                    material_id=template.material_id,
                    stock_id=sid,
                    x_offset=x,
                    y_offset=y,
                    rotation=angle,
                ))
                placed = True
                break

        if not placed:
            # Fallback: place at origin on stock_1
            placements.append(PlacementItem(
                object_id=obj.object_id,
                material_id=template.material_id,
                stock_id="stock_1",
                x_offset=0,
                y_offset=0,
                rotation=0,
            ))

    return placements


def _object_polygon(obj: BrepObject, margin: float) -> Polygon:
    """Create a Shapely polygon from object outline, buffered by margin."""
    if obj.outline and len(obj.outline) >= 3:
        poly = Polygon(obj.outline)
    else:
        bb = obj.bounding_box
        poly = box(0, 0, bb.x, bb.y)
    if margin > 0:
        poly = poly.buffer(margin, join_style="mitre")
    return poly


def _try_place_blf(
    part: Polygon,
    stock_poly: Polygon,
    placed: list[Polygon],
    stock_w: float,
    stock_h: float,
    step: float = 5.0,
) -> tuple[float, float, int] | None:
    """Try to place part on stock using BLF. Returns (x, y, angle) or None."""
    best: tuple[float, float, int] | None = None
    best_score = (float("inf"), float("inf"))

    for angle in range(0, 360, 45):
        rotated = shapely_rotate(part, angle, origin="centroid") if angle else part
        # Get bounding box of rotated part
        minx, miny, maxx, maxy = rotated.bounds
        part_w = maxx - minx
        part_h = maxy - miny

        if part_w > stock_w or part_h > stock_h:
            continue  # Doesn't fit at this angle

        # Shift so rotated part's min corner is at origin
        shift_x = -minx
        shift_y = -miny
        normalized = shapely_translate(rotated, shift_x, shift_y)

        # Grid search: bottom-left first (y ascending, then x ascending)
        y = 0.0
        while y + part_h <= stock_h:
            x = 0.0
            while x + part_w <= stock_w:
                candidate = shapely_translate(normalized, x, y)
                if stock_poly.contains(candidate) and not any(
                    candidate.intersects(p) for p in placed
                ):
                    score = (y, x)
                    if score < best_score:
                        best_score = score
                        best = (x, y, angle)
                    break  # Found leftmost position at this y
                x += step
            if best and best_score[0] == y:
                break  # Found at this y level, no need to go higher
            y += step

        if best:
            break  # Found a placement, use it

    return best


def _position_polygon(part: Polygon, x: float, y: float, angle: int) -> Polygon:
    """Position part polygon at (x, y) with rotation."""
    rotated = shapely_rotate(part, angle, origin="centroid") if angle else part
    minx, miny, _, _ = rotated.bounds
    return shapely_translate(rotated, x - minx, y - miny)
```

**Step 4: テスト実行 → パス確認**

Run: `cd backend && uv run python -m pytest tests/test_nesting.py -v`
Expected: ALL PASS

**Step 5: コミット**

```bash
git commit -m "Phase 10: Implement BLF nesting algorithm with multi-stock support (#22)"
```

---

## Task 10.4: /api/auto-nesting エンドポイント追加

**Files:**
- Modify: `backend/main.py` (エンドポイント追加)
- Modify: `frontend/src/api.ts` (API関数追加)

**Step 1: backend/main.py にエンドポイント追加**

`validate_placement_endpoint` の前（L222付近）に追加:

```python
@app.post("/api/auto-nesting", response_model=AutoNestingResponse)
def auto_nesting_endpoint(req: AutoNestingRequest):
    from nodes.nesting import auto_nesting

    placements = auto_nesting(
        req.objects, req.stock, req.tool_diameter, req.clearance,
    )
    stock_ids = set(p.stock_id for p in placements)
    # Fallback配置の警告
    warnings = []
    for p in placements:
        obj = next((o for o in req.objects if o.object_id == p.object_id), None)
        if obj and p.x_offset == 0 and p.y_offset == 0 and p.rotation == 0:
            bb = obj.bounding_box
            tmpl = req.stock.materials[0] if req.stock.materials else None
            if tmpl and (bb.x > tmpl.width or bb.y > tmpl.depth):
                warnings.append(f"{p.object_id}: ストックに収まりません")
    return AutoNestingResponse(
        placements=placements,
        stock_count=len(stock_ids),
        warnings=warnings,
    )
```

schemas.py のインポート部分に `AutoNestingRequest, AutoNestingResponse` を追加。

**Step 2: frontend/src/api.ts に autoNesting 関数追加**

ファイル末尾に追加:

```typescript
export async function autoNesting(
  objects: BrepObject[],
  stock: StockSettings,
  toolDiameter: number = 6.35,
  clearance: number = 5.0,
): Promise<AutoNestingResponse> {
  const res = await fetch(`${API_URL}/api/auto-nesting`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      objects,
      stock,
      tool_diameter: toolDiameter,
      clearance,
    }),
  });
  if (!res.ok) throw new Error(`auto-nesting failed: ${res.status}`);
  return res.json();
}
```

api.ts の先頭のインポートに `AutoNestingResponse` を追加。

**Step 3: テスト**

Run: `cd backend && uv run python -m pytest tests/ -v --tb=short`
Expected: ALL PASS

**Step 4: コミット**

```bash
git commit -m "Phase 10: Add /api/auto-nesting endpoint (#22)"
```

---

## Task 10.5: PlacementNode — マルチストック対応

**Files:**
- Modify: `frontend/src/nodes/PlacementNode.tsx`

**概要:** PlacementNodeが `activeStockId` を管理し、node.data に含める。自動初期化で全オブジェクトに `stock_id: "stock_1"` を設定。

**Step 1: state に activeStockId を追加**

`PlacementNode.tsx` の state 宣言（L17-18付近）に追加:

```typescript
const [placements, setPlacements] = useState<PlacementItem[]>([]);
const [warnings, setWarnings] = useState<string[]>([]);
const [activeStockId, setActiveStockId] = useState("stock_1");  // NEW
```

**Step 2: syncToNodeData に activeStockId を含める**

`syncToNodeData`（L28-46）の node.data 書き込みに `activeStockId` を追加:

```typescript
data: {
  ...n.data,
  placementResult: { placements: p, stock, objects: brep.objects },
  fileId: brep.file_id,
  activeStockId: activeStockId,  // NEW
}
```

**Step 3: 自動初期化で stock_id を含める**

L49-63の自動初期化ロジックで `stock_id` を含める:

```typescript
const initial: PlacementItem[] = brepResult.objects.map((obj, i) => ({
  object_id: obj.object_id,
  material_id: defaultMtl,
  stock_id: "stock_1",          // NEW
  x_offset: 10 + i * 20,
  y_offset: 10 + i * 20,
  rotation: 0,
}));
```

**Step 4: handlePlacementsChange に activeStockId の連動を追加**

PlacementPanelからの `activeStockId` 変更を受け取るハンドラを追加:

```typescript
const handleActiveStockChange = useCallback((stockId: string) => {
  setActiveStockId(stockId);
  // node.data にも反映
  setNodes((nds) =>
    nds.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, activeStockId: stockId } } : n
    )
  );
}, [id, setNodes]);
```

**Step 5: PlacementPanel に activeStockId 関連の props を追加**

PlacementPanel の呼び出し箇所（handleOpenPanel, L184-200付近）で props を追加:

```typescript
<PlacementPanel
  objects={brepResult.objects}
  stockSettings={stockSettings}
  placements={placements}
  onPlacementsChange={handlePlacementsChange}
  warnings={warnings}
  activeStockId={activeStockId}           // NEW
  onActiveStockChange={handleActiveStockChange}  // NEW
/>
```

**Step 6: テスト**

Run: `make dev` でフロントエンド起動。コンソールエラーがないことを確認。既存機能が動作することを確認。

**Step 7: コミット**

```bash
git commit -m "Phase 10: Add multi-stock state management to PlacementNode (#22)"
```

---

## Task 10.6: PlacementPanel — マルチストック UI

**Files:**
- Modify: `frontend/src/components/PlacementPanel.tsx`

**概要:** ストックタブ切替UI、Auto Nestingボタン、クリアランス設定を追加。Canvasはアクティブストックのパーツのみ描画。

**Step 1: Props インターフェースを拡張**

```typescript
// PlacementPanel.tsx L37-43
interface Props {
  objects: BrepObject[];
  stockSettings: StockSettings;
  placements: PlacementItem[];
  onPlacementsChange: (placements: PlacementItem[]) => void;
  warnings: string[];
  activeStockId: string;                                    // NEW
  onActiveStockChange: (stockId: string) => void;           // NEW
}
```

**Step 2: ストック一覧の算出とフィルタリング**

コンポーネント内の先頭に追加:

```typescript
// ストック一覧を placements から算出
const stockIds = useMemo(() => {
  const ids = [...new Set(placements.map((p) => p.stock_id))];
  if (ids.length === 0) ids.push("stock_1");
  return ids.sort();
}, [placements]);

// アクティブストックのパーツのみフィルタ
const activePlacements = useMemo(
  () => placements.filter((p) => p.stock_id === activeStockId),
  [placements, activeStockId],
);
```

**Step 3: Auto Nesting ボタンとクリアランス入力**

コンポーネント JSX の先頭部分に追加:

```typescript
const [clearance, setClearance] = useState(5);
const [nestingLoading, setNestingLoading] = useState(false);

const handleAutoNesting = async () => {
  setNestingLoading(true);
  try {
    const result = await autoNesting(objects, stockSettings, 6.35, clearance);
    onPlacementsChange(result.placements);
    if (result.warnings.length > 0) {
      // warnings は親経由で表示
    }
    // 最初のストックをアクティブに
    if (result.placements.length > 0) {
      onActiveStockChange(result.placements[0].stock_id);
    }
  } catch (e) {
    console.error("Auto nesting failed:", e);
  } finally {
    setNestingLoading(false);
  }
};
```

**Step 4: ストックタブ UI**

Canvas の上にタブとAuto Nestingボタンを配置:

```tsx
{/* Auto Nesting + Clearance */}
<div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
  <button onClick={handleAutoNesting} disabled={nestingLoading || objects.length === 0}>
    {nestingLoading ? "Nesting..." : "Auto Nesting"}
  </button>
  <label style={{ fontSize: 12 }}>
    Clearance:
    <input
      type="number"
      value={clearance}
      onChange={(e) => setClearance(Number(e.target.value))}
      style={{ width: 50, marginLeft: 4 }}
      min={0}
      step={1}
    />
    mm
  </label>
</div>

{/* Stock Tabs */}
<div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
  {stockIds.map((sid) => {
    const count = placements.filter((p) => p.stock_id === sid).length;
    return (
      <button
        key={sid}
        onClick={() => onActiveStockChange(sid)}
        style={{
          padding: "4px 12px",
          fontSize: 12,
          background: sid === activeStockId ? "#4a90d9" : "#e0e0e0",
          color: sid === activeStockId ? "#fff" : "#333",
          border: "none",
          borderRadius: 4,
          cursor: "pointer",
        }}
      >
        {sid.replace("stock_", "Sheet ")} ({count})
      </button>
    );
  })}
</div>
```

**Step 5: Canvas 描画を activePlacements に変更**

`draw()` 関数内のパーツ描画ループ（L108付近）で、`placements` の代わりに `activePlacements` を使用:

```typescript
// 変更前: placements.forEach(...)
// 変更後:
activePlacements.forEach((pl) => {
  // 既存の描画ロジック
});
```

**Step 6: パーツリストも activePlacements に変更**

下部のパーツ入力リスト（L262-302付近）も `activePlacements` でフィルタ:

```typescript
// 変更前: {placements.map((pl, idx) => ...)}
// 変更後:
{activePlacements.map((pl) => {
  // 既存の入力UI
  // ただし onPlacementsChange 時は全 placements を更新する必要がある
})}
```

数値変更・回転のハンドラで、全 placements の中から対象の placement だけ更新する:

```typescript
const handleNumericChange = (objectId: string, field: "x_offset" | "y_offset", value: number) => {
  const updated = placements.map((p) =>
    p.object_id === objectId ? { ...p, [field]: value } : p
  );
  onPlacementsChange(updated);
};
```

**Step 7: ドラッグも activePlacements に対応**

`handleMouseDown` のヒットテスト（L179-199）で `activePlacements` を使用。
`handleMouseMove` の座標更新（L201-214）で全 `placements` の中から対象を更新。

**Step 8: テスト**

Run: `make dev` でフロントエンド起動。
- STEPアップロード → PlacementPanel を開く
- 「Stock 1」タブが表示される
- Auto Nesting ボタンが表示される（オブジェクトが2つ以上の時に動作確認）

**Step 9: コミット**

```bash
git commit -m "Phase 10: Add multi-stock tabs and Auto Nesting button to PlacementPanel (#22)"
```

---

## Task 10.7: validate-placement をストック単位に修正

**Files:**
- Modify: `backend/main.py:246-300` (validate_placement_endpoint)
- Modify: `backend/tests/test_collision.py`

**Step 1: テスト追加**

`test_collision.py` に追加:

```python
def test_different_stocks_no_collision():
    """異なるストック上のパーツは衝突しない"""
    # 同じ位置に配置しても stock_id が異なれば valid
    p1 = PlacementItem(object_id="obj_001", stock_id="stock_1", x_offset=0, y_offset=0)
    p2 = PlacementItem(object_id="obj_002", stock_id="stock_2", x_offset=0, y_offset=0)
    # validate_placement で valid=True を確認
```

**Step 2: validate_placement_endpoint のロジック修正**

`main.py` の衝突判定ループ（L264-295付近）で、`stock_id` でグループ化してからチェック:

```python
# stock_id でグループ化
from itertools import groupby
sorted_by_stock = sorted(
    [(p, polygons[p.object_id]) for p in req.placements if p.object_id in polygons],
    key=lambda x: x[0].stock_id,
)
for stock_id, group in groupby(sorted_by_stock, key=lambda x: x[0].stock_id):
    items = list(group)
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            if items[i][1].intersects(items[j][1]):
                warnings.append(
                    f"Collision: {items[i][0].object_id} and {items[j][0].object_id} on {stock_id}"
                )
```

**Step 3: テスト実行**

Run: `cd backend && uv run python -m pytest tests/test_collision.py -v`
Expected: ALL PASS

**Step 4: コミット**

```bash
git commit -m "Phase 10: Fix validate-placement to check collisions per stock (#22)"
```

---

## Task 10.8: ToolpathGenNode — アクティブストックのみ処理

**Files:**
- Modify: `frontend/src/nodes/ToolpathGenNode.tsx`

**概要:** 上流の `activeStockId` を取得し、placements をフィルタしてからツールパス生成する。

**Step 1: upstream から activeStockId を取得**

`operationsSelector`（L33-46付近）で `activeStockId` も取得:

```typescript
// 既存のセレクタに追加
activeStockId: node?.data?.activeStockId as string | undefined,
```

**Step 2: genKey に activeStockId を含める**

変更検出キー（L55付近）に `activeStockId` を追加:

```typescript
const genKey = JSON.stringify({
  assignments, placements, stockSettings, postProc,
  activeStockId: operations?.activeStockId,  // NEW
});
```

**Step 3: placements フィルタリング**

ツールパス生成時（L81-100付近）に activeStockId でフィルタ:

```typescript
const activeStockId = operations?.activeStockId || "stock_1";
const filteredPlacements = placements.filter(
  (p: PlacementItem) => p.stock_id === activeStockId
);
// generateToolpath に filteredPlacements を渡す
const tpResult = await generateToolpath(
  assignments, detectedOperations, stockSettings,
  filteredPlacements,  // filtered
  objectOrigins,
);
```

**Step 4: assignments もフィルタリング**

アクティブストックのオブジェクトに関連する assignments のみ渡す:

```typescript
const activeObjectIds = new Set(filteredPlacements.map((p: PlacementItem) => p.object_id));
const filteredAssignments = assignments.filter((a: OperationAssignment) =>
  activeObjectIds.has(a.object_id)
);
```

**Step 5: node.data に stockIds 一覧を書き込む**

下流の CncCodeNode で全ストック一覧を参照するため:

```typescript
const allStockIds = [...new Set(placements.map((p: PlacementItem) => p.stock_id))].sort();

setNodes((nds) =>
  nds.map((n) =>
    n.id === id
      ? {
          ...n,
          data: {
            ...n.data,
            toolpathResult: tpResult,
            outputResult: sbp,
            stockSettings,
            activeStockId,             // NEW
            allStockIds,               // NEW
            allPlacements: placements, // NEW: ZIP生成用
            allAssignments: assignments, // NEW: ZIP生成用
          },
        }
      : n
  )
);
```

**Step 6: テスト**

Run: `make dev` でフロントエンド起動。
- STEP（複数オブジェクト）アップロード
- Auto Nesting で2ストックに分配
- Stock タブ切替 → ToolpathPreview/CncCode がストックに応じて更新されることを確認

**Step 7: コミット**

```bash
git commit -m "Phase 10: Filter toolpath generation by active stock (#22)"
```

---

## Task 10.9: /api/generate-sbp-zip エンドポイント

**Files:**
- Modify: `backend/schemas.py` (SbpZipRequest追加)
- Modify: `backend/main.py` (エンドポイント追加)
- Create: `backend/tests/test_sbp_zip.py`

**Step 1: スキーマ追加**

`backend/schemas.py` に追加:

```python
class SbpZipRequest(BaseModel):
    operations: list[OperationAssignment]
    detected_operations: OperationDetectResult
    stock: StockSettings
    placements: list[PlacementItem]
    object_origins: dict[str, list[float]] = {}
    bounding_boxes: dict[str, BoundingBox] = {}
    post_processor: PostProcessorSettings
```

**Step 2: テスト作成**

```python
# backend/tests/test_sbp_zip.py
import io
import zipfile
import pytest
from fastapi.testclient import TestClient
from main import app


client = TestClient(app)


def test_generate_sbp_zip_creates_valid_zip(
    sample_toolpath_gen_request,  # fixture with multi-stock placements
):
    """ZIP に各ストックの SBP ファイルが含まれる"""
    response = client.post("/api/generate-sbp-zip", json=sample_toolpath_gen_request)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"

    zf = zipfile.ZipFile(io.BytesIO(response.content))
    names = zf.namelist()
    assert len(names) >= 1
    for name in names:
        assert name.endswith(".sbp")
        content = zf.read(name).decode("utf-8")
        assert "SHOPBOT" in content or "SA" in content
```

**Step 3: エンドポイント実装**

`backend/main.py` に追加:

```python
import io
import zipfile
from fastapi.responses import StreamingResponse


@app.post("/api/generate-sbp-zip")
def generate_sbp_zip_endpoint(req: SbpZipRequest):
    """Generate SBP files for all stocks and return as ZIP."""
    from nodes.toolpath_gen import generate_toolpath_from_operations

    # Group placements by stock_id
    stock_groups: dict[str, list[PlacementItem]] = {}
    for p in req.placements:
        stock_groups.setdefault(p.stock_id, []).append(p)

    # Generate SBP per stock
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for stock_id in sorted(stock_groups.keys()):
            stock_placements = stock_groups[stock_id]
            stock_object_ids = {p.object_id for p in stock_placements}

            # Filter assignments for this stock
            filtered_ops = [
                a for a in req.operations if a.object_id in stock_object_ids
            ]
            if not filtered_ops:
                continue

            # Generate toolpath
            tp_result = generate_toolpath_from_operations(
                filtered_ops, req.detected_operations, req.stock,
                stock_placements, req.object_origins, req.bounding_boxes,
            )

            # Generate SBP
            machining = filtered_ops[0].settings if filtered_ops else None
            writer = SbpWriter(req.post_processor, machining, req.stock)
            sbp_code = writer.generate(tp_result.toolpaths)

            # Add to ZIP
            filename = f"{stock_id}.sbp"
            zf.writestr(filename, sbp_code)

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=pathdesigner_stocks.zip"},
    )
```

**Step 4: テスト実行**

Run: `cd backend && uv run python -m pytest tests/test_sbp_zip.py -v`
Expected: ALL PASS

**Step 5: コミット**

```bash
git commit -m "Phase 10: Add /api/generate-sbp-zip endpoint (#22)"
```

---

## Task 10.10: CncCodeNode — ZIP ダウンロード対応

**Files:**
- Modify: `frontend/src/nodes/CncCodeNode.tsx`
- Modify: `frontend/src/api.ts` (generateSbpZip 関数)

**Step 1: api.ts に generateSbpZip 関数追加**

```typescript
export async function generateSbpZip(
  operations: OperationAssignment[],
  detectedOperations: OperationDetectResult,
  stock: StockSettings,
  placements: PlacementItem[],
  objectOrigins: Record<string, [number, number]>,
  postProcessor: PostProcessorSettings,
): Promise<Blob> {
  const res = await fetch(`${API_URL}/api/generate-sbp-zip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operations,
      detected_operations: detectedOperations,
      stock,
      placements,
      object_origins: objectOrigins,
      post_processor: postProcessor,
    }),
  });
  if (!res.ok) throw new Error(`generate-sbp-zip failed: ${res.status}`);
  return res.blob();
}
```

**Step 2: CncCodeNode に ZIP ダウンロードボタン追加**

upstream から `allStockIds` を取得し、複数ストックがある場合にZIPボタンを表示:

```typescript
const allStockIds = useUpstreamData<string[]>(
  id, `${id}-in`, (data) => data.allStockIds as string[] | undefined
) ?? [];

const handleDownloadZip = async () => {
  // 上流から必要なデータを取得
  // generateSbpZip を呼び出し
  // Blob をダウンロード
  const blob = await generateSbpZip(/* ... */);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "pathdesigner_stocks.zip";
  a.click();
  URL.revokeObjectURL(url);
};
```

JSXに追加:

```tsx
{allStockIds.length > 1 && (
  <button onClick={handleDownloadZip} style={{ fontSize: 11 }}>
    Download All (ZIP)
  </button>
)}
```

**Step 3: テスト**

Run: `make dev` でフロントエンド起動。
- 複数ストック配置 → CncCodeNodeに「Download All (ZIP)」ボタンが表示
- クリック → ZIPファイルがダウンロードされる
- ZIP内に stock_1.sbp, stock_2.sbp が含まれる

**Step 4: コミット**

```bash
git commit -m "Phase 10: Add ZIP download for multi-stock SBP in CncCodeNode (#22)"
```

---

## Task 10.11: PlacementNode サムネイルのマルチストック対応

**Files:**
- Modify: `frontend/src/nodes/PlacementNode.tsx` (サムネイル描画)

**概要:** ノード上のサムネイルCanvasに、アクティブストックのパーツ数と全ストック数を表示。

**Step 1: サムネイル描画の修正**

L100-178のサムネイル描画で、`placements` を `activePlacements` でフィルタ:

```typescript
const activePlacements = placements.filter((p) => p.stock_id === activeStockId);
const stockIds = [...new Set(placements.map((p) => p.stock_id))].sort();
```

サムネイル描画ループを `activePlacements` に変更。

Canvasの右上にストック情報を表示:

```typescript
ctx.fillStyle = "#666";
ctx.font = "10px sans-serif";
ctx.fillText(
  `${activeStockId.replace("stock_", "")}/${stockIds.length}`,
  canvasW - 30, 12,
);
```

**Step 2: テスト**

Run: `make dev` でフロントエンド起動。ノード上のサムネイルが正しく表示されることを確認。

**Step 3: コミット**

```bash
git commit -m "Phase 10: Update PlacementNode thumbnail for multi-stock display (#22)"
```

---

## 依存関係まとめ

```
Task 10.1: スキーマ変更（stock_id）
Task 10.2: AutoNesting スキーマ追加 (依存: 10.1)
Task 10.3: BLFアルゴリズム実装 (依存: 10.1)
Task 10.4: /api/auto-nesting エンドポイント (依存: 10.2, 10.3)
Task 10.5: PlacementNode マルチストック対応 (依存: 10.1)
Task 10.6: PlacementPanel UI (依存: 10.4, 10.5)
Task 10.7: validate-placement 修正 (依存: 10.1)
Task 10.8: ToolpathGenNode ストックフィルタ (依存: 10.5)
Task 10.9: /api/generate-sbp-zip (依存: 10.1)
Task 10.10: CncCodeNode ZIP DL (依存: 10.8, 10.9)
Task 10.11: PlacementNode サムネイル (依存: 10.5)
```

並行可能: 10.3 と 10.5 は独立。10.7 と 10.9 も独立。
