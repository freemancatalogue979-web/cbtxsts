#!/usr/bin/env bash
# Absolute Genesis — start the API (port 3000) and the web app (port 5173) together.
#
#   ./start-arena.sh            # both servers
#   ./start-arena.sh api        # backend only
#   ./start-arena.sh web        # frontend only
#   ./start-arena.sh share      # both + a public https link (install on phones)
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

# AI key for "Make it easy to read" (Gemini or DeepSeek). Asked once, saved to
# backend/.env (git-ignored, so it never reaches GitHub). A key already in the
# environment (e.g. set by your host) is used as is. DeepSeek keys start "sk-".
ensure_gemini_key() {
  local env_file="$ROOT/backend/.env"
  if [ -n "${GEMINI_API_KEY:-}${DEEPSEEK_API_KEY:-}" ]; then return; fi
  if [ -f "$env_file" ] && grep -Eq '^(GEMINI|DEEPSEEK)_API_KEY=.+' "$env_file"; then return; fi
  if [ ! -t 0 ]; then
    log "No AI key yet — the AI rewrite stays off (add GEMINI_API_KEY=... or DEEPSEEK_API_KEY=... to backend/.env)."
    return
  fi
  log "Paste your Gemini or DeepSeek API key for the AI rewrite (typing is hidden; press Enter to skip):"
  local key=""
  read -rs key || true
  echo
  if [ -z "$key" ]; then
    log "Skipped — you can add GEMINI_API_KEY=... or DEEPSEEK_API_KEY=... to backend/.env later."
    return
  fi
  ( umask 077; touch "$env_file" )
  local name="GEMINI_API_KEY"
  case "$key" in sk-*) name="DEEPSEEK_API_KEY" ;; esac
  grep -v "^$name=" "$env_file" > "$env_file.tmp" 2>/dev/null || true
  printf '%s=%s\n' "$name" "$key" >> "$env_file.tmp"
  mv "$env_file.tmp" "$env_file"
  chmod 600 "$env_file"
  log "Saved as $name in backend/.env (kept out of git)."
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
  log "Install → open http://localhost:$WEB_PORT in Chrome/Edge and click \"Install app\" (phones need an https link, see README)"
  exec npx vite --host 0.0.0.0 --port "$WEB_PORT"
}

case "$TARGET" in
  api) setup_backend; ensure_gemini_key; start_api ;;
  web) setup_frontend; start_web ;;
  all)
    setup_backend
    ensure_gemini_key
    setup_frontend
    # Start the API in the background, then hand the foreground to Vite.
    ( cd "$ROOT/backend" && ./.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port "$API_PORT" --reload --reload-dir app ) &
    API_PID=$!
    trap 'kill $API_PID 2>/dev/null || true' EXIT INT TERM
    log "API  → http://localhost:$API_PORT  (docs at /docs)"
    sleep 2
    start_web
    ;;
  share)
    # Phones can only install from a public https:// address; a Wi-Fi
    # http://192.168.x.x link only ever makes a shortcut. A Cloudflare quick
    # tunnel gives a free https://....trycloudflare.com link (no account).
    setup_backend
    ensure_gemini_key
    setup_frontend
    ( cd "$ROOT/backend" && ./.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port "$API_PORT" --reload --reload-dir app ) &
    API_PID=$!
    ( cd "$ROOT/frontend" && npx vite --host 0.0.0.0 --port "$WEB_PORT" ) &
    WEB_PID=$!
    trap 'kill $API_PID $WEB_PID 2>/dev/null || true' EXIT INT TERM
    sleep 3
    log "Opening a public https link… open the https://….trycloudflare.com address it prints on your phone, then tap Install app."
    if command -v cloudflared >/dev/null 2>&1; then
      cloudflared tunnel --no-autoupdate --url "http://localhost:$WEB_PORT"
    else
      npx --yes cloudflared tunnel --no-autoupdate --url "http://localhost:$WEB_PORT"
    fi
    ;;
  *)
    echo "usage: ./start-arena.sh [all|api|web|share]" >&2
    exit 2
    ;;
esac
