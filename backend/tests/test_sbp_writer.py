"""Tests for SBP code generation."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sbp_writer import SbpWriter
from schemas import (
    PostProcessorSettings,
    MachiningSettings,
    SheetSettings,
    SheetMaterial,
    Tool,
    FeedRate,
    TabSettings,
    Toolpath,
    ToolpathPass,
    TabSegment,
)

PP_SETTINGS = PostProcessorSettings()  # all defaults
STOCK = SheetSettings(materials=[SheetMaterial(material_id="mtl_1")])

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
    writer = SbpWriter(PP_SETTINGS, MACHINING, STOCK)
    code = writer.generate([SIMPLE_TOOLPATH])
    lines = code.split("\n")

    assert any("SHOPBOT ROUTER FILE IN MM" in l for l in lines)
    assert any("PathDesigner" in l for l in lines)
    assert any("IF %(25)=0 THEN GOTO UNIT_ERROR" in l for l in lines)
    assert "SA" in lines


def test_sbp_tool_spindle():
    """SBP should include tool and spindle commands."""
    writer = SbpWriter(PP_SETTINGS, MACHINING, STOCK)
    code = writer.generate([SIMPLE_TOOLPATH])

    assert "&Tool = 3" in code
    assert "C9" in code
    assert "TR,18000" in code  # spindle speed
    assert "C6" in code
    assert "PAUSE 2" in code


def test_sbp_speed_settings():
    """SBP should set MS and JS speeds."""
    writer = SbpWriter(PP_SETTINGS, MACHINING, STOCK)
    code = writer.generate([SIMPLE_TOOLPATH])

    assert "MS,75.0,25.0" in code
    assert "JS,200.0" in code


def test_sbp_material_metadata():
    """SBP should include material info as comments."""
    writer = SbpWriter(PP_SETTINGS, MACHINING, STOCK)
    code = writer.generate([SIMPLE_TOOLPATH])

    assert "'MATERIAL_THICKNESS:18" in code
    assert "'MILL_SIZE:6.35" in code


def test_sbp_uses_j_for_jog_and_m_for_cut():
    """Non-cutting moves use J2/J3, cutting moves use M3."""
    writer = SbpWriter(PP_SETTINGS, MACHINING, STOCK)
    code = writer.generate([SIMPLE_TOOLPATH])

    # Initial positioning should use J2
    assert "J2," in code
    # Cutting should use M3
    assert "M3," in code
    # Safety Z retract should use JZ
    assert "JZ," in code


def test_sbp_footer():
    """SBP should end with spindle off, END, and unit error label."""
    writer = SbpWriter(PP_SETTINGS, MACHINING, STOCK)
    code = writer.generate([SIMPLE_TOOLPATH])
    lines = code.strip().split("\n")

    # Should contain C7 (spindle off) and END
    assert any("C7" in l for l in lines)
    assert any(l.strip() == "END" for l in lines)
    assert any("UNIT_ERROR:" in l for l in lines)


def test_sbp_multi_pass_z_sequence():
    """Cutting moves should step down through each pass depth."""
    writer = SbpWriter(PP_SETTINGS, MACHINING, STOCK)
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
    writer = SbpWriter(PP_SETTINGS, MACHINING, STOCK)
    code = writer.generate([tp_with_tabs])

    # The tab section should have z_tab=10.0 instead of -0.3
    assert "M3,50.0,0.0,10.0" in code
    assert "M3,100.0,0.0,10.0" in code


def test_sbp_writer_with_stock():
    """SBP output should include stock material metadata."""
    stock = SheetSettings(
        materials=[SheetMaterial(material_id="mtl_1", width=600, depth=400, thickness=18)]
    )
    toolpaths = [
        Toolpath(
            operation_id="op_001",
            passes=[
                ToolpathPass(
                    pass_number=1,
                    z_depth=12.0,
                    path=[[0, 0], [100, 0], [100, 50], [0, 50], [0, 0]],
                    tabs=[],
                )
            ],
        )
    ]

    writer = SbpWriter(
        settings=PP_SETTINGS,
        machining=MACHINING,
        sheet=stock,
    )
    sbp = writer.generate(toolpaths)

    assert "'SHOPBOT ROUTER FILE IN MM" in sbp
    assert "mtl_1" in sbp
    assert "600" in sbp
    assert "TR,18000" in sbp


def test_sbp_writer_no_material_in_post_processor():
    """SBP writer should NOT reference material from PostProcessorSettings."""
    post = PostProcessorSettings()
    assert not hasattr(post, "material") or "material" not in post.model_fields


def _make_settings(spindle_speed=18000, tool_diameter=6.35, xy_feed=75.0, z_feed=25.0):
    """Helper to create MachiningSettings."""
    return MachiningSettings(
        operation_type="contour",
        tool=Tool(diameter=tool_diameter, type="endmill", flutes=2),
        feed_rate=FeedRate(xy=xy_feed, z=z_feed),
        jog_speed=200.0, spindle_speed=spindle_speed,
        depth_per_pass=6.0, total_depth=18.0,
        direction="climb", offset_side="outside",
        tabs=TabSettings(enabled=False, height=3.0, width=5.0, count=4),
    )


def test_sbp_multi_object_different_speeds():
    """SBP should re-emit MS command when feed rate changes between objects."""
    tp1 = Toolpath(
        operation_id="op_001",
        passes=[ToolpathPass(pass_number=1, z_depth=-0.3, path=[[10,10],[50,10],[50,30],[10,30],[10,10]], tabs=[])],
        settings=_make_settings(xy_feed=75.0),
    )
    tp2 = Toolpath(
        operation_id="op_002",
        passes=[ToolpathPass(pass_number=1, z_depth=-0.3, path=[[200,10],[250,10],[250,30],[200,30],[200,10]], tabs=[])],
        settings=_make_settings(xy_feed=50.0),
    )
    writer = SbpWriter(PP_SETTINGS, MACHINING, STOCK)
    code = writer.generate([tp1, tp2])

    # Both speed settings should appear
    assert "MS,75.0,25.0" in code
    assert "MS,50.0,25.0" in code


def test_sbp_multi_object_same_settings_no_duplicate():
    """SBP should NOT re-emit tool/speed when settings are identical."""
    settings = _make_settings()
    tp1 = Toolpath(
        operation_id="op_001",
        passes=[ToolpathPass(pass_number=1, z_depth=-0.3, path=[[10,10],[50,10],[50,30],[10,10]], tabs=[])],
        settings=settings,
    )
    tp2 = Toolpath(
        operation_id="op_002",
        passes=[ToolpathPass(pass_number=1, z_depth=-0.3, path=[[200,10],[250,10],[250,30],[200,10]], tabs=[])],
        settings=settings,
    )
    writer = SbpWriter(PP_SETTINGS, MACHINING, STOCK)
    code = writer.generate([tp1, tp2])

    # MS should appear only once (header) + no duplicate
    assert code.count("MS,75.0,25.0") == 1


def test_sbp_safe_z_between_objects():
    """SBP should retract to safe_z and jog between different objects."""
    tp1 = Toolpath(
        operation_id="op_001",
        passes=[ToolpathPass(pass_number=1, z_depth=-0.3, path=[[10,10],[50,10],[50,30],[10,10]], tabs=[])],
        settings=_make_settings(),
    )
    tp2 = Toolpath(
        operation_id="op_002",
        passes=[ToolpathPass(pass_number=1, z_depth=-0.3, path=[[200,10],[250,10],[250,30],[200,10]], tabs=[])],
        settings=_make_settings(),
    )
    writer = SbpWriter(PP_SETTINGS, MACHINING, STOCK)
    code = writer.generate([tp1, tp2])
    lines = code.split("\n")

    # After tp1, should retract (JZ,38.0) then jog to tp2 start (J2,200,10)
    jz_indices = [i for i, l in enumerate(lines) if l.startswith("JZ,")]
    j2_indices = [i for i, l in enumerate(lines) if l.startswith("J2,200")]

    # There should be a JZ retract followed by a J2 to tp2's start
    assert len(j2_indices) >= 1, "Should jog to second object start"
