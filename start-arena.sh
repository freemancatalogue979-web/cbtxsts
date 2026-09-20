#!/usr/bin/env bash
# Quiz Arena — start the API (port 3000) and the web app (port 5173) together.
#
#   ./start-arena.sh            # both servers
#   ./start-arena.sh api        # backend only
#   ./start-arena.sh web        # frontend only
#
# First run: creates backend/.venv, installs both dependency sets, and seeds
# the SQLite database from backend/app/seed_data (356 students, 93 questions).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-all}"
API_PORT="${API_PORT:-3000}"
WEB_PORT="${WEB_PORT:-5173}"

log() { printf '\033[38;5;141m▸ %s\033[0m\n' "$*"; }

setup_backend() {
  cd "$ROOT/backend"
  if [ ! -d .venv ]; then
    log "Creating Python virtualenv…"
    python3 -m venv .venv
  fi
  log "Installing backend dependencies…"
  ./.venv/bin/pip install --quiet --upgrade pip
  ./.venv/bin/pip install --quiet -r requirements.txt
}

setup_frontend() {
  cd "$ROOT/frontend"
  if [ ! -d node_modules ]; then
    log "Installing frontend dependencies…"
    npm install
  fi
}

start_api() {
  cd "$ROOT/backend"
  log "API  → http://localhost:$API_PORT  (docs at /docs)"
  exec ./.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port "$API_PORT" --reload --reload-dir app
}

start_web() {
  cd "$ROOT/frontend"
  log "Web  → http://localhost:$WEB_PORT  (proxies /api and /ws to :$API_PORT)"
  exec npx vite --host 0.0.0.0 --port "$WEB_PORT"
}

case "$TARGET" in
  api) setup_backend; start_api ;;
  web) setup_frontend; start_web ;;
  all)
    setup_backend
    setup_frontend
    # Start the API in the background, then hand the foreground to Vite.
    ( cd "$ROOT/backend" && ./.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port "$API_PORT" --reload --reload-dir app ) &
    API_PID=$!
    trap 'kill $API_PID 2>/dev/null || true' EXIT INT TERM
    log "API  → http://localhost:$API_PORT  (docs at /docs)"
    sleep 2
    start_web
    ;;
  *)
    echo "usage: ./start-arena.sh [all|api|web]" >&2
    exit 2
    ;;
esac
