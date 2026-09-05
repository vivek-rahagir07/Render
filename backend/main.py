import shutil
import sys
from contextlib import asynccontextmanager
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"
STORAGE_DIR = BASE_DIR / "storage"

if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

try:
    from backend.reconstruction_service import JobConfig, ReconstructionService
except ImportError:
    from reconstruction_service import JobConfig, ReconstructionService

service = ReconstructionService(base_storage_dir=str(STORAGE_DIR / "jobs"))

@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    worker_task = asyncio.create_task(service.start_worker())
    yield
    worker_task.cancel()
    try:
        await worker_task
    except asyncio.CancelledError:
        pass

app = FastAPI(
    title="AEROVOX — 3D Reconstruction API",
    description="AEROVOX: Local-first 3D neural reconstruction using MUSt3R and PyTorch MPS",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
async def health_check():
    """Health check endpoint providing MUSt3R environment and hardware status."""
    env_info = service.check_environment()
    return {
        "status": "healthy" if env_info["is_ready"] else "degraded",
        "environment": env_info
    }

@app.post("/api/reconstruction/jobs")
async def create_reconstruction_job(
    files: list[UploadFile] = File(...),  # noqa: B008
    image_size: int = Form(512),
    device: str = Form("mps"),
    max_bs: int = Form(1),
    num_refinements_iterations: int = Form(8),
    execution_mode: str = Form("retrieval"),
    cam_size: float = Form(0.05),
    remove_background: bool = Form(True),
    min_conf_thr: float = Form(1.8)
):
    """
    Creates a new reconstruction job, saves validated uploaded images, and queues it.
    """
    if not files or len(files) == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No image files uploaded.")

    if len(files) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"3D reconstruction requires at least 2 images (received {len(files)}). 20-40 images recommended."
        )

    cfg = JobConfig(
        image_size=image_size,
        device=device,
        max_bs=max_bs,
        num_refinements_iterations=num_refinements_iterations,
        execution_mode=execution_mode,
        cam_size=cam_size,
        remove_background=remove_background,
        min_conf_thr=min_conf_thr
    )

    job = service.create_job(config=cfg)
    saved_count = 0

    for file in files:
        if not file.filename:
            continue
        try:
            content = await file.read()
            if len(content) == 0:
                continue
            service.validate_and_save_image(job.job_id, file.filename, content)
            saved_count += 1
        except Exception as e:
            job_dir = service.storage_dir / job.job_id
            shutil.rmtree(job_dir, ignore_errors=True)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to process file '{file.filename}': {e}"
            ) from e

    if saved_count < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Less than 2 valid images could be saved for reconstruction."
        )

    await service.submit_job(job.job_id)

    return {
        "job_id": job.job_id,
        "status": job.status.value,
        "image_count": saved_count,
        "message": f"Job queued successfully with {saved_count} images."
    }

@app.get("/api/reconstruction/jobs/{job_id}")
async def get_job_status(job_id: str):
    """Retrieves current job status, progress percentage, stage, output models, and live logs."""
    job = service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Job {job_id} not found.")

    return {
        "job_id": job.job_id,
        "status": job.status.value,
        "progress": job.progress,
        "stage": job.stage,
        "message": job.message,
        "image_count": job.image_count,
        "created_at": job.created_at,
        "started_at": job.started_at,
        "completed_at": job.completed_at,
        "output_files": job.output_files,
        "error": job.error,
        "logs": job.logs[-50:]
    }

@app.post("/api/reconstruction/jobs/{job_id}/cancel")
async def cancel_job(job_id: str):
    """Cancels a queued or active reconstruction job."""
    success = service.cancel_job(job_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Job {job_id} could not be cancelled or is already completed/failed."
        )
    return {"job_id": job_id, "status": "cancelled", "message": "Job cancelled successfully."}

@app.get("/api/reconstruction/jobs/{job_id}/download/{format}")
async def download_model(job_id: str, format: str):
    """Downloads the generated 3D model in GLB, PLY, STL (3D Print), or OBJ (CAD) format."""
    format_lower = format.lower()
    allowed = ["glb", "ply", "stl", "obj", "mesh_glb"]
    if format_lower not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Format must be one of: {', '.join(allowed)}."
        )

    out_dir = service.storage_dir / job_id / "outputs"

    if format_lower in ["stl", "obj", "mesh_glb"]:
        target_name = f"scene_mesh.{ 'glb' if format_lower == 'mesh_glb' else format_lower }"
        file_path = out_dir / target_name
        if not file_path.is_file():
            service.generate_mesh_exports(job_id)
    else:
        file_path = out_dir / f"scene.{format_lower}"

    if not file_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Model in '{format_lower}' format not found for job {job_id}."
        )

    media_types = {
        "glb": "model/gltf-binary",
        "mesh_glb": "model/gltf-binary",
        "stl": "model/stl",
        "obj": "model/obj",
        "ply": "application/octet-stream"
    }
    ext = "glb" if format_lower == "mesh_glb" else format_lower
    media_type = media_types.get(format_lower, "application/octet-stream")
    download_filename = f"reconstruction_{job_id[:8]}_{'mesh' if format_lower in ['stl', 'obj', 'mesh_glb'] else 'scene'}.{ext}"

    return FileResponse(
        path=file_path,
        media_type=media_type,
        filename=download_filename
    )

if STORAGE_DIR.exists():
    app.mount("/storage", StaticFiles(directory=str(STORAGE_DIR)), name="storage")

if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
