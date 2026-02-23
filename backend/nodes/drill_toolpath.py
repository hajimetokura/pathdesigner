"""Drill toolpath generation: peck drilling cycle."""

import math

from schemas import ToolpathPass

# Penetration below material bottom (mm)
PENETRATION_MARGIN = 0.3


def generate_drill_toolpath(
    center: list[float],
    total_depth: float,
    depth_per_peck: float = 6.0,
    safe_z: float = 38.0,
) -> list[ToolpathPass]:
    """Generate peck drill cycle passes.

    Each pass drills deeper, retracts to safe_z, then plunges to next depth.
    Final pass includes penetration margin.

    Returns list of ToolpathPass with single-point paths at the drill center.
    """
    num_pecks = math.ceil(total_depth / depth_per_peck)
    passes: list[ToolpathPass] = []

    for i in range(num_pecks):
        pass_number = i + 1
        is_final = pass_number == num_pecks

        if is_final:
            z_depth = -(total_depth + PENETRATION_MARGIN)
        else:
            z_depth = -(pass_number * depth_per_peck)

        passes.append(
            ToolpathPass(
                pass_number=pass_number,
                z_depth=z_depth,
                path=[center],
                tabs=[],
            )
        )

    return passes
