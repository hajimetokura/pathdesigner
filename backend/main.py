import uuid
from pathlib import Path

import yaml
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from pydantic import BaseModel as PydanticBaseModel

from nodes.brep_import import analyze_step_file
from nodes.contour_extract import extract_contours
from nodes.operation_detector import detect_operations
from nodes.toolpath_gen import generate_toolpath, generate_toolpath_from_operations
from sbp_writer import SbpWriter
from schemas import (
    BrepImportResult, ContourExtractRequest, ContourExtractResult,
    MachiningSettings, PresetItem, ValidateSettingsRequest, ValidateSettingsResponse,
    ToolpathGenRequest, ToolpathGenResult,
    SbpGenRequest, SbpGenResult,
    OperationDetectResult,
    StockSettings,
)

app = FastAPI(title="PathDesigner", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
PRESETS_DIR = Path(__file__).parent / "presets"


@app.get("/health")
def health():
    return {"status": "ok", "version": "0.1.0"}


@app.post("/api/upload-step", response_model=BrepImportResult)
async def upload_step(file: UploadFile):
    """Upload a STEP file and return BREP analysis results."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    suffix = Path(file.filename).suffix.lower()
    if suffix not in (".step", ".stp"):
        raise HTTPException(status_code=400, detail="Only .step/.stp files are accepted")

    file_id = uuid.uuid4().hex[:12]
    saved_path = UPLOAD_DIR / f"{file_id}{suffix}"

    content = await file.read()
    saved_path.write_bytes(content)

    try:
        objects = analyze_step_file(saved_path, file_name=file.filename)
    except ValueError as e:
        saved_path.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        saved_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"STEP analysis failed: {e}")

    return BrepImportResult(
        file_id=file_id,
        objects=objects,
        object_count=len(objects),
    )


@app.post("/api/extract-contours", response_model=ContourExtractResult)
async def extract_contours_endpoint(req: ContourExtractRequest):
    """Extract 2D contours from a previously uploaded STEP file."""
    matches = list(UPLOAD_DIR.glob(f"{req.file_id}.*"))
    if not matches:
        raise HTTPException(status_code=404, detail=f"File not found: {req.file_id}")

    step_path = matches[0]

    try:
        result = extract_contours(
            step_path=step_path,
            object_id=req.object_id,
            tool_diameter=req.tool_diameter,
            offset_side=req.offset_side,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Contour extraction failed: {e}")

    return result


@app.post("/api/validate-settings", response_model=ValidateSettingsResponse)
def validate_settings(req: ValidateSettingsRequest):
    """Validate machining settings and return warnings."""
    s = req.settings
    warnings: list[str] = []

    if s.spindle_speed < 5000:
        warnings.append(f"スピンドル速度が低すぎます ({s.spindle_speed} RPM < 5000)")
    if s.depth_per_pass > s.total_depth:
        warnings.append(
            f"パスあたりの深さ ({s.depth_per_pass}mm) が合計深さ ({s.total_depth}mm) を超えています"
        )
    if s.feed_rate.xy <= 0 or s.feed_rate.z <= 0:
        warnings.append("送り速度は正の値を指定してください")
    if s.tool.diameter <= 0:
        warnings.append("刃物径は正の値を指定してください")

    return ValidateSettingsResponse(
        valid=True,
        settings=s,
        warnings=warnings,
    )


@app.get("/api/presets", response_model=list[PresetItem])
def get_presets():
    """Return available machining presets."""
    yaml_path = PRESETS_DIR / "materials.yaml"
    if not yaml_path.exists():
        return []
    data = yaml.safe_load(yaml_path.read_text())
    result = []
    for p in data.get("presets", []):
        preset_id = p["id"]
        name = p["name"]
        material = p.get("material", "unknown")
        settings_fields = {k: v for k, v in p.items() if k not in ("id", "name", "material")}
        result.append(PresetItem(
            id=preset_id,
            name=name,
            material=material,
            settings=MachiningSettings(**settings_fields),
        ))
    return result


class DetectOperationsRequest(PydanticBaseModel):
    file_id: str
    object_ids: list[str]
    tool_diameter: float = 6.35
    offset_side: str = "outside"


@app.post("/api/detect-operations", response_model=OperationDetectResult)
def detect_operations_endpoint(req: DetectOperationsRequest):
    """Detect machining operations from uploaded STEP file."""
    matches = list(UPLOAD_DIR.glob(f"{req.file_id}.*"))
    if not matches:
        raise HTTPException(status_code=404, detail=f"File not found: {req.file_id}")

    try:
        result = detect_operations(
            step_path=matches[0],
            file_id=req.file_id,
            object_ids=req.object_ids,
            tool_diameter=req.tool_diameter,
            offset_side=req.offset_side,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Operation detection failed: {e}")

    return result


@app.post("/api/generate-toolpath", response_model=ToolpathGenResult)
def generate_toolpath_endpoint(req: ToolpathGenRequest):
    """Generate toolpath passes from operation assignments."""
    try:
        result = generate_toolpath_from_operations(
            req.operations, req.detected_operations, req.stock
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Toolpath generation failed: {e}")
    return result


@app.post("/api/generate-sbp", response_model=SbpGenResult)
def generate_sbp_endpoint(req: SbpGenRequest):
    """Generate SBP code from toolpath data + post processor settings."""
    try:
        machining = req.operations[0].settings if req.operations else None
        if not machining:
            raise ValueError("No operations provided")
        writer = SbpWriter(req.post_processor, machining, req.stock)
        sbp_code = writer.generate(req.toolpath_result.toolpaths)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SBP generation failed: {e}")
    return SbpGenResult(sbp_code=sbp_code, filename="output.sbp")
