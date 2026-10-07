#!/usr/bin/env bash
# 9 CLOVER — Competitive Operations launcher.
#
# Starts the FastAPI API (:9000) and the React web app (:9009).
#
# VPS (persistent; survives SSH/terminal logout):
#   ./start-arena.sh              # install/update dependencies and start both
#   ./start-arena.sh status       # show process state
#   ./start-arena.sh logs         # follow API + web logs
#   ./start-arena.sh restart      # restart both
#   ./start-arena.sh stop         # stop both
#
# Local development (attached to this terminal):
#   ./start-arena.sh foreground
#   ./start-arena.sh share        # attached + Cloudflare quick tunnel
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-all}"
API_PORT="${API_PORT:-9000}"
WEB_PORT="${WEB_PORT:-9009}"
RUN_DIR="$ROOT/.arena-run"
API_PID_FILE="$RUN_DIR/api.pid"
WEB_PID_FILE="$RUN_DIR/web.pid"
API_LOG="$RUN_DIR/api.log"
WEB_LOG="$RUN_DIR/web.log"

log() { printf '\033[38;5;141m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[38;5;214m! %s\033[0m\n' "$*" >&2; }

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
  if [ ! -d node_modules ] || ! cmp -s package-lock.json node_modules/.arena-lock 2>/dev/null; then
    log "Installing frontend dependencies…"
    npm install
    cp package-lock.json node_modules/.arena-lock
  fi
}

pid_running() {
  local file="$1" pid=""
  [ -f "$file" ] || return 1
  pid="$(cat "$file" 2>/dev/null || true)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

start_api_daemon() {
  mkdir -p "$RUN_DIR"
  if pid_running "$API_PID_FILE"; then
    log "API is already running (PID $(cat "$API_PID_FILE"))."
    return
  fi
  rm -f "$API_PID_FILE"
  : >> "$API_LOG"
  (
    cd "$ROOT/backend"
    # setsid gives the service its own session; nohup ignores the SSH hangup.
    nohup setsid ./.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port "$API_PORT" \
      >> "$API_LOG" 2>&1 < /dev/null &
    echo $! > "$API_PID_FILE"
  )
  sleep 1
  if ! pid_running "$API_PID_FILE"; then
    warn "API failed to start. Last log lines:"
    tail -n 30 "$API_LOG" >&2 || true
    return 1
  fi
  log "API started in background (PID $(cat "$API_PID_FILE"), port $API_PORT)."
}

start_web_daemon() {
  mkdir -p "$RUN_DIR"
  if pid_running "$WEB_PID_FILE"; then
    log "Web app is already running (PID $(cat "$WEB_PID_FILE"))."
    return
  fi
  rm -f "$WEB_PID_FILE"
  : >> "$WEB_LOG"
  (
    cd "$ROOT/frontend"
    nohup setsid ./node_modules/.bin/vite --host 0.0.0.0 --port "$WEB_PORT" \
      >> "$WEB_LOG" 2>&1 < /dev/null &
    echo $! > "$WEB_PID_FILE"
  )
  sleep 1
  if ! pid_running "$WEB_PID_FILE"; then
    warn "Web app failed to start. Last log lines:"
    tail -n 30 "$WEB_LOG" >&2 || true
    return 1
  fi
  log "Web app started in background (PID $(cat "$WEB_PID_FILE"), port $WEB_PORT)."
}

stop_one() {
  local name="$1" file="$2" pid=""
  if ! pid_running "$file"; then
    rm -f "$file"
    log "$name is not running."
    return
  fi
  pid="$(cat "$file")"
  log "Stopping $name (PID $pid)…"
  # Kill the whole independent session when possible, then the process itself.
  kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  for _ in 1 2 3 4 5; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 -- "-$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$file"
}

stop_all() {
  stop_one "web app" "$WEB_PID_FILE"
  stop_one "API" "$API_PID_FILE"
}

show_status() {
  local failed=0
  if pid_running "$API_PID_FILE"; then
    printf 'API      running  PID %-7s http://localhost:%s\n' "$(cat "$API_PID_FILE")" "$API_PORT"
  else
    printf 'API      stopped\n'; failed=1
  fi
  if pid_running "$WEB_PID_FILE"; then
    printf 'Web      running  PID %-7s http://localhost:%s\n' "$(cat "$WEB_PID_FILE")" "$WEB_PORT"
  else
    printf 'Web      stopped\n'; failed=1
  fi
  return "$failed"
}

start_foreground() {
  setup_backend
  setup_frontend
  ( cd "$ROOT/backend" && exec ./.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port "$API_PORT" --reload --reload-dir app ) &
  local api_pid=$!
  trap 'kill "$api_pid" 2>/dev/null || true' EXIT INT TERM
  log "API  → http://localhost:$API_PORT"
  sleep 2
  cd "$ROOT/frontend"
  log "Web  → http://localhost:$WEB_PORT"
  exec ./node_modules/.bin/vite --host 0.0.0.0 --port "$WEB_PORT"
}

case "$TARGET" in
  all|start)
    setup_backend
    setup_frontend
    start_api_daemon
    start_web_daemon
    echo
    show_status || true
    log "Safe to close this terminal. Use './start-arena.sh logs' to inspect output."
    ;;
  api)
    setup_backend
    start_api_daemon
    ;;
  web)
    setup_frontend
    start_web_daemon
    ;;
  stop)
    stop_all
    ;;
  restart)
    stop_all
    setup_backend
    setup_frontend
    start_api_daemon
    start_web_daemon
    show_status || true
    ;;
  status)
    show_status
    ;;
  logs)
    mkdir -p "$RUN_DIR"
    touch "$API_LOG" "$WEB_LOG"
    log "Following logs — Ctrl+C stops viewing only; the servers keep running."
    tail -n 80 -F "$API_LOG" "$WEB_LOG"
    ;;
  foreground)
    start_foreground
    ;;
  share)
    # A quick tunnel remains attached because its public URL only exists while
    # cloudflared is connected. The normal API/web services still survive SSH.
    setup_backend
    setup_frontend
    start_api_daemon
    start_web_daemon
    log "Opening a public HTTPS tunnel (Ctrl+C closes only the tunnel)…"
    if command -v cloudflared >/dev/null 2>&1; then
      cloudflared tunnel --no-autoupdate --url "http://localhost:$WEB_PORT"
    else
      npx --yes cloudflared tunnel --no-autoupdate --url "http://localhost:$WEB_PORT"
    fi
    ;;
  *)
    echo "usage: ./start-arena.sh [start|stop|restart|status|logs|api|web|foreground|share]" >&2
    exit 2
    ;;
esac
