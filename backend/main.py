import asyncio
import io
import json
import uuid
import zipfile
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

import yaml
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from nodes.align import align_solids
from nodes.brep_import import analyze_step_file, _analyze_solid
from nodes.contour_extract import extract_contours
from nodes.mesh_export import tessellate_step_file
from nodes.operation_detector import detect_operations
from nodes.toolpath_gen import generate_toolpath, generate_toolpath_from_operations
from nodes.ai_cad import execute_build123d_code, CodeExecutionError
from llm_client import LLMClient
from db import GenerationDB, SnippetsDB
from sbp_writer import SbpWriter
from schemas import (
    BrepImportResult, ContourExtractRequest, ContourExtractResult,
    MachiningSettings, PresetItem, ValidateSettingsRequest, ValidateSettingsResponse,
    ToolpathGenRequest, ToolpathGenResult,
    SbpGenRequest, OutputResult,
    DetectOperationsRequest, OperationDetectResult,
    SheetSettings, SheetMaterial, BoundingBox,
    MeshDataRequest, MeshDataResult, ObjectMesh,
    PlacementItem, ValidatePlacementRequest, ValidatePlacementResponse,
    AutoNestingRequest, AutoNestingResponse,
    SbpZipRequest,
    AlignPartsRequest,
    AiCadRequest, AiCadCodeRequest, AiCadResult,
    AiCadRefineRequest, AiCadRefineResult, ChatMessage,
    GenerationSummary, ModelInfo, ProfileInfo,
    SnippetSaveRequest, SnippetInfo, SnippetListResponse,
)

app = FastAPI(title="PathDesigner", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
PRESETS_DIR = Path(__file__).parent / "presets"

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)
GENERATIONS_DIR = DATA_DIR / "generations"
GENERATIONS_DIR.mkdir(exist_ok=True)

_db: GenerationDB | None = None
_llm: LLMClient | None = None
_snippets_db: SnippetsDB | None = None


async def _get_db() -> GenerationDB:
    global _db
    if _db is None:
        _db = GenerationDB(DATA_DIR / "pathdesigner.db")
        await _db.init()
    return _db


async def _get_snippets_db() -> SnippetsDB:
    global _snippets_db
    if _snippets_db is None:
        _snippets_db = SnippetsDB(DATA_DIR / "pathdesigner.db")
        await _snippets_db.init()
    return _snippets_db


def _get_llm() -> LLMClient:
    global _llm
    if _llm is None:
        _llm = LLMClient()
    return _llm


@app.on_event("shutdown")
async def shutdown():
    if _db is not None:
        await _db.close()
    if _snippets_db is not None:
        await _snippets_db.close()


def _get_uploaded_step_path(file_id: str) -> Path:
    """Resolve a file_id to its uploaded STEP file path, or raise 404."""
    matches = list(UPLOAD_DIR.glob(f"{file_id}.*"))
    if not matches:
        raise HTTPException(status_code=404, detail=f"File not found: {file_id}")
    return matches[0]


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


