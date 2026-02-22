"""Tests for schema validation."""

import pytest
from schemas import StockMaterial, StockSettings


def test_stock_material_defaults():
    mat = StockMaterial(material_id="mtl_1")
    assert mat.width == 600
    assert mat.depth == 400
    assert mat.thickness == 18
    assert mat.x_position == 0
    assert mat.y_position == 0
    assert mat.label == ""


def test_stock_settings_single_material():
    settings = StockSettings(
        materials=[StockMaterial(material_id="mtl_1", thickness=24)]
    )
    assert len(settings.materials) == 1
    assert settings.materials[0].thickness == 24


def test_stock_settings_multiple_materials():
    settings = StockSettings(
        materials=[
            StockMaterial(material_id="mtl_1", thickness=15),
            StockMaterial(material_id="mtl_2", thickness=24),
        ]
    )
    assert len(settings.materials) == 2


def test_stock_settings_serialization():
    settings = StockSettings(
        materials=[StockMaterial(material_id="mtl_1", label="合板 18mm")]
    )
    data = settings.model_dump()
    restored = StockSettings(**data)
    assert restored.materials[0].label == "合板 18mm"
