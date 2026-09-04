# 🛰️ AEROVOX — Autonomous Drone & Aerial 3D Reconstruction Studio

An AI-enabled, **local-first** system that turns **single-pass drone video streams** or **multi-angle aerial photographs** into **georeferenced, metrically accurate 3D scene models** — dense point clouds, photoreal meshes, and watertight solid surfaces — entirely on your laptop. Powered by **MUSt3R / DUSt3R neural regressors** and accelerated by **Apple Silicon (MPS)** or **NVIDIA CUDA**, with a holographic Three.js cockpit UI for live inspection and metric measurement.

> 🔒 **100% Local & Private:** No data ever leaves your machine. Inference runs locally — ideal for sensitive reconnaissance, surveying, and field work.

---

## 📌 Table of Contents

1. [🌟 Highlights](#-highlights)
2. [📋 System Requirements & Prerequisites](#-system-requirements--prerequisites)
3. [🚀 Quick Start (1-Click Launch)](#-quick-start-1-click-launch)
4. [🛠️ Complete Step-by-Step Manual Setup](#️-complete-step-by-step-manual-setup)
5. [💻 Command Reference & Cheatsheet](#-command-reference--cheatsheet)
6. [📁 Project & Engine Structure](#-project--engine-structure)
7. [⚙️ Configuration (.env)](#️-configuration-env)
8. [🧭 How It Works — End-to-End Pipeline](#-how-it-works--end-to-end-pipeline)
9. [🧪 3D Cockpit & Viewer Controls](#-3d-cockpit--viewer-controls)
10. [📦 Output Formats & Exports](#-output-formats--exports)
11. [🩺 Troubleshooting & Common Fixes](#-troubleshooting--common-fixes)
12. [📜 Credits & License](#-credits--license)

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
- **⏱️ Durable Job Persistence** — Every job (running, completed, or interrupted by a restart) is persisted to `storage/jobs/<id>/job.json` and restored on next launch.

---

## 📋 System Requirements & Prerequisites

### 1. Hardware
- **Apple Silicon Mac (Recommended):** M1 / M2 / M3 / M4 with 16 GB+ unified memory (uses Apple Metal MPS acceleration).
- **Linux / Windows WSL2:** NVIDIA GPU with CUDA (≥8 GB VRAM recommended) or multi-core CPU.
- **Storage:** ~4 GB free disk space (for MUSt3R neural backbone weights and dependencies).

### 2. Software Prerequisites
- **Git**
- **Python 3.10 or Python 3.11** *(Important: Python 3.14 is currently too new for prebuilt binary wheels like Open3D / PyTorch ecosystem)*.
- **Homebrew (macOS):**
  ```bash
  # If you need to install Python 3.11 on macOS:
  brew install python@3.11 git
  ```

---

## 🚀 Quick Start (1-Click Launch)

The easiest way to run the application is using the automated startup script.

```bash
# 1. Navigate to the project directory
cd /path/to/Render

# 2. Make run.sh executable (if not already)
chmod +x run.sh

# 3. Launch the application
./run.sh
```

### What `run.sh` Does Automatically:
1. Creates `.env` from `.env.example` if not present.
2. Clones the **MUSt3R** repository into `./must3r` (including the `dust3r` submodule).
3. Downloads the **MUSt3R 512 backbone (~1.69 GB)** and **retrieval weights (8 MB)** into `./must3r/models/`.
4. Creates a Python 3.11 virtual environment (`.venv`).
5. Installs all backend and neural engine dependencies (`backend/requirements.txt`).
6. Starts the FastAPI + Uvicorn server at `http://127.0.0.1:8000` and opens your browser.

> 💡 **macOS Finder Launcher:** You can also double-click `start.command` in macOS Finder to launch the project in a single click.

---

## 🛠️ Complete Step-by-Step Manual Setup

If you prefer to set up every component manually or need to debug an existing environment, follow these exact commands:

### Step 1: Clone the Project
```bash
git clone https://github.com/vivek-rahagir07/Render.git
cd Render
```

### Step 2: Set Up MUSt3R Engine & Submodules
```bash
# Clone MUSt3R recursively into the project folder
git clone --recursive https://github.com/naver/must3r.git must3r

# Verify or initialize the DUSt3R submodule
if [ ! -d "must3r/dust3r/dust3r" ]; then
    cd must3r
    git submodule update --init --recursive
    cd ..
fi
```

### Step 3: Download Model Weights
```bash
mkdir -p must3r/models

# Download MUSt3R 512 backbone (~1.69 GB)
curl -L -o must3r/models/MUSt3R_512.pth \
  "https://download.europe.naverlabs.com/must3r/MUSt3R_512.pth"

# Download Retrieval weights (~8 MB)
curl -L -o must3r/models/MUSt3R_512_retrieval_trainingfree.pth \
  "https://download.europe.naverlabs.com/must3r/MUSt3R_512_retrieval_trainingfree.pth"
```

### Step 4: Create Python 3.11 Virtual Environment
```bash
# Create virtual environment using Python 3.11
python3.11 -m venv .venv

# Activate the virtual environment
# macOS / Linux:
source .venv/bin/activate
# Windows (PowerShell):
# .venv\Scripts\Activate.ps1
```

### Step 5: Install Python Dependencies
```bash
# Upgrade pip, setuptools, wheel
pip install --upgrade pip setuptools wheel

# Install all backend and MUSt3R dependencies
pip install -r backend/requirements.txt
```

### Step 6: Configure Environment Variables
```bash
cp .env.example .env
```

Ensure `.env` contains:
```env
MUST3R_ROOT=must3r
MUST3R_PYTHON=.venv/bin/python
MUST3R_WEIGHTS=must3r/models/MUSt3R_512.pth
MUST3R_RETRIEVAL=must3r/models/MUSt3R_512_retrieval_trainingfree.pth

HOST=127.0.0.1
PORT=8000
STORAGE_DIR=storage/jobs

DEFAULT_DEVICE=mps
DEFAULT_IMAGE_SIZE=512
DEFAULT_MAX_BS=1
DEFAULT_REFINEMENT_ITERATIONS=6
DEFAULT_EXECUTION_MODE=retrieval
```

### Step 7: Launch the Server
```bash
uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

Open your browser at **`http://127.0.0.1:8000`**.

---

## 💻 Command Reference & Cheatsheet

| Task | Command |
| :--- | :--- |
| **Start with 1-Click Script** | `./run.sh` |
| **Start in Dev Mode (Auto-Reload)** | `./run.sh --reload` |
| **Activate Virtual Environment** | `source .venv/bin/activate` |
| **Manual Server Start** | `uvicorn backend.main:app --host 127.0.0.1 --port 8000` |
| **Check Environment & Hardware Status** | `python -c "from backend.reconstruction_service import ReconstructionService; print(ReconstructionService().check_environment())"` |
| **Test MUSt3R Inference CLI** | `python backend/engine/get_reconstruction.py --help` |
| **Check Active Port 8000** | `lsof -i :8000` |
| **Kill Port 8000 Process** | `kill -9 $(lsof -t -i :8000)` |
| **Clear Completed / Temporary Jobs** | `rm -rf storage/jobs/*` |

---

## 📁 Project & Engine Structure

```text
Render/
├── run.sh                          # 1-Click automated startup script
├── start.command                   # macOS double-click launcher
├── .env.example                    # Environment template
├── .env                            # Active configuration (gitignored)
├── .venv/                          # Python 3.11 virtual environment
├── must3r/                         # MUSt3R neural reconstruction engine
│   ├── dust3r/                     # DUSt3R submodule
│   ├── models/
│   │   ├── MUSt3R_512.pth          # Backbone weights (~1.69 GB)
│   │   └── MUSt3R_512_retrieval... # Retrieval codebook (8 MB)
│   ├── must3r/                     # Core neural architecture & retrieval
│   └── get_reconstruction.py
├── backend/
│   ├── main.py                     # FastAPI application & REST endpoints
│   ├── reconstruction_service.py   # Job queue, matting, subprocess orchestrator
│   ├── engine/
│   │   └── get_reconstruction.py   # Executable wrapper with outlier filters & meshing
│   └── requirements.txt            # Complete Python dependencies
├── frontend/
│   ├── index.html                  # Cockpit UI & 3D viewport markup
│   ├── css/style.css               # Tactical Noir & Ivory Gold design system
│   ├── assets/                     # Logos and showcase renderings
│   └── js/
│       ├── api.js                  # REST API client
│       ├── viewer.js               # Three.js 3D viewport, ruler, hologram tracer
│       └── app.js                  # Frontend controller & video keyframe extractor
└── storage/
    └── jobs/                       # Job storage (<id>/images, <id>/outputs)
```

---

## ⚙️ Configuration (.env)

| Variable | Description | Default |
| :--- | :--- | :--- |
| `MUST3R_ROOT` | Path to MUSt3R codebase folder | `must3r` |
| `MUST3R_PYTHON` | Python binary used to run inference subprocess | `.venv/bin/python` |
| `MUST3R_WEIGHTS` | Path to `MUSt3R_512.pth` | `must3r/models/MUSt3R_512.pth` |
| `MUST3R_RETRIEVAL` | Path to retrieval weights | `must3r/models/MUSt3R_512_retrieval_trainingfree.pth` |
| `STORAGE_DIR` | Directory where jobs and outputs are stored | `storage/jobs` |
| `HOST` / `PORT` | Bind host and port for Uvicorn | `127.0.0.1:8000` |
| `DEFAULT_DEVICE` | Compute device (`mps` for Apple Silicon, `cuda` for NVIDIA, `cpu`) | `mps` |
| `DEFAULT_IMAGE_SIZE` | Neural resolution (`512` or `224`) | `512` |
| `DEFAULT_MAX_BS` | Batch size for inference | `1` |
| `DEFAULT_REFINEMENT_ITERATIONS` | Global alignment refinement passes | `6` |

---

## 🧭 How It Works — End-to-End Pipeline

```text
┌─────────────────┐       ┌─────────────────┐       ┌──────────────────┐       ┌─────────────────────┐
│   Browser UI    │ ────▶ │  FastAPI Server │ ────▶ │  Async Queue &   │ ────▶ │    MUSt3R Engine    │
│ (Video/Images)  │ ◀──── │   (main.py)     │ ◀──── │  Worker Thread   │ ◀──── │(get_reconstruction) │
└─────────────────┘       └─────────────────┘       └──────────────────┘       └─────────────────────┘
  • Keyframe extract        • Job registration        • Rembg AI matting         • PyTorch MPS / CUDA
  • Three.js Viewport       • Static file server      • Subprocess execution     • Statistical SOR
  • Metric 3D ruler         • Progress streaming      • Persistence              • Poisson 3D meshing
```

1. **Upload & Keyframe Extraction:** Drop a `.mp4`/`.mov` drone video or image set. Videos are automatically sampled for high-parallax, motion-blur-filtered keyframes.
2. **AI Matting (Optional):** Foreground isolation using `rembg` (ONNX `u2net`) strips sky and distant backgrounds to concentrate points onto the target structure.
3. **Neural Ingestion & Retrieval:** MUSt3R regresses multi-view 3D pointmaps, camera poses, and focal lengths simultaneously.
4. **Global Refinement:** Non-linear optimization refines point clouds and camera splines across all viewpoints.
5. **Denoising & Statistical Outlier Removal (SOR):** Purges flying edges and disconnected floater artifacts.
6. **Poisson Surface Meshing:** Open3D creates a watertight solid 3D mesh (`.stl`, `.obj`, `.glb`).

---

## 🧪 3D Cockpit & Viewer Controls

- **📏 Metric 3D Ruler:** Click any two points on the 3D surface to measure distance and height differential ($\Delta Z$) in real-world meters.
- **🔄 Orbit & Turntable:** Left-click drag to rotate, right-click to pan, scroll to zoom. Toggle auto-orbit with the turntable control.
- **💎 Precision Tier Filter:** Switch between confidence thresholds (`scene_ultra`, `scene_clean`, `scene_balanced`, `scene_dense`) live in the viewport.
- **🧊 Solid Mesh ↔ Point Cloud:** Instant toggle between solid textured mesh and dense splat point cloud.
- **📷 Camera Stations & Frustums:** View the exact 3D camera trajectory and camera cones generated from the drone pass.
- **🎨 Viewport Themes:** Tactical Cyan, Deep Space Blue, Amber Ops, and Matrix Green.
- **📸 Screenshot:** One-click capture of the 3D viewport.

---

## 📦 Output Formats & Exports

Every completed reconstruction produces the following in `storage/jobs/<id>/outputs/`:

| File | Format | Description | Target Use Case |
| :--- | :--- | :--- | :--- |
| `scene.glb` | GLB | Primary clean scene (point cloud + camera poses) | Web viewing, Three.js, Blender |
| `scene.ply` | PLY | Dense colored point cloud | CloudCompare, MeshLab, GIS tools |
| `scene_mesh.glb` | GLB | Watertight solid mesh surface | Game engines, AR/VR, Unreal, Unity |
| `scene_mesh.stl` | STL | Watertight triangle mesh | 3D Printing (slicers) |
| `scene_mesh.obj` | OBJ | Wavefront 3D CAD mesh | CAD modeling, Rhino, Autodesk |
| `scene_clean.glb` | GLB | Denoised confidence-filtered model | High-precision visual review |
| `scene_dense.glb` | GLB | Maximum density model (lowest threshold) | Raw inspection |

---

## 🩺 Troubleshooting & Common Fixes

### 1. `ModuleNotFoundError: No module named 'gradio'` or `'faiss'` or `'asmk'`
* **Cause:** Missing MUSt3R engine dependencies in your Python environment.
* **Fix:**
  ```bash
  source .venv/bin/activate
  pip install -r backend/requirements.txt
  ```

### 2. `Could not find a version that satisfies the requirement open3d`
* **Cause:** You are running Python 3.14 (or unsupported Python version). Open3D and PyTorch C-extensions do not yet have prebuilt wheels for Python 3.14.
* **Fix:** Create your virtual environment with **Python 3.11**:
  ```bash
  brew install python@3.11
  rm -rf .venv
  python3.11 -m venv .venv
  source .venv/bin/activate
  pip install -r backend/requirements.txt
  ```

### 3. `Error starting reconstruction: Failed to fetch`
* **Cause:** The backend server is not running on port 8000.
* **Fix:** Start the server with `./run.sh` or `uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload`.

### 4. `MUSt3R process exited with code 1`
* **Cause:** Subprocess execution encountered an error (e.g. out of memory or missing model weights).
* **Fix:** Check the detailed log in `storage/jobs/<job_id>/job.json` to see the exact stack trace. If running out of memory on large image sets:
  - Select the **Lightning 224 Preview** preset.
  - Or reduce `Image Size` to `224` and `Batch Size` to `1` in settings.

### 5. `Engine Offline` Indicator in Cockpit Header
* **Cause:** MUSt3R directory or model weights are missing.
* **Fix:** Verify that `must3r/models/MUSt3R_512.pth` exists. Run `./run.sh` to auto-download missing weights.

---

## 📜 Credits & License

- **MUSt3R & DUSt3R:** Built upon research by NAVER LABS Europe ([MUSt3R GitHub](https://github.com/naver/must3r) / [DUSt3R GitHub](https://github.com/naver/dust3r)).
- **AEROVOX Application:** Full-stack orchestration, async worker pipeline, Three.js 3D cockpit, and metric measurement engine.

