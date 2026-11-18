#!/usr/bin/env bash
# 9 CLOVER Competitive Operations — one-shot production setup for a fresh Ubuntu server.
#
#   curl -fsSL https://raw.githubusercontent.com/freemancatalogue979-web/cbtxsts/main/deploy/setup-server.sh | bash
#
# Re-running it is safe: it pulls the latest code, rebuilds and restarts.
# Result: nginx on port 80 serves the built app and proxies /api, /live, /ws
# to uvicorn (systemd service "clover", 127.0.0.1:9000). Data lives in
# $APP_DIR/backend/data and is never touched by updates.
set -euo pipefail

REPO="${REPO:-https://github.com/freemancatalogue979-web/cbtxsts.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/clover}"
DOMAIN="${DOMAIN:-_}"            # set DOMAIN=example.com to get HTTPS via certbot
RUN_USER="$(id -un)"

log() { printf '\n\033[38;5;141m▸ %s\033[0m\n' "$*"; }

log "Installing system packages"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git curl nginx python3 python3-venv python3-pip ufw >/dev/null

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  log "Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null
  sudo apt-get install -y -qq nodejs >/dev/null
fi

log "Fetching code ($BRANCH)"
sudo mkdir -p "$APP_DIR" && sudo chown "$RUN_USER":"$RUN_USER" "$APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch -q origin "$BRANCH"
  git -C "$APP_DIR" checkout -q -B "$BRANCH" FETCH_HEAD
else
  git clone -q --branch "$BRANCH" "$REPO" "$APP_DIR"
fi

log "Backend dependencies"
cd "$APP_DIR/backend"
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt
.venv/bin/pip install -q greenlet
mkdir -p data
NEW_ADMIN_PASSWORD=""
if [ ! -f .env ]; then
  log "Creating backend/.env (secret key generated; add AI keys here later)"
  # A brand-new database gets a random admin password instead of the public default.
  if [ ! -f data/clover.db ]; then NEW_ADMIN_PASSWORD="$(python3 -c 'import secrets;print(secrets.token_urlsafe(12))')"; fi
  {
    echo "CLOVER_SECRET_KEY=$(python3 -c 'import secrets;print(secrets.token_urlsafe(48))')"
    echo "CLOVER_HOST=127.0.0.1"
    echo "CLOVER_PORT=9000"
    if [ -n "$NEW_ADMIN_PASSWORD" ]; then echo "CLOVER_ADMIN_PASSWORD=$NEW_ADMIN_PASSWORD"; fi
    echo "# CLOVER_AI_API_KEY="
  } > .env
  chmod 600 .env
fi
# Older versions of this script wrote CBT_* names, which the app never reads, so the
# server signed logins with the public default secret. Give it a real one (everyone
# signs in again once).
if ! grep -q '^CLOVER_SECRET_KEY=.' .env; then
  log "Adding CLOVER_SECRET_KEY to backend/.env (the old CBT_* names were ignored)"
  OLD_KEY="$(sed -n 's/^CBT_SECRET_KEY=//p' .env | head -n1)"
  printf '\nCLOVER_SECRET_KEY=%s\n' "${OLD_KEY:-$(python3 -c 'import secrets;print(secrets.token_urlsafe(48))')}" >> .env
  chmod 600 .env
fi

log "Building frontend"
cd "$APP_DIR/frontend"
npm ci --no-audit --no-fund --loglevel=error
npx vite build

log "systemd service"
sudo tee /etc/systemd/system/clover.service >/dev/null <<EOF
[Unit]
Description=9 CLOVER Competitive Operations API
After=network.target

[Service]
User=$RUN_USER
WorkingDirectory=$APP_DIR/backend
EnvironmentFile=$APP_DIR/backend/.env
ExecStart=$APP_DIR/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 9000 --workers 1 --proxy-headers
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable -q clover
sudo systemctl restart clover

log "nginx"
sudo tee /etc/nginx/sites-available/clover >/dev/null <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name $DOMAIN;

    root $APP_DIR/frontend/dist;
    index index.html;
    client_max_body_size 60m;

    location ~ ^/(api|live)/ {
        proxy_pass http://127.0.0.1:9000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffering off;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
    location /ws/ {
        proxy_pass http://127.0.0.1:9000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 3600s;
    }
    # Installable app: the worker, manifest and shell must always revalidate so a
    # deploy reaches installed apps; hashed /assets/ files never change.
    location = /sw.js { add_header Cache-Control "no-cache"; add_header Service-Worker-Allowed "/"; try_files \$uri =404; }
    location = /manifest.webmanifest { default_type application/manifest+json; add_header Cache-Control "no-cache"; try_files \$uri =404; }
    location = /index.html { add_header Cache-Control "no-cache"; try_files \$uri =404; }
    location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; try_files \$uri =404; }
    location / { try_files \$uri \$uri/ /index.html; }
}
EOF
sudo ln -sf /etc/nginx/sites-available/clover /etc/nginx/sites-enabled/clover
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t -q && sudo systemctl reload nginx

log "Firewall (SSH + HTTP/HTTPS)"
sudo ufw allow OpenSSH >/dev/null; sudo ufw allow 'Nginx Full' >/dev/null
sudo ufw --force enable >/dev/null

if [ "$DOMAIN" != "_" ]; then
  log "HTTPS for $DOMAIN"
  sudo apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
  sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect || true
fi

log "Waiting for the API"
for _ in $(seq 1 60); do curl -fs http://127.0.0.1/api/health >/dev/null 2>&1 && break; curl -fs http://127.0.0.1:9000/ >/dev/null 2>&1 && break; sleep 2; done
IP="$(curl -s -m5 ifconfig.me || hostname -I | awk '{print $1}')"
printf '\n\033[1;32m✔ 9 CLOVER Competitive Operations is live at http://%s\033[0m\n' "${DOMAIN/#_/$IP}"
echo "  Logs:    sudo journalctl -u clover -f"
echo "  Update:  re-run this script"
echo "  Config:  $APP_DIR/backend/.env  (then: sudo systemctl restart clover)"
if [ -n "$NEW_ADMIN_PASSWORD" ]; then
  printf '\n\033[1;33m  First login: admin / %s\033[0m  (also in backend/.env; change it in the app)\n' "$NEW_ADMIN_PASSWORD"
fi
