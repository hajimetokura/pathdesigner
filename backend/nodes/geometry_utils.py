"""Shared geometry utilities for coordinate transforms and wire sampling."""

from __future__ import annotations

from shapely.affinity import rotate as shapely_rotate
from shapely.geometry import Polygon

COORD_PRECISION = 6


def sample_wire_coords(
    wire,
    *,
    num_points: int = 100,
    mode: str = "proportional",
    resolution: float = 2.0,
    precision: int = COORD_PRECISION,
) -> list[tuple[float, float]]:
    """Sample evenly-spaced points along a build123d Wire.

    Args:
        wire: A build123d Wire object.
        num_points: Total number of sample points (used in "proportional" mode).
        mode: "proportional" distributes num_points by edge length ratio.
              "resolution" samples every ~resolution mm along each edge.
        resolution: Approximate mm between samples (used in "resolution" mode).
        precision: Number of decimal places for rounding coordinates.

    Returns:
        List of (x, y) tuples. Closed wires have first == last point.
    """
    if mode not in ("proportional", "resolution"):
        raise ValueError(f"mode must be 'proportional' or 'resolution', got {mode!r}")

    edges = wire.edges()
    coords: list[tuple[float, float]] = []

    for edge in edges:
        length = edge.length
        if length < 0.001:
            continue

        if mode == "proportional":
            n = max(2, int(num_points * length / wire.length))
        else:
            n = max(2, int(length / resolution))

        for i in range(n):
            t = i / n
            pt = edge.position_at(t)
            coords.append((round(pt.X, precision), round(pt.Y, precision)))

    if coords and coords[0] != coords[-1]:
        coords.append(coords[0])
    return coords


def intersect_solid_at_z(solid, z: float) -> list[tuple]:
    """Intersect a build123d Solid with XY plane at z height.

    Returns list of (wire, contour_type) tuples where contour_type is
    "exterior" or "interior". Faces yield outer_wire as "exterior" and
    inner_wires as "interior". Bare Wires are assumed "exterior".
    """
    from build123d import Plane, ShapeList

    plane = Plane.XY.offset(z)
    result = solid.intersect(plane)
    if result is None:
        return []

    items = list(result) if isinstance(result, ShapeList) else [result]
    wires = []
    for item in items:
        if hasattr(item, "outer_wire"):
            wires.append((item.outer_wire(), "exterior"))
            for iw in item.inner_wires():
                wires.append((iw, "interior"))
        elif hasattr(item, "edges"):
            wires.append((item, "exterior"))
    return wires


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


def transform_coords(
    coords: list[list[float]],
    rotation: float,
    rot_cx: float,
    rot_cy: float,
    dx: float,
    dy: float,
) -> list[list[float]]:
    """Rotate coords around (rot_cx, rot_cy), then translate by (dx, dy).

    Handles any number of points (including single-point drill centers).
    Uses Shapely for rotation when len(coords) >= 3, otherwise manual math.
    """
    if rotation != 0:
        if len(coords) >= 3:
            rotated = rotate_coords(coords, rotation, rot_cx, rot_cy)
        else:
            import math

            rad = math.radians(rotation)
            cos_a, sin_a = math.cos(rad), math.sin(rad)
            rotated = []
            for c in coords:
                rx = c[0] - rot_cx
                ry = c[1] - rot_cy
                rotated.append([
                    round(cos_a * rx - sin_a * ry + rot_cx, 4),
                    round(sin_a * rx + cos_a * ry + rot_cy, 4),
                ])
    else:
        rotated = coords

    return [[c[0] + dx, c[1] + dy] for c in rotated]
