#!/usr/bin/env bash
# 9 CLOVER launcher: API (:9000) and web app (:9009).
#
#   ./start-arena.sh              install dependencies and start in background
#   ./start-arena.sh status       show running services
#   ./start-arena.sh logs         follow logs (Ctrl+C only stops the viewer)
#   ./start-arena.sh restart      check dependencies, then restart
#   ./start-arena.sh stop         stop background services started by this script
#   ./start-arena.sh api|web      start only one service
#   ./start-arena.sh foreground   run both attached to this terminal
#   ./start-arena.sh share        start both and open a Cloudflare quick tunnel
#   ./start-arena.sh update       pull, check dependencies and restart
set -euo pipefail

SCRIPT_PATH="${BASH_SOURCE[0]}"
if [[ "$SCRIPT_PATH" == */* ]]; then
  SCRIPT_DIR="${SCRIPT_PATH%/*}"
  [ -n "$SCRIPT_DIR" ] || SCRIPT_DIR="/"
else
  SCRIPT_DIR="."
fi
ROOT="$(cd "$SCRIPT_DIR" && pwd -P)"
API_PORT="${API_PORT:-9000}"
WEB_PORT="${WEB_PORT:-9009}"
STARTUP_TIMEOUT="${STARTUP_TIMEOUT:-60}"
RUN_DIR="$ROOT/.arena-run"
API_PID_FILE="$RUN_DIR/api.pid"
WEB_PID_FILE="$RUN_DIR/web.pid"
API_PORT_FILE="$RUN_DIR/api.port"
WEB_PORT_FILE="$RUN_DIR/web.port"
API_LOG="$RUN_DIR/api.log"
WEB_LOG="$RUN_DIR/web.log"
VENV_PY="$ROOT/backend/.venv/bin/python"

# Official Node.js distribution, installed locally only if a compatible system
# Node/npm is missing. SHA-256 values are from nodejs.org's release checksums.
# Update this pin and all four hashes together when security releases arrive.
NODE_VERSION="22.23.4"
NODE_TOOLS="$RUN_DIR/tools"

log() { printf '\033[38;5;141m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[38;5;214m! %s\033[0m\n' "$*" >&2; }

usage() {
  echo "Usage: ./start-arena.sh [start|stop|restart|status|logs|api|web|foreground|share|update]" >&2
}

validate_settings() {
  local name value
  for name in API_PORT WEB_PORT; do
    value="${!name}"
    if [[ ! "$value" =~ ^[0-9]{1,5}$ ]] || (( 10#$value < 1 || 10#$value > 65535 )); then
      warn "$name must be a port number between 1 and 65535."
      return 1
    fi
    printf -v "$name" '%d' "$((10#$value))"
  done
  if [[ ! "$STARTUP_TIMEOUT" =~ ^[0-9]{1,3}$ ]] || (( 10#$STARTUP_TIMEOUT < 1 || 10#$STARTUP_TIMEOUT > 300 )); then
    warn "STARTUP_TIMEOUT must be between 1 and 300 seconds."
    return 1
  fi
  STARTUP_TIMEOUT="$((10#$STARTUP_TIMEOUT))"
}

ensure_python() {
  if ! command -v python3 >/dev/null 2>&1; then
    warn "Python 3.10+ is required. On Ubuntu install python3 and python3-venv, then retry."
    return 1
  fi
  if ! python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))'; then
    warn "Python 3.10+ is required; install a newer python3 and python3-venv, then retry."
    return 1
  fi
}

setup_backend() {
  ensure_python || return 1
  if [ ! -x "$VENV_PY" ] || ! "$VENV_PY" -c 'import sys; sys.exit(sys.version_info < (3, 10))' >/dev/null 2>&1 || ! "$VENV_PY" -m pip --version >/dev/null 2>&1; then
    log "Creating or repairing backend/.venv…"
    if ! python3 -m venv "$ROOT/backend/.venv"; then
      warn "Could not create the Python environment. On Ubuntu: apt-get update && apt-get install -y python3-venv python3-pip"
      return 1
    fi
  fi
  log "Checking backend dependencies…"
  if ! "$VENV_PY" -m pip install --quiet --disable-pip-version-check --no-input -r "$ROOT/backend/requirements.txt"; then
    warn "Backend dependency installation failed. Check Python, network access and the pip error above."
    return 1
  fi
}

node_is_usable() {
  local version major minor npm_version
  command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 || return 1
  version="$(node --version 2>/dev/null)" || return 1
  [[ "$version" =~ ^v?([0-9]+)\.([0-9]+)\.[0-9]+$ ]] || return 1
  major=$((10#${BASH_REMATCH[1]}))
  minor=$((10#${BASH_REMATCH[2]}))
  # @vitejs/plugin-react requires ^20.19.0 or >=22.12.0.
  if ! (( (major == 20 && minor >= 19) || (major == 22 && minor >= 12) || major > 22 )); then
    return 1
  fi
  npm_version="$(npm --version 2>/dev/null)" || return 1
  [[ "$npm_version" =~ ^([0-9]+)\.[0-9]+\.[0-9]+$ ]] || return 1
  (( 10#${BASH_REMATCH[1]} >= 9 ))
}

download_file() {
  local url="$1" destination="$2"
  if command -v curl >/dev/null 2>&1 && curl -fsSL --retry 2 --connect-timeout 15 --max-time 300 --max-filesize 150000000 "$url" -o "$destination"; then
    return 0
  fi
  if command -v wget >/dev/null 2>&1 && wget -q --tries=2 --timeout=30 -O "$destination" "$url"; then
    return 0
  fi
  if command -v python3 >/dev/null 2>&1 && python3 - "$url" "$destination" <<'PY'
import sys
from urllib.request import urlopen
try:
    total = 0
    with urlopen(sys.argv[1], timeout=30) as source, open(sys.argv[2], "wb") as target:
        while chunk := source.read(1024 * 1024):
            total += len(chunk)
            if total > 150_000_000:
                raise ValueError("download exceeds size limit")
            target.write(chunk)
except Exception:
    sys.exit(1)
PY
  then
    return 0
  fi
  return 1
}

file_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    local result
    result="$(sha256sum "$1")" || return 1
    printf '%s\n' "${result%% *}"
  elif command -v shasum >/dev/null 2>&1; then
    local result
    result="$(shasum -a 256 "$1")" || return 1
    printf '%s\n' "${result%% *}"
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$1" <<'PY'
import hashlib, sys
h = hashlib.sha256()
with open(sys.argv[1], "rb") as f:
    for chunk in iter(lambda: f.read(1024 * 1024), b""):
        h.update(chunk)
print(h.hexdigest())
PY
  else
    return 1
  fi
}

ensure_node() {
  local platform arch checksum folder node_dir tmp archive actual old_path base
  if node_is_usable; then
    log "Using Node.js $(node --version) and npm $(npm --version)."
    return 0
  fi

  case "$(uname -s):$(uname -m)" in
    Linux:x86_64|Linux:amd64) platform=linux; arch=x64; checksum=b8492284c76a54baf58d61668dd0e41ee0fc98adabf9503d30f05d08f55b4406 ;;
    Linux:aarch64|Linux:arm64) platform=linux; arch=arm64; checksum=f7a1e486dbc8b286847815b477d4fb5e9fb963ed4489c3e1588853d685f589f9 ;;
    Darwin:x86_64) platform=darwin; arch=x64; checksum=efcc2b0db6f94bf53eddb038fe2b370277a042bd29e4f19b8f8e23598795b819 ;;
    Darwin:arm64) platform=darwin; arch=arm64; checksum=c9e1dbc748b33ed2d14f42445191ecaf14c56259c7a9a26d0042c49ec2b66428 ;;
    *)
      warn "This system needs Node.js 20.19+ or 22.12+ and npm 9+. Install them from https://nodejs.org/ and retry."
      return 1
      ;;
  esac
  folder="node-v${NODE_VERSION}-${platform}-${arch}"
  node_dir="$NODE_TOOLS/$folder"
  if [ -x "$node_dir/bin/node" ] && [ -x "$node_dir/bin/npm" ]; then
    old_path="$PATH"
    export PATH="$node_dir/bin:$PATH"
    hash -r
    if node_is_usable && [ "$(node --version)" = "v$NODE_VERSION" ]; then
      log "Using locally installed Node.js $(node --version) and npm $(npm --version)."
      return 0
    fi
    export PATH="$old_path"
    hash -r
  fi

  command -v tar >/dev/null 2>&1 || { warn "tar is required to install the local Node.js runtime."; return 1; }
  mkdir -p "$NODE_TOOLS" || return 1
  tmp="$(mktemp -d "$NODE_TOOLS/.node-install.XXXXXXXX")" || return 1
  archive="$tmp/$folder.tar.gz"
  base="${CLOVER_NODE_DIST_BASE:-https://nodejs.org/dist}"
  log "Node.js/npm is missing or too old; installing Node.js $NODE_VERSION locally (no sudo or system changes)…"
  if ! download_file "${base%/}/v${NODE_VERSION}/${folder}.tar.gz" "$archive"; then
    rm -rf -- "$tmp"
    warn "Could not download Node.js. Allow HTTPS access to nodejs.org, or install Node.js 20.19+ / 22.12+ with npm 9+ and retry."
    return 1
  fi
  actual="$(file_sha256 "$archive")" || actual=""
  if [ "$actual" != "$checksum" ]; then
    rm -rf -- "$tmp"
    warn "Node.js download failed its SHA-256 check; nothing was installed. Check your network/mirror and retry."
    return 1
  fi
  if ! tar -xzf "$archive" --no-same-owner -C "$tmp" || [ ! -x "$tmp/$folder/bin/node" ] || [ ! -x "$tmp/$folder/bin/npm" ]; then
    rm -rf -- "$tmp"
    warn "The verified Node.js archive could not be extracted. Check tar and free disk space."
    return 1
  fi
  if [ -e "$node_dir" ] || [ -L "$node_dir" ]; then
    # Preserve an incomplete/corrupt prior install rather than deleting it.
    if ! mv -- "$node_dir" "${node_dir}.broken-$(date +%s)-$$"; then
      rm -rf -- "$tmp"
      warn "Could not preserve the previous local Node.js install in $NODE_TOOLS."
      return 1
    fi
  fi
  if ! mv -- "$tmp/$folder" "$node_dir"; then
    rm -rf -- "$tmp"
    warn "Could not install the local Node.js runtime in $NODE_TOOLS."
    return 1
  fi
  rm -rf -- "$tmp"
  export PATH="$node_dir/bin:$PATH"
  hash -r
  if ! node_is_usable || [ "$(node --version)" != "v$NODE_VERSION" ]; then
    warn "The downloaded Node.js runtime cannot run on this system. Install a compatible Node.js and npm manually."
    return 1
  fi
  log "Local Node.js $(node --version) and npm $(npm --version) are ready."
}

setup_frontend() {
  node_is_usable || ensure_node || return 1
  local frontend="$ROOT/frontend" identity
  if [ ! -f "$frontend/package-lock.json" ]; then
    warn "frontend/package-lock.json is missing; restore it from the repository."
    return 1
  fi
  identity="$(node --version)|$(npm --version)|$(uname -s)|$(uname -m)"
  if [ ! -x "$frontend/node_modules/.bin/vite" ] || ! cmp -s "$frontend/package-lock.json" "$frontend/node_modules/.arena-lock" 2>/dev/null || [ "$(cat "$frontend/node_modules/.arena-node-version" 2>/dev/null || true)" != "$identity" ]; then
    log "Installing frontend dependencies from package-lock.json…"
    if ! (cd "$frontend" && npm ci --include=dev --no-audit --no-fund --no-progress); then
      warn "Frontend dependency installation failed. Check npm/network access and the error above."
      return 1
    fi
    if [ ! -x "$frontend/node_modules/.bin/vite" ]; then
      warn "npm did not install Vite. Check npm's configuration and retry."
      return 1
    fi
    cp "$frontend/package-lock.json" "$frontend/node_modules/.arena-lock" || return 1
    printf '%s\n' "$identity" > "$frontend/node_modules/.arena-node-version" || return 1
  fi
}

acquire_lock() {
  mkdir -p "$RUN_DIR" || return 1
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$RUN_DIR/launcher.lock"
    if ! flock -n 9; then
      warn "Another launcher operation is in progress. Wait for it to finish and retry."
      return 1
    fi
  else
    warn "flock is unavailable; avoid running multiple launcher commands at once."
  fi
}

pid_exists() {
  local pid="$1" stat
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] && kill -0 "$pid" 2>/dev/null || return 1
  if [ -r "/proc/$pid/stat" ]; then
    stat="$(cat "/proc/$pid/stat" 2>/dev/null)" || return 1
    stat="${stat##*) }"
    [ "${stat%% *}" != "Z" ] || return 1
  fi
}

pid_running() {
  local file="$1" pid cmd expected cwd
  [ -f "$file" ] || return 1
  pid="$(cat "$file" 2>/dev/null || true)"
  pid_exists "$pid" || return 1
  if [ -r "/proc/$pid/cmdline" ]; then
    cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline")"
  else
    cmd="$(ps -o args= -p "$pid" 2>/dev/null || true)"
  fi
  case "$file" in
    "$API_PID_FILE") [[ "$cmd" == *uvicorn* && "$cmd" == *app.main:app* ]] || return 1; expected="$ROOT/backend" ;;
    "$WEB_PID_FILE") [[ "$cmd" == *vite* && "$cmd" == *node_modules* ]] || return 1; expected="$ROOT/frontend" ;;
    *) return 1 ;;
  esac
  # A stale PID can be reused by an unrelated program. Never signal it unless
  # it is the right command in this checkout (or has an absolute checkout path).
  if [ -e "/proc/$pid/cwd" ]; then
    cwd="$(cd "/proc/$pid/cwd" 2>/dev/null && pwd -P)" || return 1
    expected="$(cd "$expected" 2>/dev/null && pwd -P)" || return 1
    [ "$cwd" = "$expected" ] || return 1
  else
    [[ "$cmd" == *"$ROOT/"* ]] || return 1
  fi
}

running_port() {
  local port_file="$1" pid="$2" port=""
  [ ! -f "$port_file" ] || port="$(cat "$port_file" 2>/dev/null || true)"
  # PID files from older launchers have no port file; inspect their arguments.
  if [[ ! "$port" =~ ^[0-9]+$ ]] && [ -r "/proc/$pid/cmdline" ]; then
    port="$(tr '\0' '\n' < "/proc/$pid/cmdline" | awk '$0 == "--port" {getline; print; exit}')"
  fi
  [[ "$port" =~ ^[0-9]+$ ]] || return 1
  printf '%s\n' "$port"
}

port_available() {
  local name="$1" port="$2"
  if command -v python3 >/dev/null 2>&1; then
    if ! python3 - "$port" <<'PY'
import errno, socket, sys, time
# A just-stopped listener (or its proxy) may need a moment to release the port.
for attempt in range(12):
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(("0.0.0.0", int(sys.argv[1])))
        break
    except OSError as exc:
        if exc.errno == errno.EADDRINUSE and attempt < 11:
            time.sleep(0.2)
            continue
        print(f"Port check: {exc}", file=sys.stderr)
        sys.exit(1)
PY
    then
      warn "$name port $port is unavailable. Stop the other service or set ${name}_PORT to a free port."
      return 1
    fi
  elif (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    warn "$name port $port is already in use. Stop the other service or choose a free port."
    return 1
  fi
}

probe_http() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --connect-timeout 1 --max-time 2 -o /dev/null "$url" 2>/dev/null
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$url" <<'PY' >/dev/null 2>&1
import sys
from urllib.request import urlopen
try:
    with urlopen(sys.argv[1], timeout=2) as response:
        sys.exit(0 if 200 <= response.status < 400 else 1)
except Exception:
    sys.exit(1)
PY
  else
    node -e 'const h=require("http").get(process.argv[1],r=>{r.resume();process.exit(r.statusCode>=200&&r.statusCode<400?0:1)});h.setTimeout(2000,()=>h.destroy());h.on("error",()=>process.exit(1))' "$url" >/dev/null 2>&1
  fi
}

terminate_pid() {
  local pid="$1" pgid="" i
  pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d '[:space:]' || true)"
  if [ "$pgid" = "$pid" ]; then
    kill -TERM -- "-$pid" 2>/dev/null || true
  else
    kill -TERM "$pid" 2>/dev/null || true
  fi
  for i in 1 2 3 4 5; do
    pid_exists "$pid" || break
    sleep 1
  done
  if [ "$pgid" = "$pid" ]; then
    kill -KILL -- "-$pid" 2>/dev/null || true
  elif pid_exists "$pid"; then
    kill -KILL "$pid" 2>/dev/null || true
  fi
}

stop_one() {
  local name="$1" file="$2" port_file="$3" pid
  if ! pid_running "$file"; then
    if [ -f "$file" ]; then warn "Ignoring stale $name PID file; no unrelated process was stopped."; fi
    rm -f -- "$file" "$port_file"
    log "$name is not running."
    return 0
  fi
  pid="$(cat "$file")"
  log "Stopping $name (PID $pid)…"
  terminate_pid "$pid"
  rm -f -- "$file" "$port_file"
}

stop_all() {
  stop_one "web app" "$WEB_PID_FILE" "$WEB_PORT_FILE"
  stop_one "API" "$API_PID_FILE" "$API_PORT_FILE"
}

show_status() {
  local failed=0 port pid
  if pid_running "$API_PID_FILE"; then
    pid="$(cat "$API_PID_FILE")"
    port="$(running_port "$API_PORT_FILE" "$pid" || echo '?')"
    if [[ "$port" =~ ^[0-9]+$ ]] && probe_http "http://127.0.0.1:$port/api/health"; then
      printf 'API      running  PID %-7s http://localhost:%s\n' "$pid" "$port"
    else
      printf 'API      not responding  PID %-7s port %s (see %s)\n' "$pid" "$port" "$API_LOG"; failed=1
    fi
  else
    printf 'API      stopped\n'; failed=1
  fi
  if pid_running "$WEB_PID_FILE"; then
    pid="$(cat "$WEB_PID_FILE")"
    port="$(running_port "$WEB_PORT_FILE" "$pid" || echo '?')"
    if [[ "$port" =~ ^[0-9]+$ ]] && probe_http "http://127.0.0.1:$port/"; then
      printf 'Web      running  PID %-7s http://localhost:%s\n' "$pid" "$port"
    else
      printf 'Web      not responding  PID %-7s port %s (see %s)\n' "$pid" "$port" "$WEB_LOG"; failed=1
    fi
  else
    printf 'Web      stopped\n'; failed=1
  fi
  return "$failed"
}

require_daemon_tools() {
  local tool
  for tool in nohup setsid ps; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      warn "$tool is required for background mode. On Ubuntu install coreutils, util-linux and procps, or use foreground mode."
      return 1
    fi
  done
}

# Sets STARTED_LAST=1 only if this call started a new service.
start_daemon() {
  local name="$1" file="$2" port_file="$3" port="$4" logfile="$5" dir="$6" route="$7"
  shift 7
  local pid existing i
  STARTED_LAST=0
  if pid_running "$file"; then
    pid="$(cat "$file")"
    existing="$(running_port "$port_file" "$pid" || true)"
    if [ "$existing" != "$port" ]; then
      warn "$name is already running on port ${existing:-unknown}; use restart to change its port."
      return 1
    fi
    if ! probe_http "http://127.0.0.1:$port$route"; then
      warn "$name is running but not responding on port $port. Check $logfile."
      return 1
    fi
    log "$name is already running (PID $pid, port $port)."
    return 0
  fi
  port_available "$name" "$port" || return 1
  mkdir -p "$RUN_DIR" || return 1
  rm -f -- "$file" "$port_file"
  if ! : >> "$logfile"; then warn "Cannot write $logfile."; return 1; fi
  (
    cd "$dir" || exit 1
    # Close the launcher lock in children, so later stop/restart commands work.
    exec nohup setsid "$@" 9>&-
  ) >> "$logfile" 2>&1 < /dev/null &
  pid=$!
  if ! printf '%s\n' "$pid" > "$file" || ! printf '%s\n' "$port" > "$port_file"; then
    terminate_pid "$pid"
    rm -f -- "$file" "$port_file"
    warn "Could not save $name's PID/port files in $RUN_DIR."
    return 1
  fi
  for ((i=0; i<STARTUP_TIMEOUT; i++)); do
    if ! pid_exists "$pid"; then break; fi
    if pid_running "$file" && probe_http "http://127.0.0.1:$port$route"; then
      STARTED_LAST=1
      log "$name started (PID $pid, port $port)."
      return 0
    fi
    sleep 1
  done
  warn "$name failed to become ready on port $port. Last log lines:"
  tail -n 30 "$logfile" >&2 || true
  terminate_pid "$pid"
  rm -f -- "$file" "$port_file"
  return 1
}

start_api_daemon() {
  start_daemon "API" "$API_PID_FILE" "$API_PORT_FILE" "$API_PORT" "$API_LOG" "$ROOT/backend" "/api/health" \
    "$VENV_PY" -m uvicorn app.main:app --host 0.0.0.0 --port "$API_PORT" --reload --reload-dir "$ROOT/backend/app"
}

start_web_daemon() {
  start_daemon "WEB" "$WEB_PID_FILE" "$WEB_PORT_FILE" "$WEB_PORT" "$WEB_LOG" "$ROOT/frontend" "/" \
    "$ROOT/frontend/node_modules/.bin/vite" --host 0.0.0.0 --port "$WEB_PORT" --strictPort
}

start_both() {
  local started_api started_web
  start_api_daemon || return 1
  started_api="$STARTED_LAST"
  if ! start_web_daemon; then
    if [ "$started_api" = 1 ]; then stop_one "API" "$API_PID_FILE" "$API_PORT_FILE"; fi
    return 1
  fi
  started_web="$STARTED_LAST"
  echo
  if ! show_status; then
    warn "A service stopped responding during startup. Cleaning up newly started services."
    if [ "$started_web" = 1 ]; then stop_one "web app" "$WEB_PID_FILE" "$WEB_PORT_FILE"; fi
    if [ "$started_api" = 1 ]; then stop_one "API" "$API_PID_FILE" "$API_PORT_FILE"; fi
    return 1
  fi
  log "Web: http://<server-ip>:$WEB_PORT (or localhost on this machine). Logs: ./start-arena.sh logs"
  warn "These are development servers. Protect the ports, configure a strong secret/admin password, and use HTTPS before public use."
}

wait_for_foreground() {
  local name="$1" pid="$2" port="$3" route="$4" i
  for ((i=0; i<STARTUP_TIMEOUT; i++)); do
    if ! pid_exists "$pid"; then break; fi
    if probe_http "http://127.0.0.1:$port$route"; then return 0; fi
    sleep 1
  done
  warn "$name did not become ready on port $port. Check the output above."
  return 1
}

FOREGROUND_API_PID=""
FOREGROUND_WEB_PID=""

# Invoked by the foreground EXIT trap.
# shellcheck disable=SC2329
cleanup_foreground() {
  trap - EXIT INT TERM HUP
  [ -z "$FOREGROUND_WEB_PID" ] || kill -TERM "$FOREGROUND_WEB_PID" 2>/dev/null || true
  [ -z "$FOREGROUND_API_PID" ] || kill -TERM "$FOREGROUND_API_PID" 2>/dev/null || true
  [ -z "$FOREGROUND_WEB_PID" ] || wait "$FOREGROUND_WEB_PID" 2>/dev/null || true
  [ -z "$FOREGROUND_API_PID" ] || wait "$FOREGROUND_API_PID" 2>/dev/null || true
}

start_foreground() {
  local status=0
  trap cleanup_foreground EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap 'exit 129' HUP
  port_available "API" "$API_PORT" || return 1
  port_available "WEB" "$WEB_PORT" || return 1
  (cd "$ROOT/backend" && exec "$VENV_PY" -m uvicorn app.main:app --host 0.0.0.0 --port "$API_PORT" --reload --reload-dir "$ROOT/backend/app" 9>&-) &
  FOREGROUND_API_PID=$!
  wait_for_foreground "API" "$FOREGROUND_API_PID" "$API_PORT" "/api/health" || return 1
  (cd "$ROOT/frontend" && exec "$ROOT/frontend/node_modules/.bin/vite" --host 0.0.0.0 --port "$WEB_PORT" --strictPort 9>&-) &
  FOREGROUND_WEB_PID=$!
  wait_for_foreground "Web" "$FOREGROUND_WEB_PID" "$WEB_PORT" "/" || return 1
  log "API → http://localhost:$API_PORT | Web → http://localhost:$WEB_PORT"
  warn "These are development servers. Protect the ports, configure a strong secret/admin password, and use HTTPS before public use."
  set +e
  wait -n "$FOREGROUND_API_PID" "$FOREGROUND_WEB_PID"
  status=$?
  set -e
  warn "A service exited; stopping the other one."
  [ "$status" -ne 0 ] || status=1
  return "$status"
}

main() {
  local target="${1:-start}"
  if [ "$#" -gt 1 ]; then usage; return 2; fi
  case "$target" in
    start|all|restart|update|api|web|foreground|share)
      validate_settings || return 1
      if [[ "$target" != api && "$target" != web && "$API_PORT" = "$WEB_PORT" ]]; then
        warn "API_PORT and WEB_PORT must be different."
        return 1
      fi
      acquire_lock || return 1
      if [[ "$target" != foreground ]]; then require_daemon_tools || return 1; fi
      if [[ "$target" = update ]]; then
        log "Pulling latest code…"
        if ! git -C "$ROOT" pull --rebase; then warn "Update failed; running services were left alone."; return 1; fi
      fi
      # Set the Vite proxy to the actual API port unless explicitly overridden.
      export VITE_API_TARGET="${VITE_API_TARGET:-http://127.0.0.1:$API_PORT}"
      if [[ "$target" != web ]]; then ensure_python || return 1; fi
      if [[ "$target" != api ]]; then ensure_node || return 1; fi
      if [[ "$target" != web ]]; then setup_backend || return 1; fi
      if [[ "$target" != api ]]; then setup_frontend || return 1; fi
      case "$target" in
        api) start_api_daemon ;;
        web) start_web_daemon ;;
        foreground) start_foreground ;;
        *)
          if [[ "$target" = restart || "$target" = update ]]; then stop_all; fi
          start_both || return 1
          if [[ "$target" = share ]]; then
            # The long-lived tunnel must not block later stop/restart commands.
            exec 9>&-
            log "Opening a public HTTPS tunnel (Ctrl+C closes only the tunnel)…"
            if command -v cloudflared >/dev/null 2>&1; then
              cloudflared tunnel --no-autoupdate --url "http://localhost:$WEB_PORT"
            elif command -v npx >/dev/null 2>&1; then
              npx --yes cloudflared tunnel --no-autoupdate --url "http://localhost:$WEB_PORT"
            else
              warn "cloudflared or npx is required for share mode. The API and web app remain running."
              return 1
            fi
          fi
          ;;
      esac
      ;;
    stop) acquire_lock || return 1; stop_all ;;
    status) show_status ;;
    logs)
      mkdir -p "$RUN_DIR"
      touch "$API_LOG" "$WEB_LOG"
      log "Following logs — Ctrl+C stops viewing only; the servers keep running."
      tail -n 80 -F "$API_LOG" "$WEB_LOG"
      ;;
    -h|--help|help) usage ;;
    *) usage; return 2 ;;
  esac
}

# This guard also lets the launcher helpers be tested without starting servers.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
