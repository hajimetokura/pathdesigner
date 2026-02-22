"""Shared geometry utilities for coordinate transforms."""

from shapely.affinity import rotate as shapely_rotate
from shapely.geometry import Polygon


def rotate_polygon(polygon: Polygon, angle: float, origin: tuple[float, float]) -> Polygon:
    """Rotate polygon by angle (degrees, counter-clockwise) around origin."""
    if angle == 0:
        return polygon
    return shapely_rotate(polygon, angle, origin=origin, use_radians=False)


def rotate_coords(
    coords: list[list[float]], angle: float, cx: float, cy: float
) -> list[list[float]]:
    """Rotate 2D coordinate list by angle (degrees) around (cx, cy).

    Uses Shapely for robust rotation. Returns new coordinate list.
    """
    if angle == 0:
        return coords
    poly = Polygon(coords)
    rotated = shapely_rotate(poly, angle, origin=(cx, cy), use_radians=False)
    return [[round(c[0], 4), round(c[1], 4)] for c in rotated.exterior.coords]
