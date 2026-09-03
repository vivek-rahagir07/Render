import asyncio
import glob
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
from typing import Dict, List, Optional, Any, Callable
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
            Path.home() / "must3r",
            self.base_dir / "must3r",
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
        self._queue: asyncio.Queue = asyncio.Queue()
        self._worker_task: Optional[asyncio.Task] = None

        self.preprocessing_hooks: List[BasePreprocessingHook] = []

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
            progress=0,
            stage="Queued",
            message="Images uploaded, waiting in queue.",
            config=cfg_dict
        )

        with self._lock:
            self.jobs[job_id] = job

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

        return clean_name

    def get_job(self, job_id: str) -> Optional[JobInfo]:
        with self._lock:
            return self.jobs.get(job_id)

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

    def _update_progress(self, job_id: str, progress: int, stage: Optional[str] = None, message: Optional[str] = None):
        with self._lock:
            job = self.jobs.get(job_id)
            if job:
                job.progress = max(0, min(100, progress))
                if stage:
                    job.stage = stage
                if message:
                    job.message = message

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

            def process_single(p: Path):
                out_p = masked_dir / f"{p.stem}.png"
                try:
                    with Image.open(p) as img:
                        img_rgb = img.convert("RGB")
                        if session:
                            res = rembg.remove(img_rgb, session=session)
                        else:
                            res = rembg.remove(img_rgb)
                        res.save(out_p, "PNG")
                except Exception as ex:
                    shutil.copy2(p, masked_dir / f"{p.stem}{p.suffix}")

            with ThreadPoolExecutor(max_workers=min(4, os.cpu_count() or 2)) as executor:
                futures = [executor.submit(process_single, p) for p in image_paths]
                for f in as_completed(futures, timeout=45):
                    pass

            valid_masked = [f for f in masked_dir.iterdir() if f.is_file() and f.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp") and f.stat().st_size > 1000]
            if len(valid_masked) >= 2:
                self._append_log(job_id, f"[AI Matting] Successfully isolated subjects ({len(valid_masked)} frames ready for 3D reconstruction).")
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

            progress_counter = 15
            for line in iter(process.stdout.readline, ''):
                if not line:
                    break
                line_str = line.strip()
                if not line_str:
                    continue

                self._append_log(job_id, line_str)

                lower = line_str.lower()
                if "loading model" in lower:
                    self._update_progress(job_id, 20, "Reconstructing", "Loading MUSt3R neural network weights...")
                elif "retrieval" in lower or "matching" in lower or "finding pairs" in lower:
                    self._update_progress(job_id, 35, "Matching", "Extracting features & matching image pairs...")
                elif "global alignment" in lower or "optimizing" in lower or "refinement" in lower:
                    progress_counter = min(progress_counter + 5, 80)
                    self._update_progress(job_id, progress_counter, "Optimizing", "Optimizing 3D camera poses & scene geometry...")
                elif "exporting" in lower or "clean" in lower or "scene" in lower:
                    self._update_progress(job_id, 85, "Exporting", "Denoising & generating clean high-precision 3D files...")

            process.stdout.close()
            return_code = process.wait()

            with self._lock:
                self.active_processes.pop(job_id, None)

            if return_code != 0:
                if job.status == JobStatus.CANCELLED:
                    self._append_log(job_id, "Job execution cancelled.")
                    return
                raise RuntimeError(f"MUSt3R process exited with code {return_code}")

            self._update_progress(job_id, 90, "Exporting", "Finalizing high-precision GLB & PLY models...")
            with self._lock:
                job.status = JobStatus.EXPORTING

            self._postprocess_models(job_id, out_dir)

            with self._lock:
                job.status = JobStatus.COMPLETED
                job.progress = 100
                job.stage = "Completed"
                job.message = "High-precision 3D reconstruction finished successfully!"
                job.completed_at = datetime.utcnow().isoformat()

            self._append_log(job_id, "Job finished successfully! High-precision models ready.")

        except Exception as e:
            logger.error(f"Error during reconstruction for job {job_id}: {e}", exc_info=True)
            with self._lock:
                job.status = JobStatus.FAILED
                job.stage = "Failed"
                job.error = str(e)
                job.completed_at = datetime.utcnow().isoformat()
                job.message = f"Reconstruction failed: {e}"
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

        output_files = {}
        if main_glb.is_file():
            output_files["glb"] = f"/storage/jobs/{job_id}/outputs/scene.glb"
        if main_ply.is_file():
            output_files["ply"] = f"/storage/jobs/{job_id}/outputs/scene.ply"

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

        with self._lock:
            job = self.jobs.get(job_id)
            if job:
                job.output_files = output_files

    async def submit_job(self, job_id: str):
        """Asynchronously queues the job for background execution."""
        await self._queue.put(job_id)

    async def start_worker(self):
        """Background worker consuming jobs from the queue."""
        logger.info("Starting background reconstruction worker...")
        while True:
            try:
                job_id = await self._queue.get()
                logger.info(f"Worker picked up job {job_id}")
                await asyncio.to_thread(self._run_reconstruction_sync, job_id)
                self._queue.task_done()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Worker exception: {e}", exc_info=True)