@app.post("/api/align-parts", response_model=BrepImportResult)
def align_parts_endpoint(req: AlignPartsRequest):
    """Rotate assembled parts flat for CNC and re-analyze."""
    from build123d import import_step, Compound
    from build123d import export_step as bd_export_step

    step_path = _get_uploaded_step_path(req.file_id)

    try:
        compound = import_step(str(step_path))
        solids = list(compound.solids())
        if not solids:
            raise HTTPException(status_code=422, detail="No solids found")

        aligned = align_solids(solids)

        # Export aligned solids as new STEP
        new_compound = Compound(children=aligned)
        new_file_id = uuid.uuid4().hex[:12]
        new_path = UPLOAD_DIR / f"{new_file_id}.step"
        bd_export_step(new_compound, str(new_path))

        # Re-analyze each aligned solid
        objects = [
            _analyze_solid(s, index=i, file_name="aligned.step")
            for i, s in enumerate(aligned)
        ]

        return BrepImportResult(
            file_id=new_file_id,
            objects=objects,
            object_count=len(objects),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Align failed: {e}")


@app.post("/api/extract-contours", response_model=ContourExtractResult)
async def extract_contours_endpoint(req: ContourExtractRequest):
    """Extract 2D contours from a previously uploaded STEP file."""
    step_path = _get_uploaded_step_path(req.file_id)

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


@app.post("/api/detect-operations", response_model=OperationDetectResult)
def detect_operations_endpoint(req: DetectOperationsRequest):
    """Detect machining operations from uploaded STEP file."""
    step_path = _get_uploaded_step_path(req.file_id)

    try:
        result = detect_operations(
            step_path=step_path,
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
            req.operations, req.detected_operations, req.sheet,
            req.placements, req.object_origins, req.bounding_boxes
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Toolpath generation failed: {e}")
    return result


def _generate_sbp_code(
    toolpaths: list,
    operations: list,
    post_processor,
    sheet,
) -> str:
    """Build SBP code from toolpaths using the first operation's settings."""
    if not operations:
        raise ValueError("No operations provided")
    machining = operations[0].settings
    writer = SbpWriter(post_processor, machining, sheet)
    return writer.generate(toolpaths)


@app.post("/api/generate-sbp", response_model=OutputResult)
def generate_sbp_endpoint(req: SbpGenRequest):
    """Generate SBP code from toolpath data + post processor settings."""
    try:
        sbp_code = _generate_sbp_code(
            req.toolpath_result.toolpaths, req.operations, req.post_processor, req.sheet
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SBP generation failed: {e}")
    return OutputResult(code=sbp_code, filename="output.sbp", format="sbp")


@app.post("/api/mesh-data", response_model=MeshDataResult)
def mesh_data_endpoint(req: MeshDataRequest):
    """Return tessellated mesh data for 3D preview."""
    step_path = _get_uploaded_step_path(req.file_id)

    try:
        raw_meshes = tessellate_step_file(step_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Tessellation failed: {e}")

    objects = [ObjectMesh(**m) for m in raw_meshes]
    return MeshDataResult(objects=objects)


@app.post("/api/auto-nesting", response_model=AutoNestingResponse)
def auto_nesting_endpoint(req: AutoNestingRequest):
    """Run BLF auto-nesting to distribute parts across sheets."""
    from nodes.nesting import auto_nesting

    placements = auto_nesting(
        req.objects, req.sheet, req.tool_diameter, req.clearance,
    )
    sheet_ids = set(p.sheet_id for p in placements)
    # Warn about parts that don't fit
    warnings = []
    for p in placements:
        obj = next((o for o in req.objects if o.object_id == p.object_id), None)
        if obj and p.x_offset == 0 and p.y_offset == 0 and p.rotation == 0:
            bb = obj.bounding_box
            tmpl = req.sheet.materials[0] if req.sheet.materials else None
            if tmpl and (bb.x > tmpl.width or bb.y > tmpl.depth):
                warnings.append(f"{p.object_id}: シートに収まりません")
    return AutoNestingResponse(
        placements=placements,
        sheet_count=len(sheet_ids),
        warnings=warnings,
    )


def _validate_placement(
    placement: PlacementItem,
    sheet_mat: SheetMaterial,
    bb: BoundingBox,
) -> list[str]:
    """Check if a placed object fits within sheet bounds."""
    warnings = []
    if placement.x_offset + bb.x > sheet_mat.width:
        warnings.append(
            f"{placement.object_id}: X方向がSheetを超えています "
            f"({placement.x_offset + bb.x:.1f} > {sheet_mat.width:.1f}mm)"
        )
    if placement.y_offset + bb.y > sheet_mat.depth:
        warnings.append(
            f"{placement.object_id}: Y方向がSheetを超えています "
            f"({placement.y_offset + bb.y:.1f} > {sheet_mat.depth:.1f}mm)"
        )
    if placement.x_offset < 0:
        warnings.append(f"{placement.object_id}: X方向が負の位置です")
    if placement.y_offset < 0:
        warnings.append(f"{placement.object_id}: Y方向が負の位置です")
    return warnings


@app.post("/api/validate-placement", response_model=ValidatePlacementResponse)
def validate_placement_endpoint(req: ValidatePlacementRequest):
    """Validate part placements on sheet (bounds + collision)."""
    from shapely.geometry import Polygon, box as shapely_box
    from shapely.affinity import translate
    from nodes.geometry_utils import rotate_polygon

    mat_lookup = {m.material_id: m for m in req.sheet.materials}
    all_warnings: list[str] = []

    # 1. Bounds check per part
    for p in req.placements:
        sheet_mat = mat_lookup.get(p.material_id)
        bb = req.bounding_boxes.get(p.object_id)
        if sheet_mat and bb:
            all_warnings.extend(_validate_placement(p, sheet_mat, bb))

    # 2. Collision check between pairs on the same sheet
    if len(req.placements) >= 2:
        # Build polygon per placement
        placement_polys: list[tuple[PlacementItem, Polygon]] = []
        for p in req.placements:
            bb = req.bounding_boxes.get(p.object_id)
            if not bb:
                continue
            outline = req.outlines.get(p.object_id, [])
            if len(outline) >= 3:
                poly = Polygon(outline)
            else:
                poly = shapely_box(0, 0, bb.x, bb.y)

            # Rotate around BB center
            if p.rotation:
                cx, cy = bb.x / 2, bb.y / 2
                poly = rotate_polygon(poly, p.rotation, (cx, cy))

            # Tool diameter margin
            if req.tool_diameter > 0:
                poly = poly.buffer(req.tool_diameter / 2)

            # Translate to placement position
            poly = translate(poly, p.x_offset, p.y_offset)
            placement_polys.append((p, poly))

        # Group by sheet_id and check collisions within each group
        from itertools import groupby
        sorted_by_sheet = sorted(placement_polys, key=lambda x: x[0].sheet_id)
        for _sheet_id, group in groupby(sorted_by_sheet, key=lambda x: x[0].sheet_id):
            items = list(group)
            for i in range(len(items)):
                for j in range(i + 1, len(items)):
                    if items[i][1].intersects(items[j][1]):
                        all_warnings.append(
                            f"衝突: {items[i][0].object_id} と {items[j][0].object_id} が重なっています"
                        )

    return ValidatePlacementResponse(
        valid=len(all_warnings) == 0,
        warnings=all_warnings,
    )


@app.post("/api/generate-sbp-zip")
def generate_sbp_zip_endpoint(req: SbpZipRequest):
    """Generate SBP files for all sheets and return as ZIP."""
    # Group placements by sheet_id
    sheet_groups: dict[str, list[PlacementItem]] = {}
    for p in req.placements:
        sheet_groups.setdefault(p.sheet_id, []).append(p)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for sheet_id in sorted(sheet_groups.keys()):
            sheet_placements = sheet_groups[sheet_id]
            sheet_object_ids = {p.object_id for p in sheet_placements}

            # Filter assignments for this sheet
            op_to_obj = {
                op.operation_id: op.object_id
                for op in req.detected_operations.operations
            }
            filtered_ops = [
                a for a in req.operations
                if op_to_obj.get(a.operation_id) in sheet_object_ids
            ]
            if not filtered_ops:
                continue

            # Generate toolpath for this sheet
            tp_result = generate_toolpath_from_operations(
                filtered_ops, req.detected_operations, req.sheet,
                sheet_placements, req.object_origins, req.bounding_boxes,
            )

            # Generate SBP
            sbp_code = _generate_sbp_code(
                tp_result.toolpaths, filtered_ops, req.post_processor, req.sheet
            )

            zf.writestr(f"{sheet_id}.sbp", sbp_code)

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=pathdesigner_sheets.zip"},
    )


# --- AI CAD Endpoints ---


@app.get("/ai-cad/models", response_model=list[ModelInfo])
def get_ai_cad_models():
    """Return pipeline model configuration."""
    from llm_client import PIPELINE_MODELS, AVAILABLE_MODELS

    result = []
    for role, model_id in PIPELINE_MODELS.items():
        info = AVAILABLE_MODELS.get(model_id, {})
        result.append(
            {
                "id": model_id,
                "name": f"{role}: {info.get('name', model_id)}",
                "is_default": False,
                "supports_vision": info.get("supports_vision", False),
                "large_context": info.get("large_context", False),
            }
        )
    return result


@app.get("/ai-cad/profiles", response_model=list[ProfileInfo])
def get_ai_cad_profiles():
    """Return available prompt profiles."""
    return _get_llm().list_profiles_info()


@app.post("/ai-cad/generate")
async def ai_cad_generate(req: AiCadRequest):
    """Generate 3D model from text/image prompt via LLM pipeline (SSE stream)."""
    llm = _get_llm()

    async def event_stream():
        stage_queue: asyncio.Queue[str | None] = asyncio.Queue()

        async def queue_stage(stage: str):
            await stage_queue.put(stage)

        result_holder: dict = {}

        async def run_pipeline():
            try:
                code, objects, step_bytes = await llm.generate_pipeline(
                    req.prompt,
                    image_base64=req.image_base64,
                    profile=req.profile,
                    on_stage=queue_stage,
                )
                result_holder["code"] = code
                result_holder["objects"] = objects
                result_holder["step_bytes"] = step_bytes
            except Exception as e:
                result_holder["error"] = str(e)
            finally:
                await stage_queue.put(None)  # sentinel

        task = asyncio.create_task(run_pipeline())

        messages = {
            "designing": "設計中...",
            "coding": "コーディング中...",
            "reviewing": "レビュー中...",
            "executing": "実行中...",
            "retrying": "リトライ中...",
        }

        while True:
            stage = await stage_queue.get()
            if stage is None:
                break
            data = json.dumps({"stage": stage, "message": messages.get(stage, stage)})
            yield f"event: stage\ndata: {data}\n\n"

        await task

        if "error" in result_holder:
            data = json.dumps({"message": result_holder["error"]})
            yield f"event: error\ndata: {data}\n\n"
            return

        code = result_holder["code"]
        objects = result_holder["objects"]
        step_bytes = result_holder["step_bytes"]

        # Save STEP + generation (same logic as before)
        db = await _get_db()
        file_id = f"ai-cad-{uuid.uuid4().hex[:8]}"
        brep_result = BrepImportResult(
            file_id=file_id, objects=objects, object_count=len(objects),
        )

        step_path = None
        if step_bytes:
            gen_dir = GENERATIONS_DIR / file_id
            gen_dir.mkdir(exist_ok=True)
            step_file = gen_dir / "model.step"
            step_file.write_bytes(step_bytes)
            step_path = str(step_file)
            (UPLOAD_DIR / f"{file_id}.step").write_bytes(step_bytes)

        gen_id = await db.save_generation(
            prompt=req.prompt, code=code,
            result_json=brep_result.model_dump_json(),
            model_used="pipeline", status="success",
            step_path=step_path,
        )

        result = AiCadResult(
            file_id=file_id, objects=objects, object_count=len(objects),
            generated_code=code, generation_id=gen_id,
            prompt_used=req.prompt, model_used="pipeline",
        )
        data = result.model_dump_json()
        yield f"event: result\ndata: {data}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/ai-cad/execute", response_model=AiCadResult)
async def ai_cad_execute(req: AiCadCodeRequest):
    """Execute manually-edited build123d code."""
    db = await _get_db()

    try:
        objects, step_bytes = execute_build123d_code(req.code)
    except CodeExecutionError as e:
        raise HTTPException(status_code=422, detail=str(e))

    file_id = f"ai-cad-{uuid.uuid4().hex[:8]}"
    result = BrepImportResult(
        file_id=file_id, objects=objects, object_count=len(objects),
    )

    # Save STEP to uploads for downstream compatibility
    if step_bytes:
        (UPLOAD_DIR / f"{file_id}.step").write_bytes(step_bytes)
        gen_dir = GENERATIONS_DIR / file_id
        gen_dir.mkdir(exist_ok=True)
        (gen_dir / "model.step").write_bytes(step_bytes)

    gen_id = await db.save_generation(
        prompt="(manual code)", code=req.code,
        result_json=result.model_dump_json(),
        model_used="manual", status="success",
    )

    return AiCadResult(
        file_id=file_id, objects=objects, object_count=len(objects),
        generated_code=req.code, generation_id=gen_id,
        prompt_used="(manual code)", model_used="manual",
    )


@app.post("/ai-cad/refine")
async def ai_cad_refine(req: AiCadRefineRequest):
    """Refine AI-generated code via chat instruction (SSE stream)."""
    db = await _get_db()
    llm = _get_llm()

    gen_row = await db.get_generation(req.generation_id)

    async def event_stream():
        if not gen_row:
            data = json.dumps({"message": "Generation not found"})
            yield f"event: error\ndata: {data}\n\n"
            return

        try:
            yield f"event: stage\ndata: {json.dumps({'stage': 'refining', 'message': '修正中...'})}\n\n"

            llm_history = [
                {"role": m.role, "content": m.content}
                for m in req.history
            ]

            code = await llm.refine_code(
                current_code=req.current_code,
                message=req.message,
                history=llm_history,
                profile=req.profile,
            )

            yield f"event: stage\ndata: {json.dumps({'stage': 'reviewing', 'message': 'レビュー中...'})}\n\n"
            code = await llm._self_review(req.message, code, profile=req.profile)

            yield f"event: stage\ndata: {json.dumps({'stage': 'executing', 'message': '実行中...'})}\n\n"

            try:
                objects, step_bytes = execute_build123d_code(code)
            except CodeExecutionError as exec_err:
                yield f"event: stage\ndata: {json.dumps({'stage': 'retrying', 'message': 'リトライ中...'})}\n\n"

                retry_history = llm_history + [
                    {"role": "assistant", "content": code},
                    {"role": "user", "content": f"エラーが発生しました:\n{exec_err}\n\n修正してください。"},
                ]
                retry_msg = f"前回のエラー: {exec_err}\n修正してください。"
                code = await llm.refine_code(
                    current_code=code,
                    message=retry_msg,
                    history=retry_history,
                    profile=req.profile,
                )

                yield f"event: stage\ndata: {json.dumps({'stage': 'reviewing', 'message': 'レビュー中...'})}\n\n"
                code = await llm._self_review(retry_msg, code, profile=req.profile)

                yield f"event: stage\ndata: {json.dumps({'stage': 'executing', 'message': '実行中...'})}\n\n"
                objects, step_bytes = execute_build123d_code(code)

            file_id = f"ai-cad-{uuid.uuid4().hex[:8]}"
            brep_result = BrepImportResult(
                file_id=file_id, objects=objects, object_count=len(objects),
            )

            if step_bytes:
                gen_dir = GENERATIONS_DIR / file_id
                gen_dir.mkdir(exist_ok=True)
                (gen_dir / "model.step").write_bytes(step_bytes)
                (UPLOAD_DIR / f"{file_id}.step").write_bytes(step_bytes)

            new_history = [m.model_dump() for m in req.history] + [
                {"role": "user", "content": req.message},
                {"role": "assistant", "content": code},
            ]
            await db.update_generation(
                req.generation_id,
                code=code,
                result_json=brep_result.model_dump_json(),
                step_path=str(GENERATIONS_DIR / file_id / "model.step") if step_bytes else None,
                conversation_history=json.dumps(new_history),
            )

            result = AiCadRefineResult(
                code=code,
                objects=objects,
                object_count=len(objects),
                file_id=file_id,
                generation_id=req.generation_id,
                ai_message="修正を適用しました。",
            )
            yield f"event: result\ndata: {result.model_dump_json()}\n\n"

        except CodeExecutionError as e:
            yield f"event: error\ndata: {json.dumps({'message': f'コード実行エラー: {e}'})}\n\n"
        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'message': str(e)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/ai-cad/library", response_model=list[GenerationSummary])
async def ai_cad_library(search: str | None = None, limit: int = 50, offset: int = 0):
    """List past generations."""
    db = await _get_db()
    rows = await db.list_generations(search=search, limit=limit, offset=offset)
    return [
        GenerationSummary(
            generation_id=r["id"],
            prompt=r["prompt"],
            model_used=r["model_used"],
            status=r["status"],
            created_at=r["created_at"],
        )
        for r in rows
    ]


@app.get("/ai-cad/library/{gen_id}", response_model=AiCadResult)
async def ai_cad_load(gen_id: str):
    """Load a specific generation from library."""
    db = await _get_db()
    row = await db.get_generation(gen_id)
    if not row:
        raise HTTPException(status_code=404, detail="Generation not found")

    if row["status"] != "success" or not row["result_json"]:
        raise HTTPException(status_code=422, detail="Generation was not successful")

    result_data = json.loads(row["result_json"])

    return AiCadResult(
        file_id=result_data["file_id"],
        objects=result_data["objects"],
        object_count=result_data["object_count"],
        generated_code=row["code"],
        generation_id=row["id"],
        prompt_used=row["prompt"],
        model_used=row["model_used"],
    )


@app.delete("/ai-cad/library/{gen_id}")
async def ai_cad_delete(gen_id: str):
    """Delete a generation."""
    db = await _get_db()
    await db.delete_generation(gen_id)
    return {"deleted": gen_id}


# ── Snippet DB endpoints ──────────────────────────────────────────────────────

@app.post("/snippets", response_model=SnippetInfo)
async def save_snippet(req: SnippetSaveRequest):
    """Save a snippet to the library."""
    db = await _get_snippets_db()
    snippet_id = await db.save_snippet(
        name=req.name,
        code=req.code,
        tags=req.tags,
        thumbnail_png=req.thumbnail_png,
        source_generation_id=req.source_generation_id,
    )
    row = await db.get_snippet(snippet_id)
    return SnippetInfo(
        id=row["id"],
        name=row["name"],
        tags=json.loads(row["tags"] or "[]"),
        code=row["code"],
        thumbnail_png=row["thumbnail_png"],
        source_generation_id=row["source_generation_id"],
        created_at=row["created_at"],
    )


@app.get("/snippets", response_model=SnippetListResponse)
async def list_snippets(q: str = "", limit: int = 50, offset: int = 0):
    """List snippets with optional name search."""
    db = await _get_snippets_db()
    rows, total = await db.list_snippets(q=q, limit=limit, offset=offset)
    snippets = [
        SnippetInfo(
            id=r["id"],
            name=r["name"],
            tags=json.loads(r["tags"] or "[]"),
            code=r["code"],
            thumbnail_png=r["thumbnail_png"],
            source_generation_id=r["source_generation_id"],
            created_at=r["created_at"],
        )
        for r in rows
    ]
    return SnippetListResponse(snippets=snippets, total=total)


@app.delete("/snippets/{snippet_id}")
async def delete_snippet(snippet_id: str):
    """Delete a snippet by ID."""
    db = await _get_snippets_db()
    deleted = await db.delete_snippet(snippet_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Snippet not found")
    return {"ok": True}


@app.post("/snippets/{snippet_id}/execute", response_model=AiCadResult)
async def execute_snippet(snippet_id: str):
    """Execute a snippet's code and return AI-Node-compatible output."""
    snippets_db = await _get_snippets_db()
    row = await snippets_db.get_snippet(snippet_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Snippet not found")

    try:
        objects, step_bytes = execute_build123d_code(row["code"])
    except CodeExecutionError as e:
        raise HTTPException(status_code=422, detail=str(e))

    file_id = f"snippet-{uuid.uuid4().hex[:8]}"
    if step_bytes:
        (UPLOAD_DIR / f"{file_id}.step").write_bytes(step_bytes)
        gen_dir = GENERATIONS_DIR / file_id
        gen_dir.mkdir(exist_ok=True)
        (gen_dir / "model.step").write_bytes(step_bytes)

    result = BrepImportResult(file_id=file_id, objects=objects, object_count=len(objects))
    gen_db = await _get_db()
    gen_id = await gen_db.save_generation(
        prompt=f"(snippet: {row['name']})",
        code=row["code"],
        result_json=result.model_dump_json(),
        model_used="snippet",
        status="success",
    )

    return AiCadResult(
        file_id=file_id,
        objects=objects,
        object_count=len(objects),
        generated_code=row["code"],
        generation_id=gen_id,
        prompt_used=f"(snippet: {row['name']})",
        model_used="snippet",
    )
