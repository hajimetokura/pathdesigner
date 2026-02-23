import pytest
from schemas import (
    BoundingBox, BrepObject, Origin, FacesAnalysis,
    StockMaterial, StockSettings, PlacementItem,
)
from nodes.nesting import auto_nesting


def _make_object(obj_id: str, w: float, d: float, t: float = 10.0) -> BrepObject:
    """テスト用BrepObjectを作成"""
    return BrepObject(
        object_id=obj_id,
        file_name="test.step",
        bounding_box=BoundingBox(x=w, y=d, z=t),
        thickness=t,
        origin=Origin(position=[0, 0, 0], reference="bounding_box_min", description="test"),
        unit="mm",
        is_closed=True,
        is_planar=True,
        machining_type="2d",
        faces_analysis=FacesAnalysis(top_features=False, bottom_features=False, freeform_surfaces=False),
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
