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


import yaml

PRESETS_DIR = Path(__file__).parent.parent / "presets"


def test_presets_yaml_valid():
    """Presets YAML loads and each preset produces valid MachiningSettings."""
    yaml_path = PRESETS_DIR / "materials.yaml"
    assert yaml_path.exists(), "materials.yaml not found"

    data = yaml.safe_load(yaml_path.read_text())
    assert "presets" in data
    assert len(data["presets"]) >= 1

    for p in data["presets"]:
        assert "id" in p
        assert "name" in p
        settings_fields = {k: v for k, v in p.items() if k not in ("id", "name", "material")}
        MachiningSettings(**settings_fields)


from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_get_presets_endpoint():
    """GET /api/presets returns preset list."""
    res = client.get("/api/presets")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    first = data[0]
    assert "id" in first
    assert "name" in first
    assert "settings" in first


def _make_settings(**overrides):
    """Helper to create a valid settings dict with overrides."""
    base = {
        "operation_type": "contour",
        "tool": {"diameter": 6.35, "type": "endmill", "flutes": 2},
        "feed_rate": {"xy": 75.0, "z": 25.0},
        "jog_speed": 200.0,
        "spindle_speed": 18000,
        "depth_per_pass": 6.0,
        "total_depth": 12.0,
        "direction": "climb",
        "offset_side": "outside",
        "tabs": {"enabled": True, "height": 3.0, "width": 5.0, "count": 4},
    }
    for key, val in overrides.items():
        if isinstance(val, dict) and key in base and isinstance(base[key], dict):
            base[key].update(val)
        else:
            base[key] = val
    return base


def test_validate_settings_valid():
    """Valid settings return valid=True with no warnings."""
    res = client.post("/api/validate-settings", json={"settings": _make_settings()})
    assert res.status_code == 200
    data = res.json()
    assert data["valid"] is True
    assert data["warnings"] == []


def test_validate_settings_low_spindle():
    """Low spindle speed produces a warning."""
    res = client.post(
        "/api/validate-settings",
        json={"settings": _make_settings(spindle_speed=3000)},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["valid"] is True  # warning, not error
    assert any("スピンドル" in w for w in data["warnings"])


def test_validate_settings_depth_exceeds_total():
    """depth_per_pass > total_depth produces a warning."""
    res = client.post(
        "/api/validate-settings",
        json={"settings": _make_settings(depth_per_pass=20.0, total_depth=12.0)},
    )
    assert res.status_code == 200
    data = res.json()
    assert any("深さ" in w for w in data["warnings"])
