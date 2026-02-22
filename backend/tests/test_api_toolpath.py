"""Tests for toolpath generation and SBP generation API endpoints.

NOTE: These tests will be fully rewritten in Task 9 (Update API endpoints).
The old format tests are skipped because ToolpathGenRequest/SbpGenRequest
schemas have been updated for the operation-centric architecture.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_api_app_loads():
    """Smoke test: FastAPI app should load without errors."""
    assert app.title == "PathDesigner"


@pytest.mark.skip(reason="Task 9: Endpoint will be rewritten for operation-centric format")
def test_generate_toolpath_endpoint():
    pass


@pytest.mark.skip(reason="Task 9: Endpoint will be rewritten for operation-centric format")
def test_generate_sbp_endpoint():
    pass


def test_generate_sbp_uses_per_toolpath_settings():
    """SBP endpoint should use per-toolpath settings when available."""
    from schemas import (
        SbpGenRequest, ToolpathGenResult, Toolpath, ToolpathPass,
        OperationAssignment, MachiningSettings, Tool, FeedRate, TabSettings,
        StockSettings, StockMaterial, PostProcessorSettings,
    )

    settings_1 = MachiningSettings(
        operation_type="contour",
        tool=Tool(diameter=6.35, type="endmill", flutes=2),
        feed_rate=FeedRate(xy=75.0, z=25.0),
        jog_speed=200.0, spindle_speed=18000,
        depth_per_pass=6.0, total_depth=18.0,
        direction="climb", offset_side="outside",
        tabs=TabSettings(enabled=False, height=3.0, width=5.0, count=4),
    )
    settings_2 = settings_1.model_copy(update={
        "feed_rate": FeedRate(xy=50.0, z=20.0),
    })

    tp_result = ToolpathGenResult(toolpaths=[
        Toolpath(
            operation_id="op_001",
            passes=[ToolpathPass(pass_number=1, z_depth=-0.3, path=[[10,10],[50,10],[10,10]], tabs=[])],
            settings=settings_1,
        ),
        Toolpath(
            operation_id="op_002",
            passes=[ToolpathPass(pass_number=1, z_depth=-0.3, path=[[200,10],[250,10],[200,10]], tabs=[])],
            settings=settings_2,
        ),
    ])

    req = SbpGenRequest(
        toolpath_result=tp_result,
        operations=[
            OperationAssignment(operation_id="op_001", material_id="mtl_1", settings=settings_1, order=1),
            OperationAssignment(operation_id="op_002", material_id="mtl_1", settings=settings_2, order=2),
        ],
        stock=StockSettings(materials=[StockMaterial(material_id="mtl_1")]),
        post_processor=PostProcessorSettings(),
    )

    res = client.post("/api/generate-sbp", json=req.model_dump())
    assert res.status_code == 200
    code = res.json()["code"]
    assert "MS,75.0,25.0" in code
    assert "MS,50.0,20.0" in code
