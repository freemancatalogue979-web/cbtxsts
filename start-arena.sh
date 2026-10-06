#!/usr/bin/env bash
# Absolute Genesis server launcher.
#
# VPS (persistent; survives SSH/terminal logout):
#   ./start-arena.sh              # install/update dependencies and start both
#   ./start-arena.sh status       # show process state
#   ./start-arena.sh logs         # follow API + web logs
#   ./start-arena.sh restart      # restart both
#   ./start-arena.sh stop         # stop both
#   ./start-arena.sh demo         # fill the running app with the demo world (US/UK accounts, groups, teachers…)
#
# Local development (attached to this terminal):
#   ./start-arena.sh foreground
#   ./start-arena.sh share        # attached + Cloudflare quick tunnel
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-all}"
API_PORT="${API_PORT:-3000}"
WEB_PORT="${WEB_PORT:-5173}"
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

# AI key for "Make it easy to read" (Gemini or DeepSeek). Asked once and
# stored in backend/.env, which is ignored by Git.
ensure_gemini_key() {
  local env_file="$ROOT/backend/.env"
  if [ -n "${GEMINI_API_KEY:-}${DEEPSEEK_API_KEY:-}" ]; then return; fi
  if [ -f "$env_file" ] && grep -Eq '^(GEMINI|DEEPSEEK)_API_KEY=.+' "$env_file"; then return; fi
  if [ ! -t 0 ]; then
    log "No AI key yet — AI rewrite stays off (add a key to backend/.env)."
    return
  fi
  log "Paste your Gemini or DeepSeek API key (typing is hidden; Enter skips):"
  local key=""
  read -rs key || true
  echo
  if [ -z "$key" ]; then
    log "Skipped — add GEMINI_API_KEY=... or DEEPSEEK_API_KEY=... later."
    return
  fi
  ( umask 077; touch "$env_file" )
  local name="GEMINI_API_KEY"
  case "$key" in sk-*) name="DEEPSEEK_API_KEY" ;; esac
  grep -v "^$name=" "$env_file" > "$env_file.tmp" 2>/dev/null || true
  printf '%s=%s\n' "$name" "$key" >> "$env_file.tmp"
  mv "$env_file.tmp" "$env_file"
  chmod 600 "$env_file"
  log "Saved as $name in backend/.env."
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
  ensure_gemini_key
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
    ensure_gemini_key
    setup_frontend
    start_api_daemon
    start_web_daemon
    echo
    show_status || true
    log "Safe to close this terminal. Use './start-arena.sh logs' to inspect output."
    ;;
  api)
    setup_backend
    ensure_gemini_key
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
    ensure_gemini_key
    setup_frontend
    start_api_daemon
    start_web_daemon
    show_status || true
    ;;
  status)
    show_status
    ;;
  demo)
    # Fill the running app with the presentation demo world (safe to re-run).
    setup_backend
    log "Building the demo world against http://127.0.0.1:${API_PORT} …"
    cd "$ROOT/backend" && ./.venv/bin/python scripts/demo_world.py --url "http://127.0.0.1:${API_PORT}"
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
    ensure_gemini_key
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
