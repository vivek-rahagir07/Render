# 🛰️ AEROVOX — Autonomous Drone & Aerial 3D Reconstruction Studio

An AI-enabled, **local-first** system that turns **single-pass drone video streams** or **multi-angle aerial photographs** into **georeferenced, metrically accurate 3D scene models** — dense point clouds, photoreal meshes, and watertight solid surfaces — entirely on your laptop. Powered by **MUSt3R / DUSt3R neural regressors** and accelerated by **Apple Silicon (MPS)** or **NVIDIA CUDA**, with a holographic Three.js cockpit UI for live inspection and metric measurement.

> No data ever leaves your machine. Inference runs 100% locally — ideal for sensitive reconnaissance, surveying, and field work.

---

## 📌 Table of Contents

1. [Highlights](#-highlights)
2. [How It Works — End-to-End Pipeline](#-how-it-works--end-to-end-pipeline)
3. [Quick Start](#-quick-start-run-on-any-laptop)
4. [Manual Installation](#-manual-step-by-step-installation)
5. [Configuration](#-configuration-environment-variables)
6. [Project Structure](#-project-structure)
7. [Backend Reference](#-backend-reference)
8. [Frontend Reference](#-frontend-reference)
9. [3D Viewer Capabilities](#-3d-viewer-capabilities-modelviewer)
10. [API Reference](#-api-reference)
11. [Output Formats & Exports](#-output-formats--exports)
12. [Tech Stack](#-tech-stack)
13. [Operational Applications](#-operational-applications)
14. [Troubleshooting](#-troubleshooting)

---

## 🌟 Highlights

- **🛸 Single-Pass Drone Video Ingestion** — Drop a `.mp4`/`.mov` drone clip; in-browser AI extracts sharp, parallax-optimal keyframes while filtering out motion-blurred frames. No pre-planned mission or ground control points required.
- **🧠 MUSt3R Neural Reconstruction** — Multi-view neural regressors solve camera intrinsics, pose splines, and dense point matching in seconds on local hardware. Global retrieval mode connects non-adjacent overlapping views.
- **🪄 AI Subject Isolation & Background Matting** — Deep-learning matting (`rembg` + ONNX `u2net`/`u2netp`) strips sky and background clutter so 100% of neural point density lands on the subject.
- **📐 Multi-Format Export** — One-click download of `.glb` (3D scene), `.ply` (point cloud), `.stl` (3D print), `.obj` (CAD), plus a watertight `.glb` mesh via Open3D Poisson surface reconstruction.
- **📏 In-Viewport Metric Ruler** — Click any two points in the 3D canvas to measure real-world distance and elevation delta in meters.
- **🛰️ Live Flight-Trajectory Hologram** — Real-time Three.js visualization showing camera stations, camera frustums, a Catmull-Rom flight spline with a moving tracer, and a pulsing holographic core that recolors per pipeline stage.
- **🎚️ Mission Presets** — *Rapid Tactical Recon*, *Metric Terrain & Facades (Max Depth)*, *Lightning 224 Preview* — each tunes resolution, refinement iterations, and batch size for the trade-off you want.
- **📊 Streaming Live Progress** — A live HUD with stage-by-stage progress, an elapsed timer, and a real-time terminal log stream of the MUSt3R inference output.
- **⏱️ Durable Job Persistence** — Every job (running, completed, or interrupted by a restart) is persisted to `storage/jobs/<id>/job.json` and restored on next launch, so nothing is lost across server restarts.
- **🍎 Local-First & Private** — Runs on Apple Metal MPS, NVIDIA CUDA, or CPU fallback. Zero cloud, zero telemetry.

---

## 🧭 How It Works — End-to-End Pipeline

```
┌─────────────┐   ┌──────────────┐   ┌────────────────┐   ┌──────────────────┐
│  Browser UI  │──▶│  FastAPI     │──▶│  Job Queue &    │──▶│  MUSt3R Engine    │
│  (Three.js)  │◀──│  (main.py)   │◀──│  Worker Thread   │◀──│  (get_recon.py)   │
└─────────────┘   └──────────────┘   └────────────────┘   └──────────────────┘
  upload +          REST + static      asyncio.Queue +        torch + dust3r +
  polling +         file serving       subprocess.Popen      must3r + open3d +
  3D viewport                                                 trimesh + rembg
```

**Step by step:**

1. **Capture / Upload** — You drop a drone video or a set of aerial photos into the browser. If it's a video, the browser decodes it with an offscreen `<video>` element and extracts 16–30 JPEG keyframes at even intervals (`processDroneVideo`).
2. **Job Creation** — The frontend POSTs the frames to `/api/reconstruction/jobs` with your config (resolution, device, iterations, trajectory mode, background-removal toggle). The backend validates each image, normalizes orientation (EXIF), downsamples to ≤1600 px, and saves it under `storage/jobs/<id>/images/`.
3. **Queue & Worker** — The job is enqueued in an `asyncio.Queue` and picked up by a single background worker running `_run_reconstruction_sync` in a thread (via `asyncio.to_thread`).
4. **AI Background Matting** (optional) — `rembg` isolates the foreground subject across all frames in a threaded pool, writing masked PNGs to `masked_images/`.
5. **MUSt3R Inference** — The backend spawns the bundled `engine/get_reconstruction.py` as a subprocess in the MUSt3R virtualenv. It loads the neural model, runs global-retrieval or sequential view matching, regresses per-view 3D pointmaps and camera poses, and refines global alignment.
6. **Clean Export** — Confidence-thresholded point clouds are filtered (Statistical Outlier Removal + flying-edge filter), then exported as `scene.glb` and `scene.ply`.
7. **Poisson Surface Mesh** — Open3D reconstructs a watertight solid mesh and exports `scene_mesh.stl`, `scene_mesh.obj`, and `scene_mesh.glb` (3D-print / CAD ready).
8. **Download & Inspect** — The browser loads the resulting GLB/PLY into the Three.js viewer, where you orbit, measure, toggle wireframe, change point size / brightness, and export.

---

## 🚀 Quick Start (Run on Any Laptop)

### 📋 Prerequisites

- **Python 3.10 or 3.11** installed
- **Git** installed
- **Hardware:**
  - **Mac:** Apple Silicon (M1/M2/M3/M4) recommended — uses Metal MPS acceleration
  - **Linux / Windows WSL2:** NVIDIA GPU with CUDA, or modern multi-core CPU
- ~3 GB free disk for the MUSt3R model weights

### 🚀 1-Click Launch (macOS & Linux)

```bash
git clone https://github.com/vivek-rahagir07/Render.git
cd Render
./run.sh
```

`run.sh` does everything for you:
1. Creates `.env` from `.env.example` if missing
2. Locates or **auto-clones** the MUSt3R repo (`~/must3r`) and its DUSt3R submodule
3. Downloads the **MUSt3R 512 backbone (~1.6 GB)** and **retrieval weights (8.4 MB)** if absent
4. Creates a Python virtualenv and installs `backend/requirements.txt`
5. Launches the FastAPI server at `http://127.0.0.1:8000` (auto-opens the browser on macOS/Linux)

### 🖱️ macOS Double-Click

`start.command` is a one-line launcher that drops into the project directory and runs `./run.sh` — double-click it in Finder to start.

### ⚙️ Flags

```bash
./run.sh --reload     # enable uvicorn auto-reload on backend changes (dev mode)
./run.sh --dev        # same as --reload
```

---

## 🛠️ Manual Step-by-Step Installation

1. **Clone the Repository:**
   ```bash
   git clone https://github.com/vivek-rahagir07/Render.git
   cd Render
   ```

2. **Set up MUSt3R** (the neural engine):
   ```bash
   git clone --recursive https://github.com/naver/must3r.git ~/must3r
   ```
   Download the model weights into `~/must3r/models/`:
   - `MUSt3R_512.pth` (~1.6 GB)
   - `MUSt3R_512_retrieval_trainingfree.pth` (8.4 MB)

3. **Create and Activate a Virtual Environment:**
   ```bash
   # macOS / Linux
   python3 -m venv .venv
   source .venv/bin/activate
   # Windows (PowerShell)
   python -m venv .venv
   .venv\Scripts\Activate.ps1
   ```

4. **Install Dependencies:**
   ```bash
   pip install -r backend/requirements.txt
   ```

5. **Configure Environment Variables:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` to point `MUST3R_ROOT`, `MUST3R_PYTHON`, `MUST3R_WEIGHTS`, and `MUST3R_RETRIEVAL` at your local MUSt3R install if it isn't in the default `~/must3r` location.

6. **Start the Web Server:**
   ```bash
   uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
   ```

7. **Open in Browser:** → **`http://127.0.0.1:8000`**

---

## ⚙️ Configuration (Environment Variables)

`.env` is auto-created from `.env.example` by `run.sh`. All values are optional — the backend auto-detects sensible defaults.

| Variable | Purpose | Default |
|---|---|---|
| `MUST3R_ROOT` | Root directory of the cloned MUSt3R repo | `~/must3r` |
| `MUST3R_PYTHON` | Python binary to run inference with (the MUSt3R venv) | auto-detected |
| `MUST3R_WEIGHTS` | Path to `MUSt3R_512.pth` backbone weights | `<MUST3R_ROOT>/models/MUSt3R_512.pth` |
| `MUST3R_RETRIEVAL` | Path to retrieval weights | `<MUST3R_ROOT>/models/MUSt3R_512_retrieval_trainingfree.pth` |
| `STORAGE_DIR` | Where job artifacts are stored | `storage/jobs` |
| `HOST` / `PORT` | Bind address for uvicorn | `127.0.0.1:8000` |
| `DEFAULT_DEVICE` | Default inference device | `mps` |
| `DEFAULT_IMAGE_SIZE` | Default neural backbone resolution | `512` |

The backend additionally searches `~/must3r`, `./must3r`, `~/Documents/must3r`, `~/Downloads/must3r`, and `/opt/must3r` for a `get_reconstruction.py` to locate the engine.

---

## 📁 Project Structure

```
Render/
├── run.sh                          # 1-Click launcher: auto-clones MUSt3R, downloads weights, installs deps, starts server
├── start.command                   # macOS double-click wrapper around run.sh
├── .env.example                    # Environment variables template
├── backend/
│   ├── __init__.py
│   ├── main.py                     # FastAPI app: endpoints, static file serving, lifespan worker
│   ├── reconstruction_service.py   # Job orchestration, queue, AI matting, subprocess pipeline, exports
│   ├── engine/
│   │   ├── __init__.py
│   │   └── get_reconstruction.py   # MUSt3R inference executable — model loading, clean export, Poisson mesh
│   └── requirements.txt            # Python dependencies
├── frontend/
│   ├── index.html                  # Cockpit UI & 3D viewport markup
│   ├── css/style.css               # Noir Gold & Ivory Gold design system
│   ├── assets/                     # Logo + showcase mesh renders
│   └── js/
│       ├── api.js                  # REST client — health, create job, poll, cancel, download
│       ├── viewer.js               # ModelViewer class — Three.js 3D viewport, ruler, live framing
│       └── app.js                  # App controller — keyframe extraction, UI wiring, presets, polling
├── storage/jobs/                   # Per-job artifacts (images/, outputs/, job.json) — gitignored
└── README.md
```

---

## 🧩 Backend Reference

### `backend/main.py` — FastAPI Application

The single entrypoint that serves the REST API **and** the static frontend.

- **Lifespan worker** — On startup, an `asyncio` background task runs `service.start_worker()`, which owns the single shared `asyncio.Queue` and consumes jobs one at a time. The worker is cleanly cancelled on shutdown.
- **CORS** is wide open (`allow_origins=["*"]`) for local development.
- **Static mounts:**
  - `/storage` → the `storage/` directory (so GLB/PLY outputs are HTTP-downloadable).
  - `/` → the `frontend/` directory (`html=True` serves `index.html`).

**Endpoints (see [API Reference](#-api-reference) below).**

### `backend/reconstruction_service.py` — Reconstruction Service

This is the orchestration brain. Key components:

#### Data classes

- **`JobStatus`** (Enum) — `queued`, `preprocessing`, `reconstructing`, `exporting`, `completed`, `failed`, `cancelled`.
- **`JobConfig`** — `image_size` (224/512), `device` (mps/cuda/cpu), `max_bs` (batch size), `num_refinements_iterations`, `execution_mode` (`retrieval` / `linseq`), `cam_size`, `render_once`, `num_mem_imgs`, `remove_background`.
- **`JobInfo`** — full state for a job: id, status, progress %, stage, message, timestamps, image count, config, **last 500 log lines**, output file URIs, and error text.

#### `ReconstructionService` — key methods

| Method | What it does |
|---|---|
| `__init__` | Resolves the MUSt3R root, python binary, model weight paths, and script; loads any existing jobs from disk. |
| `_load_existing_jobs` | Scans `storage/jobs/` on startup, restores completed jobs, and **marks any interrupted-in-progress job as `failed`** so the UI doesn't show a stuck "reconstructing" state after a server restart. |
| `_save_job_to_disk` | Persists `job.json` after every state change (durable state across restarts). |
| `check_environment` | Probes the MUSt3R install, python, weights, and runs `torch.backends.mps/cuda.is_available()` to report readiness + detected device. Returned by `/api/health`. |
| `create_job(config)` | Creates a UUID job, makes `images/` and `outputs/` dirs, saves initial `job.json`. |
| `validate_and_save_image` | Sanitizes filenames, strips path traversal, **strips EXIF orientation**, converts to RGB, **downscales to ≤1600 px**, re-encodes as JPEG q95. Rejects non-image / corrupt files. |
| `get_job(job_id)` | Fetches from memory or falls back to `job.json` on disk. |
| `cancel_job(job_id)` | Flips status to `cancelled`, `terminate()`s the active subprocess (escalates to `kill()` if it won't die within 0.5 s). |
| `_append_log` / `_update_progress` | Thread-safe log + progress updates, persisted to `job.json`. |
| `_apply_ai_background_removal` | Threaded `rembg` matting (u2netp → u2net fallback) to isolate foreground subjects. Falls back to the original frames if it fails or yields too few good masks. |
| `_run_reconstruction_sync` | The core worker. Runs preprocessing hooks → optional AI matting → builds the MUSt3R CLI command → spawns the subprocess → **parses TQDM + stage strings from stdout to drive live progress %** → calls `_postprocess_models` on success. |
| `_postprocess_models` | Picks the best confidence-tier GLB, generates `scene.ply` from the GLB (via `trimesh`), and triggers mesh exports. Populates `output_files` with all available format URIs. |
| `generate_mesh_exports` | Spawns a Python subprocess running Open3D Poisson surface reconstruction (depth=8, density-trim, vertex colors via KD-tree) to produce `scene_mesh.stl`, `.obj`, and `.glb`. |
| `submit_job` / `start_worker` | The asyncio queue + worker loop. `submit_job` waits up to 5 s for the worker to create the shared queue, then enqueues. The worker skips cancelled/completed/failed jobs. |

#### Pluggable preprocessing hooks

`BasePreprocessingHook` defines a `process_images(image_dir, job_info) -> Path` interface. The default is a no-op passthrough; the design is intentionally pluggable so YOLO / SAM 2 dynamic-object removal can be slotted in later without touching the worker.

### `backend/engine/get_reconstruction.py` — MUSt3R Inference Executable

The neural workhorse, spawned as a subprocess. Highlights:

- **CLI argument parser** with MUSt3R parameters: `--image_dir`, `--output`, `--weights`, `--retrieval`, `--device`, `--image_size` (512/224), `--execution_mode` (`linseq` / `retrieval` / `vidseq` / `vidslam`), `--max_bs`, `--num_refinements_iterations`, `--num_mem_imgs`, `--cam_size`, `--min_conf_thr`, `--flying_edges_thr`, `--file_type`.
- **`apply_fast_sor`** — Statistical Outlier Removal (cKDTree, k=16, std_ratio=1.15) purges stray noise dots and detached floaters from the point cloud.
- **`filter_flying_edges`** — Detects depth-discontinuity tears at frame edges (where depth gradients exceed a depth-proportional threshold) and masks them out.
- **`export_clean_scene_glb`** — The clean exporter: per-view confidence masking, alpha masking (for matted PNGs), flying-edge filtering, SOR denoising, camera frustum insertion with `dust3r.viz`, and GLB/PLY export.
- **`export_surface_mesh`** — Open3D Poisson surface reconstruction at depth=8 with `linear_fit=False` (this is the fix for Kazhdan PoissonRecon's "Failed to close loop" freeze), density-based vertex trimming, KD-tree color transfer, and STL/OBJ/GLB mesh export. Falls back to a trimesh convex hull if Open3D is unavailable or the cloud is too small.
- **Precision tiers** — After the primary `scene.glb`, the engine exports multiple confidence-threshold variants (`scene_ultra.glb`, `scene_clean.glb`, `scene_balanced.glb`, `scene_dense.glb`, `scene_3.0/2.5/2.0/1.5.glb`) so the viewer's **Precision Filter** dropdown can switch between geometry densities on the fly.
- **Device fallback** — MPS unavailable → CPU; CUDA unavailable → CPU. TF32 matmul enabled on CUDA.
- **PYTHONPATH bootstrapping** — Searches `MUST3R_ROOT`, `dust3r`, and `dust3r/croco` and inserts them into `sys.path` before importing `must3r`.

### `backend/requirements.txt`

FastAPI + uvicorn + python-multipart (web server / uploads), Pillow + numpy + scipy (image & point math), trimesh (mesh/scene export), rembg + onnxruntime (AI matting), torch + torchvision + einops (neural inference), open3d (Poisson meshing), opencv-python + matplotlib + tqdm (MUSt3R deps).

---

## 🖥️ Frontend Reference

A single-page Three.js app with three views: **Overview**, **Mission Setup**, and **3D Viewport**, plus a live pipeline HUD.

### `frontend/js/api.js` — REST Client (`window.API`)

| Method | Endpoint | Role |
|---|---|---|
| `checkHealth()` | `GET /api/health` | Polls engine readiness + detected device (MPS/CUDA/CPU). Drives the header status pill. |
| `createJob(files, config)` | `POST /api/reconstruction/jobs` | Uploads frames as `multipart/form-data` with the tuning config. |
| `getJobStatus(jobId)` | `GET /api/reconstruction/jobs/{id}` | Returns progress, stage, message, logs, and output file URIs. Polled every 1.2 s. |
| `cancelJob(jobId)` | `POST /api/reconstruction/jobs/{id}/cancel` | Aborts an active job. |
| `getDownloadUrl(jobId, format)` | — | Builds a `/download/{format}` URL for `glb`/`stl`/`obj`/`ply`. |

### `frontend/js/app.js` — App Controller

Wires the entire UI on `DOMContentLoaded`. Key behaviors:

- **Theme toggle** — Dual-theme design system (Noir Gold / Ivory Gold), persisted to `localStorage` (`aerovox_theme`).
- **System health pill** — Calls `API.checkHealth()` on load; shows `MPS • Engine Ready` / `MUSt3R Initializing` / `Engine Offline`.
- **Tab switching** — Single-Pass Drone Video vs. Multi-Angle Aerial Photos. Toggles `fileInput.accept` and the dropzone subtitle.
- **Drag & drop + file picker** — Full dropzone with dragenter/dragover/drop styling and click-to-browse delegation.
- **`processDroneVideo(videoFile)`** — Decodes the video in-browser via an offscreen `<video>` element, seeks to evenly-spaced timestamps (16–30 frames, scaled by duration), draws each to a canvas, and encodes JPEG keyframes. Each seek and `toBlob` call is guarded by a timeout so a missed event never stalls the loop.
- **Gallery** — Thumbnail grid with per-frame remove buttons, live count, and a minimum-2-frames gate on the Generate button.
- **Mission presets** — `Rapid Tactical Recon` (512px, 6 iter, bs 2), `Metric Terrain & Facades` (512px, 10 iter, bs 1), `Lightning 224 Preview` (224px, 4 iter, bs 2). Override the advanced settings.
- **Advanced settings** — Neural backbone resolution (512/224), pose refinement iterations (1–15), flight trajectory strategy (retrieval/linseq), inference hardware (mps/cpu), and the AI Subject Isolation toggle.
- **`startPolling(jobId)`** — 1.2 s interval poller. Maps job stage → HUD stage title, streams the last 50 log lines into the terminal drawer, and calls `onJobCompleted` when status is `completed`.
- **`updateJobProgressUI(job)`** — Drives the HUD progress bar, stage title/description, the live framing hologram recolor, and the terminal log.
- **`onJobCompleted(job)`** — Loads the finished GLB into the viewer and switches to the 3D viewport.
- **Demo/showcase models** — Three preloaded reconstructions load into the viewer from `/storage/jobs/...` for instant exploration without running a job.
- **Precision filter dropdown** — Reload the viewport from any confidence-tier GLB the engine produced (`scene_clean.glb`, `scene_ultra.glb`, …).
- **Download menu** — One-click export to GLB / STL / OBJ / PLY (STL & OBJ are generated on demand by the backend).
- **Scene controls panel** — Point size slider, brightness slider, and wireframe toggle, all driving the live viewer.

### `frontend/js/viewer.js` — `ModelViewer` (Three.js r128)

A self-contained class that builds the 3D scene. Major capabilities:

| Capability | Implementation |
|---|---|
| **Scene & camera** | `PerspectiveCamera` (45° FOV, 0.01–1000 near/far), `OrbitControls` with damping, ACES filmic tone mapping, sRGB output, fog. |
| **Geospatial grid** | A 12×32 grid + four concentric radar rings + a rotating radar sweep segment (`_buildGeospatialGrid`). |
| **Ambient particles** | 140-point atmospheric particle field that slowly rotates. |
| **Live flight framing** | `setupLiveFraming(files)` renders up to 36 camera cards (textured with the actual keyframes), each with a lens frustum, ground tether, ground ring, and a center ray to the origin. A holographic core (3 tori + an octahedron) pulses and rotates. A Catmull-Rom spline traces the flight path with a moving tracer sphere. Camera auto-orbits during analysis. |
| **Stage-driven recolor** | `updateLiveFramingStage` recolors the holographic core per pipeline stage (match→blue, refine→amber, export→green). |
| **Model loading** | `loadModel(url, onProgress, format)` — GLTFLoader for `.glb`, PLYLoader for `.ply`. Calls `fitCameraToModel` to frame the model and `_postProcessScene` to separate point clouds from surface meshes and camera frustums. |
| **Camera frustum detection** | Small meshes (≤50 vertices) are tagged as camera frustums and hidden by default; toggleable with `toggleCameraFrustums`. |
| **Metric ruler** | `toggleMeasurementTool` — click two points on the model; a dashed line + markers render, and the HUD shows distance (×5 metric scale) and elevation Δ. |
| **Theme cycling** | `toggleBackground` cycles 4 scene themes (Tactical Cyan, Deep Blue, Amber Ops, Matrix Green). |
| **Point style** | Smooth splats (radial-gradient texture) vs. sharp points, toggleable live. |
| **Brightness** | `setBrightness` scales tone-mapping exposure **and** ambient/directional light intensity (point clouds ignore tone mapping, so lights are scaled too). |
| **Wireframe** | `setWireframe` toggles wireframe on all non-frustum meshes. |
| **Screenshot** | `captureScreenshot` renders the canvas to a PNG download (`preserveDrawingBuffer: true` enables this). |
| **Fullscreen** | `toggleFullscreen` on the viewer section, with a 150 ms resize debounce. |
| **Mesh / point toggle** | `toggleMeshMode` swaps between the solid `scene.glb` and the `scene_points.glb` point cloud. |
| **Auto-rotate, reset camera, grid toggle, point size** | All bound to the viewer dock buttons. |

---

## 🧪 3D Viewer Capabilities (`ModelViewer`)

- **Metric 3D Ruler** — Click any two surface points to measure distance and elevation in meters.
- **Auto-Orbit / Reset Camera** — Animated turntable and one-click reframing.
- **Point Size, Brightness, Wireframe** — Live sliders and toggles in the Scene Controls panel.
- **Solid ↔ Point Cloud toggle** — Switch between the textured mesh and the raw point cloud.
- **Camera Frustums toggle** — Show/hide the sparse per-view camera wireframes MUSt3R emits.
- **Precision Filter** — Hot-swap between confidence tiers (Ultra / Clean / Balanced / Dense / 5.0 / 3.0 / 2.0 / 1.5) without re-running the job.
- **Theme cycling** — 4 viewport color schemes.
- **PNG snapshot** — One-click viewport screenshot.
- **Fullscreen** — Immersive inspection.
- **Stats badge** — Live point count and format readout ("PLY Point Cloud • 42.3k Splats • Metric Accurate").

---

## 📡 API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | `GET` | System health: `is_ready`, MUSt3R root, python binary, weights presence, MPS/CUDA availability, detected device, storage dir. |
| `/api/reconstruction/jobs` | `POST` | Upload frames (`files[]`) + config (`image_size`, `device`, `max_bs`, `num_refinements_iterations`, `execution_mode`, `cam_size`, `remove_background`). Validates ≥2 images, queues the job, returns `{job_id, status, image_count, message}`. |
| `/api/reconstruction/jobs/{job_id}` | `GET` | Live job state: `status`, `progress`, `stage`, `message`, timestamps, `image_count`, `output_files`, `error`, and last 50 log lines. |
| `/api/reconstruction/jobs/{job_id}/cancel` | `POST` | Cancels a queued or active job and terminates the subprocess. |
| `/api/reconstruction/jobs/{job_id}/download/{format}` | `GET` | Downloads `glb`, `ply`, `stl`, `obj`, or `mesh_glb`. STL/OBJ/mesh_glb are generated on demand (Open3D Poisson) if not already present. |
| `/storage/...` | `GET` | Static mount — direct access to any job's `outputs/` and `images/` artifacts. |

### Job lifecycle states

```
queued → preprocessing → reconstructing → exporting → completed
                                    └─→ failed
                  (any time) ──→ cancelled
```

Progress is reported as a coarse stage map:
- `5%` Queued → `8–15%` AI Matting → `18%` Loading Weights → `24–58%` Neural Ingestion (TQDM Pass 1) → `58–84%` 3D Optimization (TQDM Pass 2) → `86%` Denoising → `90%` Exporting → `95%` Poisson Meshing → `100%` Completed.

---

## 📦 Output Formats & Exports

For each completed job, `storage/jobs/<id>/outputs/` contains:

| File | Format | Contents | Use case |
|---|---|---|---|
| `scene.glb` | GLB | Primary clean scene (point cloud + cameras) | Default viewer load, Blender/Unity/Three.js |
| `scene.ply` | PLY | Point cloud | Point-cloud inspection, CloudCompare |
| `scene_points.glb` | GLB | Points-only view (fallback: `scene.glb`) | "Points" toggle in viewer |
| `scene_mesh.stl` | STL | Watertight Poisson solid mesh | 3D printing |
| `scene_mesh.obj` | OBJ | Watertight solid mesh | CAD / Blender |
| `scene_mesh.glb` | GLB | Watertight solid mesh | Game engines, AR/VR |
| `scene_*.glb` (tiers) | GLB | Multiple confidence-threshold variants | Precision filter dropdown |
| `scene.pkl` | pickle | Raw MUSt3R scene object | Debugging / re-export |

Downloads are served via `/api/reconstruction/jobs/{id}/download/{format}` — STL, OBJ, and `mesh_glb` are generated lazily by `generate_mesh_exports` (Open3D Poisson, depth=8, density-trim, KD-tree vertex colors) on the first download request.

---

## 🧱 Tech Stack

| Layer | Technology |
|---|---|
| **Neural reconstruction** | [MUSt3R](https://github.com/naver/must3r) + [DUSt3R](https://github.com/naver/dust3r) (PyTorch) |
| **Backend** | FastAPI + uvicorn, async job queue, threaded subprocess pipeline |
| **AI matting** | `rembg` + ONNX (`u2netp`/`u2net`) |
| **Mesh / point cloud** | Open3D (Poisson surface recon), trimesh, scipy (cKDTree SOR) |
| **Image processing** | Pillow (EXIF, downscale, JPEG encode) |
| **3D viewport** | Three.js r128 (GLTFLoader, PLYLoader, OrbitControls), custom shaders |
| **Frontend** | Vanilla JS (no framework), Space Grotesk + Plus Jakarta Sans + JetBrains Mono |
| **Acceleration** | Apple Metal (MPS), NVIDIA CUDA, CPU fallback |
| **Packaging** | `run.sh` auto-bootstraps MUSt3R, weights, venv, and deps |

---

## 🌍 Operational Applications

AEROVOX is built for scenarios where **a single flyover must produce a measurable 3D twin**:

1. **Border & Strategic Mapping** — corridor reconnaissance, perimeter modeling, terrain elevation analysis.
2. **Disaster Damage Assessment** — post-earthquake / flood / cyclone flybys to quantify collapsed structures and blocked routes.
3. **Urban Planning & Smart Cities** — 3D city models with facade geometry, rooftop profiles, and line-of-sight.
4. **Critical Infrastructure Inspection** — transmission corridors, bridges, wind turbines, pipelines with metric dimensions.
5. **Construction Progress Monitoring** — earthwork excavation, foundation progress, BIM compliance.
6. **Archaeological Documentation** — fragile heritage sites captured in millimeters.
7. **Digital Twin Generation** — GLB/PLY export to Unreal, Cesium, and GIS databases.
8. **Military Recon & Mission Planning** — single-pass tactical urban terrain for ingress/egress planning.

---

## 🩺 Troubleshooting

- **`Engine Offline` / `MUSt3R Initializing` pill** — The health check couldn't find a ready MUSt3R install. Re-run `./run.sh` (it auto-clones MUSt3R and downloads weights), or verify `MUST3R_ROOT` and the weight paths in `.env`.
- **Job stuck on `reconstructing` after a restart** — Interrupted jobs are auto-marked `failed` with the message *"Server was restarted before or during reconstruction."* Re-run the job.
- **`MUSt3R engine not found`** — The service couldn't locate `get_reconstruction.py` in any candidate root. Set `MUST3R_ROOT` explicitly or clone MUSt3R into `~/must3r`.
- **Poisson meshing freezes / "Failed to close loop"** — Already mitigated in `export_surface_mesh` with `linear_fit=False`, `depth=8`, voxel downsampling to ≤35k points, and `n_threads=2`. If it still fails, the code falls back to a trimesh convex hull.
- **MPS out-of-memory** — Lower `image_size` to 224, reduce `max_bs` to 1, or reduce `num_mem_imgs`. The Lightning 224 preset is built for low-VRAM runs.
- **Retrieval mode missing codebook** — The backend auto-falls back to `linseq` (sequential) mode if the retrieval codebook is absent or incomplete, with a log notice.
- **Background removal fails** — If `rembg` can't load any model, the pipeline transparently continues with the original full-frame images (logged as `[AI Matting Notice]`).

---

## 📜 License & Credits

AEROVOX wraps [MUSt3R](https://github.com/naver/must3r) and [DUSt3R](https://github.com/naver/dust3r) by NAVER Labs. Refer to those projects' licenses for the neural models and reconstruction code. The AEROVOX application layer (backend orchestration, UI, viewer) is this repository's own work.
