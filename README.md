# Render 3D — Local MUSt3R 3D Reconstruction Web App

A modern, local-first web application for neural 3D scene reconstruction powered by [MUSt3R](https://github.com/naver/must3r) and Apple Silicon (MPS GPU).

---

## Architecture Overview

```
HTML5 / Vanilla CSS / Vanilla JS
             │
             ▼
      FastAPI API Server
             │
             ▼
    ReconstructionService
    (Modular Pipeline + Preprocessing Hooks)
             │
             ▼
   MUSt3R 512 / PyTorch MPS
   (get_reconstruction.py)
             │
             ▼
        GLB + PLY
             │
             ▼
  Three.js 3D Interactive Viewer
```

## Features

- **Local-First & Private:** Runs entirely on your local machine using your existing MUSt3R installation.
- **Apple Silicon (MPS) Acceleration:** Fast neural inference on M-series MacBooks using unified memory.
- **Drag-and-Drop Uploader:** Multi-file drag & drop supporting `JPG`, `PNG`, and `WEBP` with real-time thumbnail previews and count badges (recommends 20–40 images).
- **Asynchronous Execution:** Background job queue prevents UI freezes and handles long-running multi-view reconstructions smoothly.
- **Live Terminal & Progress Tracking:** Real-time log streaming and multi-stage status indicators (Ingest → Matching → Refinement → Export).
- **Interactive Three.js 3D Viewer:** Built with OrbitControls, GLTFLoader, customizable point size, grid toggle, dark/light theme toggle, and camera reset.
- **Direct GLB & PLY Downloads:** One-click download buttons for standard 3D formats.
- **Modular Pipeline:** Ready for future YOLO / SAM 2 dynamic object segmentation and removal integration.

---

## Directory Structure

```
Render/
├── frontend/
│   ├── index.html            # Semantic UI & viewer markup
│   ├── css/
│   │   └── style.css         # Glassmorphic dark design system
│   └── js/
│       ├── api.js            # FastAPI client & polling
│       ├── viewer.js         # Three.js 3D viewport manager
│       └── app.js            # App state & event orchestration
├── backend/
│   ├── main.py               # FastAPI server & endpoints
│   ├── reconstruction_service.py # Subprocess runner & pipeline
│   └── requirements.txt      # Python dependencies
├── storage/
│   └── jobs/                 # Per-job images, outputs, and logs
├── .env.example              # Configuration template
├── .gitignore
└── README.md
```

---

## Quick Start

### 1. Launch the Backend Server

Using your existing MUSt3R virtual environment:

```bash
cd /Users/vivek/Documents/GitHub/Render
~/must3r/.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

### 2. Open the Web Application

Navigate your browser to:
```
http://127.0.0.1:8000
```

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Health check & hardware/weights diagnostics |
| `POST` | `/api/reconstruction/jobs` | Upload images and queue a new reconstruction |
| `GET` | `/api/reconstruction/jobs/{job_id}` | Poll progress, stage, logs, and output models |
| `POST` | `/api/reconstruction/jobs/{job_id}/cancel` | Cancel an active reconstruction job |
| `GET` | `/api/reconstruction/jobs/{job_id}/download/{format}` | Download generated `.glb` or `.ply` |

---

## Configuration Options

Default parameters can be configured via environment variables or the UI's Advanced Settings:

- `image_size`: `512` (default, high quality) or `224` (fast)
- `device`: `mps` (Apple Silicon GPU) or `cpu`
- `max_bs`: `1` (optimal for 16GB RAM)
- `num_refinements_iterations`: `5`
- `execution_mode`: `retrieval` (for unordered photos) or `linseq` (for video sequences)
