"""Tests for SBP tool change commands between operations."""

from sbp_writer import SbpWriter
from schemas import (
    MachiningSettings,
    PostProcessorSettings,
    Tool,
    FeedRate,
    TabSettings,
    Toolpath,
    ToolpathPass,
)


def _make_settings(tool_diameter: float, tool_type: str, spindle: int) -> MachiningSettings:
    return MachiningSettings(
        operation_type="contour",
        tool=Tool(diameter=tool_diameter, type=tool_type, flutes=2),
        feed_rate=FeedRate(xy=50, z=20),
        jog_speed=200,
        spindle_speed=spindle,
        depth_per_pass=6.0,
        total_depth=18.0,
        direction="climb",
        offset_side="none",
        tabs=TabSettings(enabled=False, height=0, width=0, count=0),
    )


def _make_toolpath(op_id: str, settings: MachiningSettings) -> Toolpath:
    return Toolpath(
        operation_id=op_id,
        object_id="obj_001",
        contour_type="exterior",
        passes=[ToolpathPass(
            pass_number=1,
            z_depth=-5.0,
            path=[[0, 0, -5], [10, 0, -5], [10, 10, -5]],
            tabs=[],
        )],
        settings=settings,
    )


def test_tool_change_emitted_when_tool_differs():
    """When consecutive toolpaths have different tools, emit tool change commands."""
    roughing = _make_settings(6.35, "endmill", 18000)
    finishing = _make_settings(3.175, "ballnose", 18000)

    tp1 = _make_toolpath("roughing", roughing)
    tp2 = _make_toolpath("finishing", finishing)

    writer = SbpWriter(PostProcessorSettings(), roughing)
    sbp = writer.generate([tp1, tp2])

    assert "C8" in sbp, "Expected C8 (spindle stop) before tool change"
    assert "C9" in sbp.split("C8", 1)[1], "Expected C9 (spindle on) after tool change"


def test_no_tool_change_when_same_tool():
    """When consecutive toolpaths use the same tool, no tool change."""
    settings = _make_settings(6.35, "endmill", 18000)
    tp1 = _make_toolpath("op1", settings)
    tp2 = _make_toolpath("op2", settings)

    writer = SbpWriter(PostProcessorSettings(), settings)
    sbp = writer.generate([tp1, tp2])

    lines = sbp.split("\n")
    c8_count = sum(1 for l in lines if l.strip() == "C8")
    assert c8_count == 0, f"Expected no C8 for same tool, got {c8_count}"


def test_tool_change_includes_safe_retract():
    """Tool change should retract to safe Z before changing."""
    roughing = _make_settings(6.35, "endmill", 18000)
    finishing = _make_settings(3.175, "ballnose", 18000)

    tp1 = _make_toolpath("roughing", roughing)
    tp2 = _make_toolpath("finishing", finishing)

    post = PostProcessorSettings()
    writer = SbpWriter(post, roughing)
    sbp = writer.generate([tp1, tp2])

    lines = sbp.split("\n")
    c8_idx = next(i for i, l in enumerate(lines) if l.strip() == "C8")
    preceding = lines[:c8_idx]
    jz_lines = [l for l in preceding if l.startswith("JZ,")]
    assert len(jz_lines) > 0, "Expected JZ retract before tool change"
