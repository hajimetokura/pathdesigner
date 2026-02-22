"""Tests for Phase 4 Pydantic schemas."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from schemas import (
    TabSegment,
    ToolpathPass,
    Toolpath,
    ToolpathGenRequest,
    ToolpathGenResult,
    SpindleWarmup,
    MaterialSettings,
    PostProcessorSettings,
    SbpGenRequest,
    SbpGenResult,
    ContourExtractResult,
    MachiningSettings,
    Contour,
    OffsetApplied,
    Tool,
    FeedRate,
    TabSettings,
)


def test_toolpath_pass_serialization():
    """ToolpathPass should serialize pass data with tabs."""
    tp = ToolpathPass(
        pass_number=1,
        z_depth=12.0,
        path=[[0.0, 0.0], [100.0, 0.0], [100.0, 50.0], [0.0, 50.0], [0.0, 0.0]],
        tabs=[],
    )
    d = tp.model_dump()
    assert d["pass_number"] == 1
    assert d["z_depth"] == 12.0
    assert len(d["path"]) == 5


def test_toolpath_pass_with_tabs():
    """ToolpathPass with tabs should include tab segments."""
    tp = ToolpathPass(
        pass_number=3,
        z_depth=-0.3,
        path=[[0.0, 0.0], [100.0, 0.0], [100.0, 50.0], [0.0, 50.0], [0.0, 0.0]],
        tabs=[TabSegment(start_index=1, end_index=2, z_tab=10.0)],
    )
    assert len(tp.tabs) == 1
    assert tp.tabs[0].z_tab == 10.0


def test_toolpath_gen_result():
    """ToolpathGenResult should wrap toolpaths."""
    result = ToolpathGenResult(
        toolpaths=[
            Toolpath(
                operation_id="op_001",
                passes=[
                    ToolpathPass(
                        pass_number=1,
                        z_depth=12.0,
                        path=[[0.0, 0.0], [100.0, 0.0]],
                        tabs=[],
                    )
                ],
            )
        ]
    )
    assert len(result.toolpaths) == 1
    assert result.toolpaths[0].operation_id == "op_001"


def test_post_processor_settings_defaults():
    """PostProcessorSettings should have sensible defaults."""
    pp = PostProcessorSettings()
    assert pp.machine == "shopbot"
    assert pp.safe_z == 38.0
    assert pp.unit == "mm"
    assert pp.tool_number == 3
    assert pp.spindle_warmup.initial_rpm == 5000
    assert pp.material.thickness == 18


def test_sbp_gen_result():
    """SbpGenResult should contain code and filename."""
    r = SbpGenResult(sbp_code="SA\nEND", filename="part.sbp")
    assert "SA" in r.sbp_code
    assert r.filename.endswith(".sbp")
