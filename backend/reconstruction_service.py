import asyncio
import json
import logging
import os
import sys
import re
import shutil
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional
from PIL import Image

logger = logging.getLogger("reconstruction_service")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

class JobStatus(str, Enum):
    QUEUED = "queued"
    PREPROCESSING = "preprocessing"
    RECONSTRUCTING = "reconstructing"
    EXPORTING = "exporting"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

@dataclass
class JobConfig:
    image_size: int = 512
    device: str = "mps"
    max_bs: int = 1
    num_refinements_iterations: int = 8
    execution_mode: str = "retrieval"
    cam_size: float = 0.05
    render_once: bool = False
    num_mem_imgs: int = 50
    remove_background: bool = True

@dataclass
class JobInfo:
    job_id: str
    status: JobStatus = JobStatus.QUEUED
    progress: int = 0
    stage: str = "Queued"
    message: str = "Job is queued for processing."
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    image_count: int = 0
    config: Dict[str, Any] = field(default_factory=dict)
    logs: List[str] = field(default_factory=list)
    output_files: Dict[str, str] = field(default_factory=dict)
    error: Optional[str] = None

class BasePreprocessingHook:
    """
    Interface for modular pre-processing hooks.
    Can be subclassed in the future to plug in YOLO / SAM 2 dynamic object removal
    before images are passed to MUSt3R.
    """
    def process_images(self, image_dir: Path, job_info: JobInfo) -> Path:
        """
        Processes images in `image_dir` and returns the path to cleaned/preprocessed images.
        Default implementation is a no-op passthrough.
        """
        return image_dir

