"""Tests for SBP Writer 3D path support."""

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


def _make_settings(**overrides) -> MachiningSettings:
    defaults = dict(
        operation_type="contour",
        tool=Tool(diameter=6.0, type="ballnose", flutes=2),
        feed_rate=FeedRate(xy=60, z=20),
        jog_speed=200,
        spindle_speed=18000,
        depth_per_pass=3.0,
        total_depth=10.0,
        direction="climb",
        offset_side="none",
        tabs=TabSettings(enabled=False, height=0, width=0, count=0),
    )
    defaults.update(overrides)
    return MachiningSettings(**defaults)


def _make_post() -> PostProcessorSettings:
    return PostProcessorSettings(safe_z=38.0)


def test_3d_path_generates_m3_with_per_point_z():
    """3D paths ([[x,y,z]]) should use per-point Z, not z_depth."""
    settings = _make_settings()
    post = _make_post()
    writer = SbpWriter(settings=post, machining=settings)

    tp = Toolpath(
        operation_id="op1",
        passes=[
            ToolpathPass(
                pass_number=1,
                z_depth=-10.0,
                path=[[0, 0, -2], [10, 0, -5], [20, 0, -3], [20, 10, -8]],
                tabs=[],
            )
        ],
    )

    sbp = writer.generate([tp])
    lines = sbp.split("\n")

    m3_lines = [l for l in lines if l.startswith("M3,")]
    # Values may be int or float formatted
    assert m3_lines[0] in ("M3,0,0,-2", "M3,0.0,0.0,-2.0")
    assert m3_lines[1] in ("M3,10,0,-5", "M3,10.0,0.0,-5.0")
    assert m3_lines[2] in ("M3,20,0,-3", "M3,20.0,0.0,-3.0")
    assert m3_lines[3] in ("M3,20,10,-8", "M3,20.0,10.0,-8.0")


def test_2d_path_still_uses_z_depth():
    """2D paths ([[x,y]]) should still use z_depth as before."""
    settings = _make_settings()
    post = _make_post()
    writer = SbpWriter(settings=post, machining=settings)

    tp = Toolpath(
        operation_id="op1",
        passes=[
            ToolpathPass(
                pass_number=1,
                z_depth=-6.0,
                path=[[0, 0], [10, 0], [10, 10], [0, 10]],
                tabs=[],
            )
        ],
    )

    sbp = writer.generate([tp])
    lines = sbp.split("\n")

    m3_lines = [l for l in lines if l.startswith("M3,")]
    for line in m3_lines:
        assert line.endswith("-6.0") or line.endswith("-6")


def test_mixed_2d_3d_toolpaths():
    """A mix of 2D and 3D toolpaths should work in the same SBP file."""
    settings = _make_settings()
    post = _make_post()
    writer = SbpWriter(settings=post, machining=settings)

    tp_2d = Toolpath(
        operation_id="op_2d",
        passes=[
            ToolpathPass(pass_number=1, z_depth=-6.0, path=[[0, 0], [10, 0]], tabs=[])
        ],
    )
    tp_3d = Toolpath(
        operation_id="op_3d",
        passes=[
            ToolpathPass(
                pass_number=1,
                z_depth=-10.0,
                path=[[50, 0, -2], [60, 0, -5]],
                tabs=[],
            )
        ],
    )

    sbp = writer.generate([tp_2d, tp_3d])
    assert "M3,0.0,0.0,-6.0" in sbp or "M3,0,0,-6" in sbp
    assert "M3,50.0,0.0,-2.0" in sbp or "M3,50,0,-2" in sbp
    assert "M3,60.0,0.0,-5.0" in sbp or "M3,60,0,-5" in sbp
