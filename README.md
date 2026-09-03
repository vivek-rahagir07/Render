# 🛰️ AEROVOX — Autonomous Drone & Aerial 3D Reconstruction Studio

An AI-enabled system capable of generating georeferenced, metrically accurate 3D scene models from **single-pass drone video streams** or **multi-angle aerial photographs**. Powered by **MUSt3R** neural regressors and accelerated with **Apple Silicon (MPS)** and **CUDA**.

---

## ⚡ Quick Start (Run on Any Laptop)

### 📋 Prerequisites
- **Python 3.10 or 3.11** installed
- **Git** installed
- Hardware:
  - **Mac**: Apple Silicon (M1/M2/M3/M4) recommended (MPS accelerated)
  - **Linux / Windows WSL2**: NVIDIA GPU with CUDA or modern CPU

---

### 🚀 1-Click Launch (macOS & Linux)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/vivek-rahagir07/Render.git
   cd Render
   ```

2. **Run the startup script:**
   ```bash
   ./run.sh
   ```
   *The script automatically sets up `.env`, installs dependencies, launches the FastAPI server, and opens [http://127.0.0.1:8000](http://127.0.0.1:8000) in your browser.*

---

### 🛠️ Manual Step-by-Step Installation

If you prefer setting up manually:

1. **Clone the Repository:**
   ```bash
   git clone https://github.com/vivek-rahagir07/Render.git
   cd Render
   ```

2. **Create and Activate a Virtual Environment:**
   ```bash
   # macOS / Linux
   python3 -m venv .venv
   source .venv/bin/activate

   # Windows (PowerShell)
   python -m venv .venv
   .venv\Scripts\Activate.ps1
   ```

3. **Install Dependencies:**
   ```bash
   pip install -r backend/requirements.txt
   ```

4. **Configure Environment Variables:**
   ```bash
   cp .env.example .env
   ```
   *(Ensure `MUST3R_ROOT_DIR` in `.env` points to your MUSt3R directory or leave default if already present)*

5. **Start the Web Server:**
   ```bash
   uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
   ```

6. **Open in Browser:**
   Navigate to **`http://127.0.0.1:8000`**

---

## 🌟 Core Features

- **🛸 Single-Pass Drone Video Ingestion:** Drop any `.mp4`/`.mov` drone video; client-side AI extracts sharp parallax keyframes while filtering motion blur.
- **🪄 Automated AI Background & Clutter Isolation:** Powered by deep learning matting (`rembg`/ONNX) to remove background noise, focusing 100% of neural point density on the target subject.
- **📏 3D Metric Measurement Ruler:** Interactive in-viewport ruler to measure real-world distances ($D$) and elevation height ($\Delta H$) in meters.
- **🛰️ Live 3D Trajectory & Framing:** Holographic real-time visualization showing camera stations and the drone's flight path spline during analysis.
- **👑 Haute Couture Noir & Ivory Gold Interface:** Dual-theme luxury design system with zero chunky UI elements.
- **💾 Export Formats:** Instant one-click download for `.glb` (3D scene mesh) and `.ply` (metric point cloud).

---

## 📁 Project Structure

```
Render/
├── run.sh                    # 1-Click Launch Script
├── frontend/
│   ├── index.html            # Cockpit UI & 3D Viewport Markup
│   ├── css/
│   │   └── style.css         # Noir Gold & Ivory Gold Design System
│   └── js/
│       ├── api.js            # API polling & job management
│       ├── viewer.js         # Three.js 3D Viewer & Metric Ruler
│       └── app.js            # Keyframe extraction & event bindings
├── backend/
│   ├── main.py               # FastAPI Endpoints & Static Server
│   ├── reconstruction_service.py # Subprocess pipeline & AI Matting
│   └── requirements.txt      # Python Dependencies
├── storage/
│   └── jobs/                 # Local job runs, frames, and 3D outputs
├── .env.example              # Environment variables template
└── README.md                 # Documentation & Guides
```

---

## 📡 API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | `GET` | System health, GPU diagnostics, and model status |
| `/api/reconstruction/jobs` | `POST` | Upload frames and start 3D reconstruction |
| `/api/reconstruction/jobs/{job_id}` | `GET` | Real-time progress, stage, logs & model URIs |
| `/api/reconstruction/jobs/{job_id}/cancel` | `POST` | Abort an active reconstruction job |
| `/api/reconstruction/jobs/{job_id}/download/{format}` | `GET` | Download `.glb` or `.ply` |