class ReconstructionService:
    def __init__(self, base_storage_dir: Optional[str] = None):
        self.base_dir = Path(__file__).resolve().parent.parent
        self.storage_dir = Path(base_storage_dir or os.getenv("STORAGE_DIR", self.base_dir / "storage" / "jobs"))
        self.storage_dir.mkdir(parents=True, exist_ok=True)

        candidate_roots = []
        if os.getenv("MUST3R_ROOT"):
            candidate_roots.append(Path(os.path.expanduser(os.getenv("MUST3R_ROOT"))))
        candidate_roots.extend([
            self.base_dir / "must3r",
            Path.home() / "must3r",
            Path.home() / "Documents" / "must3r",
            Path.home() / "Downloads" / "must3r",
            Path("/opt/must3r")
        ])

        self.must3r_root = candidate_roots[0]
        for candidate in candidate_roots:
            if (candidate / "get_reconstruction.py").is_file():
                self.must3r_root = candidate.resolve()
                break
            elif candidate.is_dir():
                self.must3r_root = candidate.resolve()

        candidate_pythons = [
            self.must3r_root / ".venv" / "bin" / "python",
            self.base_dir / ".venv" / "bin" / "python",
            self.must3r_root / "venv" / "bin" / "python",
            Path(sys.executable),
        ]
        if os.getenv("MUST3R_PYTHON") and Path(os.path.expanduser(os.getenv("MUST3R_PYTHON"))).is_file():
            candidate_pythons.insert(0, Path(os.path.expanduser(os.getenv("MUST3R_PYTHON"))))

        self.python_bin = Path(sys.executable)
        for py in candidate_pythons:
            if py.is_file() and os.access(py, os.X_OK):
                self.python_bin = py
                break

        bundled_script = self.base_dir / "backend" / "engine" / "get_reconstruction.py"
        if bundled_script.is_file():
            self.script_path = bundled_script.resolve()
        else:
            self.script_path = self.must3r_root / "get_reconstruction.py"
        
        models_dir = self.must3r_root / "models"
        self.weights_512 = Path(os.path.expanduser(os.getenv("MUST3R_WEIGHTS", str(models_dir / "MUSt3R_512.pth")))).resolve()
        self.retrieval_512 = Path(os.path.expanduser(os.getenv("MUST3R_RETRIEVAL", str(models_dir / "MUSt3R_512_retrieval_trainingfree.pth")))).resolve()
        self.weights_224 = models_dir / "MUSt3R_224_cvpr.pth"
        self.retrieval_224 = models_dir / "MUSt3R_224_retrieval_trainingfree.pth"

        self.jobs: Dict[str, JobInfo] = {}
        self.active_processes: Dict[str, subprocess.Popen] = {}
        self._lock = threading.Lock()
        self._queue: Optional[asyncio.Queue] = None   # lazily created inside the running loop
        self._worker_task: Optional[asyncio.Task] = None

        self.preprocessing_hooks: List[BasePreprocessingHook] = []
        self._load_existing_jobs()

    def _load_existing_jobs(self):
        """Scans storage_dir to restore all past jobs so they remain visible across server restarts."""
        try:
            if not self.storage_dir.is_dir():
                return
            for jdir in self.storage_dir.iterdir():
                if not jdir.is_dir():
                    continue
                job_id = jdir.name
                job_file = jdir / "job.json"
                if job_file.is_file():
                    try:
                        with open(job_file, "r") as f:
                            d = json.load(f)
                        st = d.get("status", "completed")
                        if st in ["queued", "preprocessing", "reconstructing", "exporting"]:
                            st = "failed"
                            d["status"] = "failed"
                            d["stage"] = "Interrupted"
                            d["error"] = "Server was restarted before or during reconstruction."
                            d["completed_at"] = datetime.utcnow().isoformat()
                        job = JobInfo(
                            job_id=job_id,
                            status=JobStatus(st),
                            progress=d.get("progress", 100) if st == "completed" else d.get("progress", 0),
                            stage=d.get("stage", "Completed"),
                            message=d.get("message", ""),
                            created_at=d.get("created_at", ""),
                            started_at=d.get("started_at"),
                            completed_at=d.get("completed_at"),
                            image_count=d.get("image_count", 0),
                            config=d.get("config", {}),
                            logs=d.get("logs", []),
                            output_files=d.get("output_files", {}),
                            error=d.get("error")
                        )
                        self.jobs[job_id] = job
                        if st == "failed":
                            self._save_job_to_disk(job)
                    except Exception:
                        pass
                else:
                    main_glb = jdir / "outputs" / "scene.glb"
                    if main_glb.is_file() and main_glb.stat().st_size > 1000:
                        out_files = {"glb": f"/storage/jobs/{job_id}/outputs/scene.glb"}
                        if (jdir / "outputs" / "scene.ply").is_file():
                            out_files["ply"] = f"/storage/jobs/{job_id}/outputs/scene.ply"
                        if (jdir / "outputs" / "scene_mesh.stl").is_file():
                            out_files["stl"] = f"/storage/jobs/{job_id}/outputs/scene_mesh.stl"
                        if (jdir / "outputs" / "scene_mesh.obj").is_file():
                            out_files["obj"] = f"/storage/jobs/{job_id}/outputs/scene_mesh.obj"
                        if (jdir / "outputs" / "scene_mesh.glb").is_file():
                            out_files["mesh_glb"] = f"/storage/jobs/{job_id}/outputs/scene_mesh.glb"
                        img_count = len(list((jdir / "images").glob("*"))) if (jdir / "images").is_dir() else 0
                        job = JobInfo(
                            job_id=job_id,
                            status=JobStatus.COMPLETED,
                            progress=100,
                            stage="Completed",
                            message="High-precision 3D scene reconstructed.",
                            image_count=img_count,
                            output_files=out_files
                        )
                        self.jobs[job_id] = job
        except Exception as e:
            logger.warning(f"Error loading existing jobs: {e}")

    def _save_job_to_disk(self, job: JobInfo):
        try:
            job_file = self.storage_dir / job.job_id / "job.json"
            data = {
                "job_id": job.job_id,
                "status": job.status.value,
                "progress": job.progress,
                "stage": job.stage,
                "message": job.message,
                "created_at": job.created_at,
                "started_at": job.started_at,
                "completed_at": job.completed_at,
                "image_count": job.image_count,
                "config": job.config,
                "logs": job.logs[-250:],
                "output_files": job.output_files,
                "error": job.error
            }
            with open(job_file, "w") as f:
                json.dump(data, f, indent=2)
        except Exception:
            pass

    def register_preprocessing_hook(self, hook: BasePreprocessingHook):
        self.preprocessing_hooks.append(hook)

    def check_environment(self) -> Dict[str, Any]:
        """Validates the MUSt3R installation, virtualenv, and model weights."""
        has_must3r_dir = self.must3r_root.is_dir()
        has_python = self.python_bin.is_file() and os.access(self.python_bin, os.X_OK)
        has_script = self.script_path.is_file()
        has_weights_512 = self.weights_512.is_file()
        has_retrieval_512 = self.retrieval_512.is_file()

        mps_available = False
        cuda_available = False
        device_name = "CPU"

        if has_python:
            try:
                probe_cmd = [
                    str(self.python_bin),
                    "-c",
                    "import torch; print(f'MPS:{torch.backends.mps.is_available()};CUDA:{torch.cuda.is_available()}')"
                ]
                res = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=10)
                if res.returncode == 0:
                    out = res.stdout.strip()
                    mps_available = "MPS:True" in out
                    cuda_available = "CUDA:True" in out
                    if mps_available:
                        device_name = "Apple Silicon MPS"
                    elif cuda_available:
                        device_name = "NVIDIA CUDA"
            except Exception as e:
                logger.warning(f"Error checking PyTorch device: {e}")

        is_ready = has_must3r_dir and has_python and has_script and has_weights_512 and has_retrieval_512

        return {
            "is_ready": is_ready,
            "must3r_root": str(self.must3r_root),
            "python_bin": str(self.python_bin),
            "script_found": has_script,
            "weights_512_found": has_weights_512,
            "retrieval_512_found": has_retrieval_512,
            "mps_available": mps_available,
            "cuda_available": cuda_available,
            "device": device_name,
            "storage_dir": str(self.storage_dir)
        }

    def create_job(self, config: Optional[JobConfig] = None) -> JobInfo:
        """Initializes a new job entry and storage directory."""
        job_id = str(uuid.uuid4())
        job_dir = self.storage_dir / job_id
        (job_dir / "images").mkdir(parents=True, exist_ok=True)
        (job_dir / "outputs").mkdir(parents=True, exist_ok=True)

        cfg = config or JobConfig()
        cfg_dict = {
            "image_size": cfg.image_size,
            "device": cfg.device,
            "max_bs": cfg.max_bs,
            "num_refinements_iterations": cfg.num_refinements_iterations,
            "execution_mode": cfg.execution_mode,
            "cam_size": cfg.cam_size,
            "render_once": cfg.render_once,
            "num_mem_imgs": cfg.num_mem_imgs
        }

        job = JobInfo(
            job_id=job_id,
            status=JobStatus.QUEUED,
            progress=5,
            stage="Queued",
            message="Mission initialized, preparing neural regressors...",
            config=cfg_dict
        )

        with self._lock:
            self.jobs[job_id] = job
        self._save_job_to_disk(job)

        return job

    def validate_and_save_image(self, job_id: str, filename: str, content: bytes) -> str:
        """Sanitizes filename and validates image file format against path traversal."""
        job_dir = self.storage_dir / job_id / "images"
        if not job_dir.is_dir():
            raise ValueError(f"Job {job_id} not found or invalid directory.")

        clean_name = Path(filename).name
        clean_name = re.sub(r"[^\w\-.]", "_", clean_name)
        if not clean_name:
            clean_name = f"image_{uuid.uuid4().hex[:8]}.jpg"

        ext = Path(clean_name).suffix.lower()
        if ext not in [".jpg", ".jpeg", ".png", ".webp"]:
            raise ValueError(f"Unsupported image extension: {ext}. Allowed: .jpg, .jpeg, .png, .webp")

        target_path = job_dir / clean_name

        try:
            import io
            from PIL import ImageOps
            with Image.open(io.BytesIO(content)) as img:
                img = ImageOps.exif_transpose(img)
                img = img.convert("RGB")
                
                max_edge = 1600
                if max(img.size) > max_edge:
                    img.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
                
                img.save(target_path, "JPEG", quality=95, optimize=True)
        except Exception as e:
            target_path.unlink(missing_ok=True)
            raise ValueError(f"Uploaded file {clean_name} is corrupted or invalid: {e}")

        with self._lock:
            if job_id in self.jobs:
                img_files = list(job_dir.glob("*"))
                self.jobs[job_id].image_count = len(img_files)
                self._save_job_to_disk(self.jobs[job_id])

        return clean_name

    def get_job(self, job_id: str) -> Optional[JobInfo]:
        with self._lock:
            if job_id in self.jobs:
                return self.jobs[job_id]
        job_file = self.storage_dir / job_id / "job.json"
        if job_file.is_file():
            try:
                with open(job_file, "r") as f:
                    d = json.load(f)
                job = JobInfo(
                    job_id=job_id,
                    status=JobStatus(d.get("status", "queued")),
                    progress=d.get("progress", 0),
                    stage=d.get("stage", "Queued"),
                    message=d.get("message", ""),
                    created_at=d.get("created_at", ""),
                    started_at=d.get("started_at"),
                    completed_at=d.get("completed_at"),
                    image_count=d.get("image_count", 0),
                    config=d.get("config", {}),
                    logs=d.get("logs", []),
                    output_files=d.get("output_files", {}),
                    error=d.get("error")
                )
                with self._lock:
                    self.jobs[job_id] = job
                return job
            except Exception:
                pass
        return None

    def cancel_job(self, job_id: str) -> bool:
        with self._lock:
            job = self.jobs.get(job_id)
            if not job:
                return False

            if job.status in [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED]:
                return False

            job.status = JobStatus.CANCELLED
            job.stage = "Cancelled"
            job.message = "Job was cancelled by user."
            job.completed_at = datetime.utcnow().isoformat()
            self._save_job_to_disk(job)

            proc = self.active_processes.get(job_id)
            if proc and proc.poll() is None:
                try:
                    proc.terminate()
                    time.sleep(0.5)
                    if proc.poll() is None:
                        proc.kill()
                except Exception as e:
                    logger.warning(f"Error terminating process for job {job_id}: {e}")

            return True

    def _append_log(self, job_id: str, line: str):
        with self._lock:
            job = self.jobs.get(job_id)
            if job:
                timestamp = datetime.now().strftime("%H:%M:%S")
                formatted = f"[{timestamp}] {line.strip()}"
                job.logs.append(formatted)
                if len(job.logs) > 500:
                    job.logs = job.logs[-500:]
                self._save_job_to_disk(job)

    def _update_progress(self, job_id: str, progress: int, stage: Optional[str] = None, message: Optional[str] = None):
        with self._lock:
            job = self.jobs.get(job_id)
            if job:
                job.progress = max(0, min(100, progress))
                if stage:
                    job.stage = stage
                if message:
                    job.message = message
                self._save_job_to_disk(job)

    def _apply_ai_background_removal(self, job_id: str, img_dir: Path) -> Path:
        """Isolates foreground subjects and removes complex background clutter for maximum 3D precision."""
        image_paths = [f for f in img_dir.iterdir() if f.is_file() and f.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")]
        if not image_paths:
            return img_dir

        masked_dir = img_dir.parent / "masked_images"
        masked_dir.mkdir(parents=True, exist_ok=True)

        try:
            import rembg
            from concurrent.futures import ThreadPoolExecutor, as_completed

            self._append_log(job_id, f"[AI Matting] Processing {len(image_paths)} images for foreground subject isolation...")
            self._update_progress(job_id, 8, "AI Matting", f"Isolating subjects across {len(image_paths)} images...")

            session = None
            try:
                session = rembg.new_session('u2netp')
            except Exception:
                try:
                    session = rembg.new_session('u2net')
                except Exception:
                    session = None

            total_imgs = len(image_paths)
            completed_count = 0
            matting_lock = threading.Lock()

            def process_single(p: Path):
                nonlocal completed_count
                out_p = masked_dir / f"{p.stem}.png"
                try:
                    with Image.open(p) as img:
                        img_rgb = img.convert("RGB")
                        if session:
                            res = rembg.remove(img_rgb, session=session)
                        else:
                            res = rembg.remove(img_rgb)
                        res.save(out_p, "PNG")
                except Exception:
                    shutil.copy2(p, masked_dir / f"{p.stem}{p.suffix}")
                finally:
                    with matting_lock:
                        completed_count += 1
                        cur = completed_count
                    pct = 6 + int((cur / max(1, total_imgs)) * 9)
                    self._update_progress(job_id, pct, "AI Matting", f"Isolating foreground subjects ({cur}/{total_imgs} frames)...")

            with ThreadPoolExecutor(max_workers=min(4, os.cpu_count() or 2)) as executor:
                futures = [executor.submit(process_single, p) for p in image_paths]
                for f in as_completed(futures, timeout=60):
                    pass

            valid_masked = [f for f in masked_dir.iterdir() if f.is_file() and f.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp") and f.stat().st_size > 1000]
            if len(valid_masked) >= 2:
                self._append_log(job_id, f"[AI Matting] Successfully isolated subjects ({len(valid_masked)} frames ready for 3D reconstruction).")
                self._update_progress(job_id, 15, "AI Matting", f"Foreground isolation complete ({len(valid_masked)} frames ready).")
                return masked_dir
            else:
                self._append_log(job_id, "[AI Matting Notice] Using original high-res frames for 3D reconstruction.")
                return img_dir
        except Exception as e:
            self._append_log(job_id, f"[AI Matting Notice] Continuing with original image frames: {e}")
            return img_dir

    def _run_reconstruction_sync(self, job_id: str):
        """Executes the reconstruction job synchronously inside worker thread."""
        job = self.get_job(job_id)
        if not job:
            return

        job_dir = self.storage_dir / job_id
        img_dir = job_dir / "images"
        out_dir = job_dir / "outputs"

        with self._lock:
            job.status = JobStatus.PREPROCESSING
            job.started_at = datetime.utcnow().isoformat()
            job.stage = "Preprocessing"
            job.message = "Checking and preparing images..."
            job.progress = 5

        self._append_log(job_id, f"Starting reconstruction job {job_id}")

        processed_img_dir = img_dir
        for hook in self.preprocessing_hooks:
            try:
                processed_img_dir = hook.process_images(processed_img_dir, job)
            except Exception as e:
                self._append_log(job_id, f"Preprocessing hook warning: {e}")

        if job.config.get("remove_background", True):
            processed_img_dir = self._apply_ai_background_removal(job_id, processed_img_dir)

        valid_extensions = (".jpg", ".jpeg", ".png", ".webp")
        images = [f for f in processed_img_dir.iterdir() if f.is_file() and f.suffix.lower() in valid_extensions]
        if not images:
            with self._lock:
                job.status = JobStatus.FAILED
                job.stage = "Failed"
                job.error = "No valid images found in job directory."
                job.completed_at = datetime.utcnow().isoformat()
            self._append_log(job_id, "ERROR: No valid images found.")
            return

        cfg = job.config
        img_size = int(cfg.get("image_size", 512))
        device = str(cfg.get("device", "mps"))
        default_bs = 2 if device in ["mps", "cuda"] and len(images) > 3 else 1
        max_bs = int(cfg.get("max_bs", default_bs))
        num_refinements = int(cfg.get("num_refinements_iterations", 6))
        exec_mode = str(cfg.get("execution_mode", "retrieval"))
        cam_size = float(cfg.get("cam_size", 0.05))
        num_mem_imgs = min(int(cfg.get("num_mem_imgs", 24)), len(images))

        if not self.must3r_root.is_dir() or not self.script_path.is_file():
            err_msg = (
                f"MUSt3R engine not found at: {self.must3r_root}\n"
                f"To setup on this laptop, run: ./run.sh\n"
                f"Or clone manually: git clone --recursive https://github.com/naver/must3r.git ~/must3r"
            )
            with self._lock:
                job.status = JobStatus.FAILED
                job.stage = "Failed"
                job.error = f"MUSt3R directory not found at {self.must3r_root}. Please run ./run.sh to auto-configure."
                job.completed_at = datetime.utcnow().isoformat()
            self._append_log(job_id, f"[ERROR] {err_msg}")
            return

        if img_size == 224 and self.weights_224.is_file():
            weights_path = str(self.weights_224)
            retrieval_path = str(self.retrieval_224)
        else:
            weights_path = str(self.weights_512)
            retrieval_path = str(self.retrieval_512)

        if not Path(weights_path).is_file():
            self._append_log(job_id, f"[Notice] Model weights {weights_path} not found. Attempting reconstruction...")

        if exec_mode == "retrieval":
            codebook_512 = self.must3r_root / "models" / "MUSt3R_512_retrieval_codebook.pkl"
            codebook_224 = self.must3r_root / "models" / "MUSt3R_224_retrieval_codebook.pkl"
            active_codebook = codebook_224 if img_size == 224 else codebook_512
            if not active_codebook.is_file() or active_codebook.stat().st_size < 50 * 1024 * 1024:
                self._append_log(job_id, f"Notice: Codebook {active_codebook.name} is incomplete or pending download. Running sequence mode.")
                exec_mode = "linseq"

        cmd = [
            str(self.python_bin),
            str(self.script_path),
            "--image_dir", str(processed_img_dir),
            "--output", str(out_dir),
            "--weights", weights_path,
            "--image_size", str(img_size),
            "--device", device,
            "--max_bs", str(max_bs),
            "--num_refinements_iterations", str(num_refinements),
            "--execution_mode", exec_mode,
            "--cam_size", str(cam_size),
            "--num_mem_imgs", str(num_mem_imgs),
            "--min_conf_thr", "3.0",
            "--flying_edges_thr", "0.06",
            "--file_type", "glb"
        ]

        if exec_mode == "retrieval":
            cmd.extend(["--retrieval", retrieval_path])

        self._append_log(job_id, f"Executing: {' '.join([str(c) for c in cmd])}")
        self._update_progress(job_id, 10, "Reconstructing", f"Running MUSt3R ({exec_mode} mode, {len(images)} images)...")

        with self._lock:
            job.status = JobStatus.RECONSTRUCTING

        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        env["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"
        env["OMP_NUM_THREADS"] = "1"
        env["MKL_NUM_THREADS"] = "1"
        env["PYTORCH_MPS_HIGH_WATERMARK_RATIO"] = "0.0"
        current_pythonpath = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = f"{self.must3r_root}:{self.must3r_root / 'dust3r'}:{current_pythonpath}"

        try:
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                cwd=str(self.must3r_root),
                env=env
            )

            with self._lock:
                self.active_processes[job_id] = process

            inference_pass = 1
            last_tqdm_pct = -1

            for line in iter(process.stdout.readline, ''):
                if not line:
                    break
                line_str = line.strip()
                if not line_str:
                    continue

                self._append_log(job_id, line_str)

                # Check for TQDM progress bar lines, e.g. " 41%|████ | 11/27 [00:26<00:27, 1.74s/it...]"
                tqdm_match = re.search(r"(\d+)%\|.*?\|\s*(\d+)/(\d+)", line_str)
                if tqdm_match:
                    pct = int(tqdm_match.group(1))
                    cur = int(tqdm_match.group(2))
                    tot = int(tqdm_match.group(3))

                    # If the percentage dropped from high (>70) to low (<10), we entered Pass 2 (Optimization/Refinement)
                    if last_tqdm_pct > 70 and pct < 15:
                        inference_pass = 2
                    last_tqdm_pct = pct

                    if inference_pass == 1:
                        calc_progress = 22 + int((pct / 100.0) * 36)
                        self._update_progress(
                            job_id,
                            calc_progress,
                            "Neural Ingestion",
                            f"Regressing viewpoints & camera poses ({cur}/{tot} frames, {pct}%)..."
                        )
                    else:
                        calc_progress = 58 + int((pct / 100.0) * 26)
                        self._update_progress(
                            job_id,
                            calc_progress,
                            "3D Optimization",
                            f"Refining 3D geometry & global alignment ({cur}/{tot}, {pct}%)..."
                        )
                    continue

                lower = line_str.lower()
                if "loading model" in lower:
                    self._update_progress(job_id, 18, "Loading Weights", "Loading MUSt3R neural network weights onto Apple MPS...")
                elif "running inference" in lower or "updating memory" in lower:
                    self._update_progress(job_id, 24, "Neural Ingestion", "Running multi-view neural regressors...")
                elif "retrieval" in lower or "matching" in lower or "finding pairs" in lower:
                    self._update_progress(job_id, 35, "Matching", "Extracting deep features & matching viewpoint pairs...")
                elif "clean exporter" in lower or "pristine primary model" in lower or "sor" in lower:
                    self._update_progress(job_id, 86, "Denoising", "Filtering flying edges & statistical outlier points...")
                elif "exporting clean 3d scene" in lower or "scene.glb" in lower or "scene.ply" in lower:
                    self._update_progress(job_id, 90, "Exporting", "Writing high-precision GLB & PLY 3D models...")
                elif "surface meshing" in lower or "poisson" in lower or "watertight" in lower:
                    self._update_progress(job_id, 95, "Poisson Meshing", "Generating watertight solid 3D mesh surface...")

            process.stdout.close()
            try:
                return_code = process.wait(timeout=45)
            except subprocess.TimeoutExpired:
                logger.warning(f"Process for job {job_id} did not exit within timeout. Terminating...")
                process.terminate()
                try:
                    return_code = process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    return_code = 0

            with self._lock:
                self.active_processes.pop(job_id, None)

            primary_glb = out_dir / "scene.glb"
            has_valid_glb = primary_glb.is_file() and primary_glb.stat().st_size > 10000

            if return_code != 0 and not has_valid_glb:
                if job.status == JobStatus.CANCELLED:
                    self._append_log(job_id, "Job execution cancelled.")
                    return
                raise RuntimeError(f"MUSt3R process exited with code {return_code}")

            self._update_progress(job_id, 90, "Exporting", "Finalizing high-precision GLB & PLY models...")
            with self._lock:
                job.status = JobStatus.EXPORTING
            self._save_job_to_disk(job)

            self._postprocess_models(job_id, out_dir)

            with self._lock:
                job.status = JobStatus.COMPLETED
                job.progress = 100
                job.stage = "Completed"
                job.message = "High-precision 3D reconstruction finished successfully!"
                job.completed_at = datetime.utcnow().isoformat()

            self._save_job_to_disk(job)
            self._append_log(job_id, "Job finished successfully! High-precision models ready.")

        except Exception as e:
            logger.error(f"Error during reconstruction for job {job_id}: {e}", exc_info=True)
            with self._lock:
                job.status = JobStatus.FAILED
                job.stage = "Failed"
                job.error = str(e)
                job.completed_at = datetime.utcnow().isoformat()
                job.message = f"Reconstruction failed: {e}"
            self._save_job_to_disk(job)
            self._append_log(job_id, f"FATAL ERROR: {e}")

    def _postprocess_models(self, job_id: str, out_dir: Path):
        """
        Locates the optimal generated GLB (clean high-precision confidence threshold) and produces a standard scene.glb and scene.ply.
        """
        main_glb = out_dir / "scene.glb"
        main_ply = out_dir / "scene.ply"

        preferred_candidates = [
            out_dir / "scene_clean.glb",
            out_dir / "scene_3.0.glb",
            out_dir / "scene_ultra.glb",
            out_dir / "scene_balanced.glb",
            out_dir / "scene_2.5.glb",
            out_dir / "scene.glb"
        ]

        selected_glb = None
        for candidate in preferred_candidates:
            if candidate.is_file() and candidate.stat().st_size > 30000:
                selected_glb = candidate
                break

        if not selected_glb:
            glb_files = sorted(list(out_dir.glob("*.glb")), key=lambda p: p.stat().st_size, reverse=True)
            if glb_files:
                selected_glb = glb_files[0]

        if selected_glb and selected_glb != main_glb:
            shutil.copyfile(selected_glb, main_glb)
            self._append_log(job_id, f"Primary GLB selected from {selected_glb.name} (filtered clean geometry)")

        if not main_ply.is_file() and main_glb.is_file():
            self._append_log(job_id, "Generating PLY point cloud / mesh export...")
            try:
                import trimesh
                mesh_scene = trimesh.load(str(main_glb))
                mesh_scene.export(str(main_ply))
                self._append_log(job_id, "PLY model generated successfully.")
            except Exception as e:
                self._append_log(job_id, f"PLY export notice: {e}")

        main_stl = out_dir / "scene_mesh.stl"
        main_obj = out_dir / "scene_mesh.obj"
        main_mesh_glb = out_dir / "scene_mesh.glb"

        if not main_mesh_glb.is_file() and (main_glb.is_file() or main_ply.is_file()):
            self.generate_mesh_exports(job_id)

        output_files = {}
        if main_glb.is_file():
            output_files["glb"] = f"/storage/jobs/{job_id}/outputs/scene.glb"
        if (out_dir / "scene_points.glb").is_file():
            output_files["points_glb"] = f"/storage/jobs/{job_id}/outputs/scene_points.glb"
        elif main_glb.is_file():
            output_files["points_glb"] = f"/storage/jobs/{job_id}/outputs/scene.glb"
        if main_ply.is_file():
            output_files["ply"] = f"/storage/jobs/{job_id}/outputs/scene.ply"
        if main_stl.is_file():
            output_files["stl"] = f"/storage/jobs/{job_id}/outputs/scene_mesh.stl"
        if main_obj.is_file():
            output_files["obj"] = f"/storage/jobs/{job_id}/outputs/scene_mesh.obj"
        if main_mesh_glb.is_file():
            output_files["mesh_glb"] = f"/storage/jobs/{job_id}/outputs/scene_mesh.glb"

        confidence_map = {}
        for c_file in sorted(out_dir.glob("scene_*.glb")):
            name = c_file.stem.replace("scene_", "")
            confidence_map[name] = f"/storage/jobs/{job_id}/outputs/{c_file.name}"
        if confidence_map:
            output_files["confidence_levels"] = confidence_map

        with self._lock:
            job = self.jobs.get(job_id)
            if job:
                job.output_files = output_files
                self._save_job_to_disk(job)

    def generate_mesh_exports(self, job_id: str) -> bool:
        job_dir = self.storage_dir / job_id
        out_dir = job_dir / "outputs"
        main_stl = out_dir / "scene_mesh.stl"
        main_obj = out_dir / "scene_mesh.obj"

        if main_stl.is_file() and main_obj.is_file():
            return True

        self._append_log(job_id, "Generating dense watertight solid 3D surface model (Poisson Meshing)...")

        script = f"""
import os, sys, shutil
import numpy as np

out_dir = {str(out_dir)!r}
main_ply = os.path.join(out_dir, "scene.ply")
main_glb = os.path.join(out_dir, "scene.glb")
stl_path = os.path.join(out_dir, "scene_mesh.stl")
obj_path = os.path.join(out_dir, "scene_mesh.obj")
glb_path = os.path.join(out_dir, "scene_mesh.glb")

try:
    import open3d as o3d
except ImportError:
    sys.exit(1)

pcd = None
if os.path.isfile(main_ply) and os.path.getsize(main_ply) > 1000:
    try:
        pcd = o3d.io.read_point_cloud(main_ply)
    except Exception:
        pcd = None

if pcd is None or len(pcd.points) < 50:
    if os.path.isfile(main_glb):
        try:
            import trimesh
            s = trimesh.load(main_glb)
            for g in s.geometry.values():
                if isinstance(g, trimesh.PointCloud) and len(g.vertices) > 20:
                    pcd = o3d.geometry.PointCloud()
                    pcd.points = o3d.utility.Vector3dVector(np.asarray(g.vertices))
                    if hasattr(g, 'colors') and g.colors is not None:
                        c = np.asarray(g.colors)[:, :3].astype(np.float64)
                        if c.max() > 1.0: c /= 255.0
                        pcd.colors = o3d.utility.Vector3dVector(c)
                    break
        except Exception:
            pass

if pcd is None or len(pcd.points) < 10:
    sys.exit(2)

bbox = pcd.get_axis_aligned_bounding_box()
diag = np.linalg.norm(bbox.get_extent())
if len(pcd.points) > 35000:
    v_size = max(0.012, diag / 200.0)
    pcd = pcd.voxel_down_sample(voxel_size=v_size)

pcd.estimate_normals(search_param=o3d.geometry.KDTreeSearchParamHybrid(radius=max(0.05, diag / 75.0), max_nn=25))
pcd.orient_normals_consistent_tangent_plane(k=15)

try:
    mesh, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(pcd, depth=8, linear_fit=False, n_threads=2)
    densities = np.asarray(densities)
    if len(densities) > 0 and len(mesh.vertices) > 0:
        trim_mask = densities < np.quantile(densities, 0.02)
        mesh.remove_vertices_by_mask(trim_mask)

    if pcd.has_colors() and len(mesh.vertices) > 0:
        pcd_tree = o3d.geometry.KDTreeFlann(pcd)
        mesh_verts = np.asarray(mesh.vertices)
        pcd_cols = np.asarray(pcd.colors)
        k_indices = []
        for v in mesh_verts:
            _, idx, _ = pcd_tree.search_knn_vector_3d(v, 1)
            k_indices.append(idx[0])
        mesh.vertex_colors = o3d.utility.Vector3dVector(pcd_cols[k_indices])

    mesh.compute_vertex_normals()
    mesh.compute_triangle_normals()

    o3d.io.write_triangle_mesh(stl_path, mesh)
    o3d.io.write_triangle_mesh(obj_path, mesh)
    o3d.io.write_triangle_mesh(glb_path, mesh)
    sys.exit(0)
except Exception:
    sys.exit(3)
"""
        python_exec = str(self.python_bin) if self.python_bin and os.path.isfile(str(self.python_bin)) else sys.executable
        try:
            res = subprocess.run([python_exec, "-c", script], capture_output=True, text=True, timeout=90, check=False)
            if res.returncode == 0:
                self._append_log(job_id, "Dense watertight solid 3D mesh model generated successfully.")
                with self._lock:
                    job = self.jobs.get(job_id)
                    if job and job.output_files:
                        job.output_files["glb"] = f"/storage/jobs/{job_id}/outputs/scene.glb"
                        job.output_files["points_glb"] = f"/storage/jobs/{job_id}/outputs/scene_points.glb"
                        job.output_files["stl"] = f"/storage/jobs/{job_id}/outputs/scene_mesh.stl"
                        job.output_files["obj"] = f"/storage/jobs/{job_id}/outputs/scene_mesh.obj"
                        job.output_files["mesh_glb"] = f"/storage/jobs/{job_id}/outputs/scene_mesh.glb"
                return True
            else:
                self._append_log(job_id, f"Mesh export warning: {res.stderr.strip()[:200]}")
                return False
        except Exception as e:
            self._append_log(job_id, f"Mesh generation exception: {e}")
            return False

    async def submit_job(self, job_id: str):
        """Asynchronously queues the job for background execution.

        Waits for the worker to initialise the shared asyncio.Queue so that
        submit_job and start_worker always use the *same* queue instance.
        """
        # Spin-wait (up to ~5 s) for the worker to create the queue.
        # Under normal startup this resolves in <50 ms.
        for _ in range(100):
            if self._queue is not None:
                break
            await asyncio.sleep(0.05)

        if self._queue is None:
            # Defensive fallback — should never happen if lifespan started the worker.
            logger.warning("submit_job: worker queue was not ready — creating queue as fallback")
            self._queue = asyncio.Queue()

        await self._queue.put(job_id)
        logger.info(f"Job {job_id} submitted to reconstruction queue (qsize={self._queue.qsize()})")

    async def start_worker(self):
        """Background worker consuming jobs from the queue.

        Creates the single shared asyncio.Queue inside the running event loop
        so that submit_job (which awaits it) always pushes to the same object.
        """
        # ── Single source-of-truth for the queue ──────────────────────
        self._queue = asyncio.Queue()

        logger.info("Starting background reconstruction worker...")

        # Worker queue starts fresh for the current server session.
        # Any unfinished jobs from prior runs are cleanly marked interrupted by _load_existing_jobs.

        while True:
            try:
                job_id = await self._queue.get()
                logger.info(f"Worker picked up job {job_id}")
                # Skip jobs that were cancelled while waiting in the queue
                with self._lock:
                    job = self.jobs.get(job_id)
                    if job and job.status in (JobStatus.CANCELLED, JobStatus.COMPLETED, JobStatus.FAILED):
                        logger.info(f"Skipping job {job_id} (status={job.status.value})")
                        self._queue.task_done()
                        continue
                try:
                    await asyncio.to_thread(self._run_reconstruction_sync, job_id)
                except Exception as e:
                    logger.error(f"Worker job exception for {job_id}: {e}", exc_info=True)
                finally:
                    self._queue.task_done()
            except asyncio.CancelledError:
                logger.info("Reconstruction worker cancelled — shutting down cleanly.")
                break
            except Exception as e:
                logger.error(f"Worker outer exception: {e}", exc_info=True)
                # Brief pause to avoid busy-looping on repeated errors
                await asyncio.sleep(0.5)
