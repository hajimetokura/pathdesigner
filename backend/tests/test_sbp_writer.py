"""Tests for SBP code generation."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sbp_writer import SbpWriter
from schemas import (
    PostProcessorSettings,
    MachiningSettings,
    Tool,
    FeedRate,
    TabSettings,
    Toolpath,
    ToolpathPass,
    TabSegment,
)

PP_SETTINGS = PostProcessorSettings()  # all defaults

MACHINING = MachiningSettings(
    operation_type="contour",
    tool=Tool(diameter=6.35, type="endmill", flutes=2),
    feed_rate=FeedRate(xy=75.0, z=25.0),
    jog_speed=200.0,
    spindle_speed=18000,
    depth_per_pass=6.0,
    total_depth=18.0,
    direction="climb",
    offset_side="outside",
    tabs=TabSettings(enabled=False, height=3.0, width=5.0, count=4),
)

SIMPLE_TOOLPATH = Toolpath(
    operation_id="op_001",
    passes=[
        ToolpathPass(
            pass_number=1,
            z_depth=12.0,
            path=[[10.0, 20.0], [100.0, 20.0], [100.0, 50.0], [10.0, 50.0], [10.0, 20.0]],
            tabs=[],
        ),
        ToolpathPass(
            pass_number=2,
            z_depth=6.0,
            path=[[10.0, 20.0], [100.0, 20.0], [100.0, 50.0], [10.0, 50.0], [10.0, 20.0]],
            tabs=[],
        ),
        ToolpathPass(
            pass_number=3,
            z_depth=-0.3,
            path=[[10.0, 20.0], [100.0, 20.0], [100.0, 50.0], [10.0, 50.0], [10.0, 20.0]],
            tabs=[],
        ),
    ],
)


def test_sbp_header():
    """SBP output should start with header comments and unit check."""
    writer = SbpWriter(PP_SETTINGS, MACHINING)
    code = writer.generate([SIMPLE_TOOLPATH])
    lines = code.split("\n")

    assert any("SHOPBOT ROUTER FILE IN MM" in l for l in lines)
    assert any("PathDesigner" in l for l in lines)
    assert any("IF %(25)=0 THEN GOTO UNIT_ERROR" in l for l in lines)
    assert "SA" in lines


def test_sbp_tool_spindle():
    """SBP should include tool and spindle commands."""
    writer = SbpWriter(PP_SETTINGS, MACHINING)
    code = writer.generate([SIMPLE_TOOLPATH])

    assert "&Tool = 3" in code
    assert "C9" in code
    assert "TR,5000" in code  # warmup RPM
    assert "C6" in code
    assert "PAUSE 2" in code


def test_sbp_speed_settings():
    """SBP should set MS and JS speeds."""
    writer = SbpWriter(PP_SETTINGS, MACHINING)
    code = writer.generate([SIMPLE_TOOLPATH])

    assert "MS,75.0,25.0" in code
    assert "JS,200.0" in code


def test_sbp_material_metadata():
    """SBP should include material info as comments."""
    writer = SbpWriter(PP_SETTINGS, MACHINING)
    code = writer.generate([SIMPLE_TOOLPATH])

    assert "'MATERIAL_THICKNESS:18" in code
    assert "'MILL_SIZE:6.35" in code


def test_sbp_uses_j_for_jog_and_m_for_cut():
    """Non-cutting moves use J2/J3, cutting moves use M3."""
    writer = SbpWriter(PP_SETTINGS, MACHINING)
    code = writer.generate([SIMPLE_TOOLPATH])

    # Initial positioning should use J2
    assert "J2," in code
    # Cutting should use M3
    assert "M3," in code
    # Safety Z retract should use JZ
    assert "JZ," in code


def test_sbp_footer():
    """SBP should end with spindle off, END, and unit error label."""
    writer = SbpWriter(PP_SETTINGS, MACHINING)
    code = writer.generate([SIMPLE_TOOLPATH])
    lines = code.strip().split("\n")

    # Should contain C7 (spindle off) and END
    assert any("C7" in l for l in lines)
    assert any(l.strip() == "END" for l in lines)
    assert any("UNIT_ERROR:" in l for l in lines)


def test_sbp_multi_pass_z_sequence():
    """Cutting moves should step down through each pass depth."""
    writer = SbpWriter(PP_SETTINGS, MACHINING)
    code = writer.generate([SIMPLE_TOOLPATH])

    # All three Z depths should appear in M3 commands
    assert "M3,10.0,20.0,12.0" in code
    assert "M3,10.0,20.0,6.0" in code
    assert "M3,10.0,20.0,-0.3" in code


def test_sbp_with_tabs():
    """Tab segments should lift Z during final pass."""
    tp_with_tabs = Toolpath(
        operation_id="op_001",
        passes=[
            ToolpathPass(
                pass_number=1,
                z_depth=-0.3,
                path=[[0.0, 0.0], [50.0, 0.0], [100.0, 0.0], [100.0, 50.0], [0.0, 0.0]],
                tabs=[TabSegment(start_index=1, end_index=2, z_tab=10.0)],
            ),
        ],
    )
    writer = SbpWriter(PP_SETTINGS, MACHINING)
    code = writer.generate([tp_with_tabs])

    # The tab section should have z_tab=10.0 instead of -0.3
    assert "M3,50.0,0.0,10.0" in code
    assert "M3,100.0,0.0,10.0" in code
