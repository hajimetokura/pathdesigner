import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from nodes.brep_import import analyze_step_file
from schemas import BrepImportResult

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
        result = analyze_step_file(saved_path, file_name=file.filename)
    except ValueError as e:
        saved_path.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        saved_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"STEP analysis failed: {e}")

    return BrepImportResult(
        file_id=file_id,
        objects=result.objects,
        object_count=result.object_count,
    )
