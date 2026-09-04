#!/usr/bin/env bash

set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo "================================================================="
echo "   🛰️  Render 3D — Aerial Reconnaissance & 3D Reconstruction    "
echo "================================================================="

if [ ! -f ".env" ]; then
    echo "⚙️ Creating .env from .env.example..."
    cp .env.example .env
fi

MUST3R_PATH=""
if [ -d "$ROOT_DIR/must3r" ]; then
    MUST3R_PATH="$ROOT_DIR/must3r"
elif [ -d "$HOME/must3r" ]; then
    MUST3R_PATH="$HOME/must3r"
else
    echo ""
    echo "🔍 MUSt3R engine not found on this machine."
    echo "📥 Auto-cloning MUSt3R repository into $ROOT_DIR/must3r ..."
    git clone --recursive https://github.com/naver/must3r.git "$ROOT_DIR/must3r"
    MUST3R_PATH="$ROOT_DIR/must3r"
    echo "✅ MUSt3R cloned successfully."
fi

if [ ! -d "$MUST3R_PATH/dust3r/dust3r" ]; then
    echo "📥 Initializing and cloning DUSt3R submodules into $MUST3R_PATH/dust3r..."
    rm -rf "$MUST3R_PATH/dust3r"
    git clone --recursive https://github.com/naver/dust3r.git "$MUST3R_PATH/dust3r"
fi

MODELS_DIR="$MUST3R_PATH/models"
mkdir -p "$MODELS_DIR"

download_file() {
    local url="$1"
    local dest="$2"
    local name="$3"
    if [ ! -f "$dest" ]; then
        echo "📥 Downloading $name..."
        if command -v curl >/dev/null 2>&1; then
            curl -L -o "$dest" "$url"
        elif command -v wget >/dev/null 2>&1; then
            wget -O "$dest" "$url"
        fi
    fi
}

download_file "https://download.europe.naverlabs.com/must3r/MUSt3R_512.pth" "$MODELS_DIR/MUSt3R_512.pth" "MUSt3R 512 Backbone (~1.6 GB)"
download_file "https://download.europe.naverlabs.com/must3r/MUSt3R_512_retrieval_trainingfree.pth" "$MODELS_DIR/MUSt3R_512_retrieval_trainingfree.pth" "Retrieval Weights (8.4 MB)"

VENV_DIR=""
if [ -d "$ROOT_DIR/.venv" ]; then
    VENV_DIR="$ROOT_DIR/.venv"
elif [ -d "$MUST3R_PATH/.venv" ]; then
    VENV_DIR="$MUST3R_PATH/.venv"
else
    # Find suitable python version (prefer 3.11 or 3.10 for ML/Open3D compatibility)
    PY_CMD=""
    if command -v python3.11 >/dev/null 2>&1; then
        PY_CMD="python3.11"
    elif command -v python3.10 >/dev/null 2>&1; then
        PY_CMD="python3.10"
    elif command -v python3.12 >/dev/null 2>&1; then
        PY_CMD="python3.12"
    else
        PY_CMD="python3"
    fi
    echo "📦 Setting up Python virtual environment in .venv using $PY_CMD..."
    $PY_CMD -m venv "$ROOT_DIR/.venv"
    VENV_DIR="$ROOT_DIR/.venv"
fi

PYTHON="$VENV_DIR/bin/python"
PIP="$VENV_DIR/bin/pip"

echo "🔍 Checking dependencies..."
$PIP install -q -r backend/requirements.txt

PORT=8000
HOST="127.0.0.1"

echo ""
echo "🚀 Starting Render 3D Server on http://$HOST:$PORT ..."
echo "🌐 Open your browser at: http://$HOST:$PORT"
echo "================================================================="

if [[ "$OSTYPE" == "darwin"* ]]; then
    (sleep 1.5 && open "http://$HOST:$PORT") &
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    (sleep 1.5 && xdg-open "http://$HOST:$PORT" 2>/dev/null) &
fi

RELOAD_FLAG=""
if [[ "$*" == *"--reload"* ]] || [[ "$*" == *"--dev"* ]]; then
    RELOAD_FLAG="--reload --reload-dir backend"
fi

exec "$PYTHON" -m uvicorn backend.main:app --host "$HOST" --port "$PORT" $RELOAD_FLAG
