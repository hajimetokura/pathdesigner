"""BLF (Bottom-Left Fill) nesting algorithm for multi-stock placement."""

from __future__ import annotations

from shapely.affinity import rotate as shapely_rotate
from shapely.affinity import translate as shapely_translate
from shapely.geometry import Polygon, box

from schemas import BrepObject, PlacementItem, SheetSettings


def auto_nesting(
    objects: list[BrepObject],
    sheet: SheetSettings,
    tool_diameter: float = 6.35,
    clearance: float = 5.0,
) -> list[PlacementItem]:
    """Distribute parts across stock sheets using BLF algorithm.

    Returns a list of PlacementItem with stock_id assigned.
    Parts that don't fit get sheet_id="sheet_1" with offset (0,0) as fallback.
    """
    if not objects or not sheet.materials:
        return []

    template = sheet.materials[0]
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
        stock_ids = list(stocks.keys()) + [f"sheet_{len(stocks) + 1}"]

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
                    sheet_id=sid,
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
                sheet_id="sheet_1",
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
