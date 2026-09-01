#!/usr/bin/env bash
# ==============================================================================
# Render 3D — 1-Click Launch Script
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

# 2. Virtual environment detection
VENV_DIR=""
if [ -d "$HOME/must3r/.venv" ]; then
    VENV_DIR="$HOME/must3r/.venv"
elif [ -d "$ROOT_DIR/.venv" ]; then
    VENV_DIR="$ROOT_DIR/.venv"
else
    echo "📦 Creating Python virtual environment in .venv..."
    python3 -m venv "$ROOT_DIR/.venv"
    VENV_DIR="$ROOT_DIR/.venv"
fi

PYTHON="$VENV_DIR/bin/python"
PIP="$VENV_DIR/bin/pip"

# 3. Dependency Check
echo "🔍 Checking dependencies..."
$PIP install -q -r backend/requirements.txt

# 4. Launch FastAPI Server
PORT=8000
HOST="127.0.0.1"

echo "🚀 Starting Render 3D Server on http://$HOST:$PORT ..."
echo "🌐 Open your browser at: http://$HOST:$PORT"
echo "-----------------------------------------------------------------"

# Open browser automatically if on macOS
if [[ "$OSTYPE" == "darwin"* ]]; then
    (sleep 1.5 && open "http://$HOST:$PORT") &
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    (sleep 1.5 && xdg-open "http://$HOST:$PORT" 2>/dev/null) &
fi

exec "$PYTHON" -m uvicorn backend.main:app --host "$HOST" --port "$PORT" --reload
