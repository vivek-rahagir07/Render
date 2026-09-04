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
7. [3D Viewer Capabilities](#-3d-viewer-capabilities-modelviewer)
8. [Output Formats & Exports](#-output-formats--exports)
9. [Tech Stack](#-tech-stack)
10. [Operational Applications](#-operational-applications)
11. [Troubleshooting](#-troubleshooting)

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

## 🧪 3D Viewer Capabilities (`ModelViewer`)

The Three.js (r128) viewport that every reconstruction lands in. Every control is also keyboard-discoverable via the **Scene Controls** panel.

- **Metric 3D Ruler** — Click any two surface points to draw a dashed line between them; the HUD shows distance and elevation Δ in meters.
- **Auto-Orbit / Reset Camera** — Animated turntable and one-click reframing to the model's bounding sphere.
- **Point Size, Brightness, Wireframe** — Live sliders and toggles bound directly to the loaded geometry.
- **Solid ↔ Point Cloud toggle** — Swap between the textured mesh (`scene.glb`) and the raw points cloud.
- **Camera Frustums toggle** — Show/hide the sparse per-view camera wireframes MUSt3R emits (auto-hidden by default).
- **Precision Filter** — Hot-swap between confidence tiers (`scene_ultra`, `scene_clean`, `scene_balanced`, `scene_dense`, plus 5.0/3.0/2.0/1.5 thresholds) without re-running the job.
- **Live Flight Framing** — Up to 36 holographic camera cards (textured with the real keyframes) trace a Catmull-Rom spline of the flight path, with a pulsing core whose color reflects the current pipeline stage.
- **Geospatial grid + radar sweep** — A 12×32 ground grid with concentric rings and a rotating sweep segment for situational context.
- **Theme cycling** — 4 viewport color schemes (Tactical Cyan, Deep Blue, Amber Ops, Matrix Green).
- **PNG snapshot** — One-click viewport screenshot via `preserveDrawingBuffer`.
- **Fullscreen** — Immersive inspection of the 3D scene.
- **Stats badge** — Live point count and format readout (e.g. *PLY Point Cloud • 42.3k Splats • Metric Accurate*).

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
