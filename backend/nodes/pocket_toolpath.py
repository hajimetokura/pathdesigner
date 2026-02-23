"""Pocket toolpath generation: contour-parallel (offset spiral) and raster (zigzag)."""

from shapely.geometry import LineString, Polygon


def generate_pocket_contour_parallel(
    polygon: Polygon, tool_diameter: float, stepover: float = 0.5,
) -> list[list[list[float]]]:
    """Contour-parallel (offset spiral) pocket toolpath.

    Progressively offsets the polygon boundary inward by stepover * tool_diameter
    until the polygon vanishes.

    Returns list of coordinate rings, each ring is [[x, y], ...].
    """
    step = tool_diameter * stepover
    paths: list[list[list[float]]] = []

    # First inset: half tool diameter (tool edge touches polygon boundary)
    current = polygon.buffer(-tool_diameter / 2, join_style="mitre")

    while not current.is_empty and current.area > 0:
        if current.geom_type == "Polygon":
            coords = [[round(c[0], 4), round(c[1], 4)] for c in current.exterior.coords]
            if len(coords) >= 3:
                paths.append(coords)
        elif current.geom_type == "MultiPolygon":
            for poly in current.geoms:
                coords = [[round(c[0], 4), round(c[1], 4)] for c in poly.exterior.coords]
                if len(coords) >= 3:
                    paths.append(coords)
        current = current.buffer(-step, join_style="mitre")

    return paths


def generate_pocket_raster(
    polygon: Polygon, tool_diameter: float, stepover: float = 0.5,
) -> list[list[list[float]]]:
    """Raster (zigzag) pocket toolpath.

    Scans the polygon with horizontal lines spaced by stepover * tool_diameter.

    Returns list of scan-line segments, each segment is [[x, y], ...].
    """
    step = tool_diameter * stepover
    inset = polygon.buffer(-tool_diameter / 2, join_style="mitre")
    if inset.is_empty:
        return []

    minx, miny, maxx, maxy = inset.bounds
    paths: list[list[list[float]]] = []
    y = miny + step / 2
    direction = 1  # 1 = left-to-right, -1 = right-to-left

    while y <= maxy - step / 2 + 0.001:
        scan_line = LineString([(minx - 1, y), (maxx + 1, y)])
        intersection = inset.intersection(scan_line)

        if not intersection.is_empty:
            segments = []
            if intersection.geom_type == "LineString":
                segments = [intersection]
            elif intersection.geom_type == "MultiLineString":
                segments = list(intersection.geoms)

            if direction == -1:
                segments = list(reversed(segments))

            for seg in segments:
                coords = list(seg.coords)
                if direction == -1:
                    coords = list(reversed(coords))
                paths.append([[round(c[0], 4), round(c[1], 4)] for c in coords])

        direction *= -1
        y += step

    return paths
