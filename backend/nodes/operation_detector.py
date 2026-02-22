"""Operation Detector — analyze BREP and detect required machining operations."""

from pathlib import Path

from nodes.contour_extract import extract_contours
from schemas import (
    DetectedOperation,
    MachiningSettings,
    OperationDetectResult,
    OperationGeometry,
    Tool,
    FeedRate,
    TabSettings,
)


# Default suggested settings for contour operations
_DEFAULT_CONTOUR_SETTINGS = dict(
    operation_type="contour",
    tool=Tool(diameter=6.35, type="endmill", flutes=2),
    feed_rate=FeedRate(xy=75, z=25),
    jog_speed=200,
    spindle_speed=18000,
    depth_per_pass=6.0,
    total_depth=18.0,  # will be overridden by actual thickness
    direction="climb",
    offset_side="outside",
    tabs=TabSettings(enabled=True, height=8, width=5, count=4),
)


def detect_operations(
    step_path: str | Path,
    file_id: str,
    object_ids: list[str],
    tool_diameter: float = 6.35,
    offset_side: str = "outside",
) -> OperationDetectResult:
    """Detect machining operations from BREP geometry.

    v1: Detects contour (exterior outline) operations only.
    Future: pocket, drill, engrave detection.
    """
    operations: list[DetectedOperation] = []

    for i, object_id in enumerate(object_ids):
        contour_result = extract_contours(
            step_path=step_path,
            object_id=object_id,
            tool_diameter=tool_diameter,
            offset_side=offset_side,
        )

        # Build suggested settings with actual object thickness
        suggested = MachiningSettings(
            **{**_DEFAULT_CONTOUR_SETTINGS, "total_depth": contour_result.thickness}
        )
        if tool_diameter != 6.35:
            suggested = suggested.model_copy(
                update={"tool": Tool(diameter=tool_diameter, type="endmill", flutes=2)}
            )

        operations.append(
            DetectedOperation(
                operation_id=f"op_{i + 1:03d}",
                object_id=object_id,
                operation_type="contour",
                geometry=OperationGeometry(
                    contours=contour_result.contours,
                    offset_applied=contour_result.offset_applied,
                    depth=contour_result.thickness,
                ),
                suggested_settings=suggested,
            )
        )

    return OperationDetectResult(operations=operations)
