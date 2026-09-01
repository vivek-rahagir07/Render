#!/usr/bin/env bash
# ==============================================================================
# Render 3D — 1-Click Launch & Auto-Setup Script
# Portable across any laptop (macOS / Linux / Windows WSL2)
# ==============================================================================

set -e

# Detect script directory
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo "================================================================="
echo "   🛰️  Render 3D — Aerial Reconnaissance & 3D Reconstruction    "
echo "================================================================="

# 1. Environment file check
if [ ! -f ".env" ]; then
    echo "⚙️ Creating .env from .env.example..."
    cp .env.example .env
fi

# 2. MUSt3R Repository Auto-Discovery & Auto-Clone
MUST3R_PATH=""
if [ -d "$HOME/must3r" ]; then
    MUST3R_PATH="$HOME/must3r"
elif [ -d "$ROOT_DIR/must3r" ]; then
    MUST3R_PATH="$ROOT_DIR/must3r"
else
    echo ""
    echo "🔍 MUSt3R engine not found on this machine."
    echo "📥 Auto-cloning MUSt3R repository into $HOME/must3r ..."
    git clone --recursive https://github.com/naver/must3r.git "$HOME/must3r"
    MUST3R_PATH="$HOME/must3r"
    echo "✅ MUSt3R cloned successfully."
fi

# 3. Model Weights Check & Auto-Download
MODELS_DIR="$MUST3R_PATH/models"
mkdir -p "$MODELS_DIR"

if [ ! -f "$MODELS_DIR/MUSt3R_512.pth" ]; then
    echo ""
    echo "📥 Downloading MUSt3R 512 model weights (~1.2 GB)..."
    if command -v curl >/dev/null 2>&1; then
        curl -L -o "$MODELS_DIR/MUSt3R_512.pth" "https://download.europe.naverlabs.com/must3r/MUSt3R_512.pth"
    elif command -v wget >/dev/null 2>&1; then
        wget -O "$MODELS_DIR/MUSt3R_512.pth" "https://download.europe.naverlabs.com/must3r/MUSt3R_512.pth"
    else
        echo "⚠️ Please download MUSt3R_512.pth into $MODELS_DIR/MUSt3R_512.pth"
    fi
    echo "✅ Model weights ready."
fi

# 4. Virtual Environment Detection & Setup
VENV_DIR=""
if [ -d "$MUST3R_PATH/.venv" ]; then
    VENV_DIR="$MUST3R_PATH/.venv"
elif [ -d "$ROOT_DIR/.venv" ]; then
    VENV_DIR="$ROOT_DIR/.venv"
else
    echo "📦 Setting up Python virtual environment in .venv..."
    python3 -m venv "$ROOT_DIR/.venv"
    VENV_DIR="$ROOT_DIR/.venv"
fi

PYTHON="$VENV_DIR/bin/python"
PIP="$VENV_DIR/bin/pip"

# 5. Dependency Check
echo "🔍 Checking dependencies..."
$PIP install -q -r backend/requirements.txt

# 6. Launch FastAPI Server
PORT=8000
HOST="127.0.0.1"

echo ""
echo "🚀 Starting Render 3D Server on http://$HOST:$PORT ..."
echo "🌐 Open your browser at: http://$HOST:$PORT"
echo "================================================================="

# Open browser automatically if on macOS
if [[ "$OSTYPE" == "darwin"* ]]; then
    (sleep 1.5 && open "http://$HOST:$PORT") &
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    (sleep 1.5 && xdg-open "http://$HOST:$PORT" 2>/dev/null) &
fi

exec "$PYTHON" -m uvicorn backend.main:app --host "$HOST" --port "$PORT" --reload
