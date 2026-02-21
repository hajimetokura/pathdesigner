"""Tests for machining settings schemas and validation."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from schemas import MachiningSettings, Tool, FeedRate, TabSettings


def test_machining_settings_defaults():
    """MachiningSettings can be created with all required fields."""
    settings = MachiningSettings(
        operation_type="contour",
        tool=Tool(diameter=6.35, type="endmill", flutes=2),
        feed_rate=FeedRate(xy=75.0, z=25.0),
        jog_speed=200.0,
        spindle_speed=18000,
        depth_per_pass=6.0,
        total_depth=12.0,
        direction="climb",
        offset_side="outside",
        tabs=TabSettings(enabled=True, height=3.0, width=5.0, count=4),
    )
    assert settings.operation_type == "contour"
    assert settings.tool.diameter == 6.35
    assert settings.tabs.enabled is True


def test_machining_settings_serialization():
    """MachiningSettings round-trips through JSON."""
    settings = MachiningSettings(
        operation_type="contour",
        tool=Tool(diameter=6.35, type="endmill", flutes=2),
        feed_rate=FeedRate(xy=75.0, z=25.0),
        jog_speed=200.0,
        spindle_speed=18000,
        depth_per_pass=6.0,
        total_depth=12.0,
        direction="climb",
        offset_side="outside",
        tabs=TabSettings(enabled=False, height=0, width=0, count=0),
    )
    data = settings.model_dump()
    restored = MachiningSettings(**data)
    assert restored == settings
