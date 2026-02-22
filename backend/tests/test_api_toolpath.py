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
