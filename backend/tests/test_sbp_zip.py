"""Tests for /api/generate-sbp-zip endpoint."""

import io
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi.testclient import TestClient
from main import app

from schemas import (
    BoundingBox,
    Contour,
    DetectedOperation,
    FeedRate,
    MachiningSettings,
    OffsetApplied,
    OperationAssignment,
    OperationDetectResult,
    OperationGeometry,
    PlacementItem,
    PostProcessorSettings,
    SbpZipRequest,
    SheetMaterial,
    SheetSettings,
    TabSettings,
    Tool,
)

client = TestClient(app)


def _make_settings() -> MachiningSettings:
    return MachiningSettings(
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


def _make_zip_request(sheet_ids: list[str]) -> dict:
    """Build a SbpZipRequest with parts on the given sheet_ids."""
    settings = _make_settings()
    contour = Contour(
        id="c_001", type="exterior",
        coords=[[0, 0], [100, 0], [100, 50], [0, 50], [0, 0]],
        closed=True,
    )
    operations = []
    assignments = []
    placements = []

    for i, sid in enumerate(sheet_ids):
        obj_id = f"obj_{i + 1:03d}"
        op_id = f"op_{i + 1:03d}"
        operations.append(DetectedOperation(
            operation_id=op_id,
            object_id=obj_id,
            operation_type="contour",
            geometry=OperationGeometry(
                contours=[contour],
                offset_applied=OffsetApplied(distance=3.175, side="outside"),
                depth=18.0,
            ),
            suggested_settings=settings,
        ))
        assignments.append(OperationAssignment(
            operation_id=op_id,
            material_id="mtl_1",
            settings=settings,
            order=i + 1,
        ))
        placements.append(PlacementItem(
            object_id=obj_id,
            material_id="mtl_1",
            sheet_id=sid,
            x_offset=10 + i * 120,
            y_offset=10,
        ))

    req = SbpZipRequest(
        operations=assignments,
        detected_operations=OperationDetectResult(operations=operations),
        sheet=SheetSettings(materials=[SheetMaterial(material_id="mtl_1")]),
        placements=placements,
        post_processor=PostProcessorSettings(),
    )
    return req.model_dump()


def test_generate_sbp_zip_single_stock():
    """ZIP with a single stock should contain one .sbp file."""
    body = _make_zip_request(["stock_1"])
    resp = client.post("/api/generate-sbp-zip", json=body)
    assert resp.status_code == 200
    assert "application/zip" in resp.headers["content-type"]

    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()
    assert names == ["stock_1.sbp"]
    content = zf.read("stock_1.sbp").decode("utf-8")
    assert "SA" in content  # SBP absolute move command


def test_generate_sbp_zip_multi_stock():
    """ZIP with multiple stocks should contain one .sbp per stock."""
    body = _make_zip_request(["stock_1", "stock_1", "stock_2"])
    resp = client.post("/api/generate-sbp-zip", json=body)
    assert resp.status_code == 200

    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = sorted(zf.namelist())
    assert names == ["stock_1.sbp", "stock_2.sbp"]
    for name in names:
        content = zf.read(name).decode("utf-8")
        assert len(content) > 0


def test_generate_sbp_zip_content_disposition():
    """Response should have correct Content-Disposition header."""
    body = _make_zip_request(["stock_1"])
    resp = client.post("/api/generate-sbp-zip", json=body)
    assert "pathdesigner_sheets.zip" in resp.headers.get("content-disposition", "")
