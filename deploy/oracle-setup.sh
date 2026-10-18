#!/usr/bin/env bash
# One-shot setup for running Our Little Space on an Oracle Always Free VM.
#
#   ssh ubuntu@YOUR_VM_IP
#   bash oracle-setup.sh
#
# Everything (database, photos, voice notes) lives on the VM's boot disk, so it
# survives redeploys, restarts and sleeps — unlike a free PaaS.
set -euo pipefail

APP_DIR="/opt/our-little-space"
REPO="https://github.com/rinmico2-ui/Diary.git"
UNIT="our-little-space"

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

log "System packages"
sudo apt-get update -y
sudo apt-get install -y git curl nginx ca-certificates

log "Node.js 24 (the app uses node:sqlite, which is built in from Node 22.5)"
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v

log "App code"
sudo mkdir -p "$APP_DIR"
sudo chown "$(id -u):$(id -g)" "$APP_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  GIT_TERMINAL_PROMPT=0 git clone "$REPO" "$APP_DIR" || {
    echo "Clone failed. If the repository is private, either make it public or run:"
    echo "  git clone https://<TOKEN>@github.com/rinmico2-ui/Diary.git $APP_DIR"
    exit 1
  }
fi
cd "$APP_DIR"

log "Install and build"
npm ci
npm run build

log "Configuration"
PUBLIC_IP="$(curl -fsSL --max-time 5 https://ifconfig.me 2>/dev/null || true)"
[ -n "$PUBLIC_IP" ] || PUBLIC_IP="<your-server-ip>"

if [ ! -f server/.env ]; then
  SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")"
  INVITE="$(node -e "const c=require('crypto').randomBytes(6).toString('hex');console.log(c.slice(0,4)+'-'+c.slice(4,8)+'-'+c.slice(8,12))")"
  cat > server/.env <<EOF
NODE_ENV=production
PORT=4000

# Public origin of the app. Change this if you later add a domain + HTTPS,
# and flip COOKIE_SECURE to 1 at the same time.
WEB_ORIGIN=http://$PUBLIC_IP

SESSION_SECRET=$SECRET

# Second person needs this code to register.
INVITE_CODE=$INVITE

# Plain HTTP for now — Secure cookies are rejected over http://.
COOKIE_SECURE=0

# Outbound SMTP (Brevo). Fill these in, then: sudo systemctl restart $UNIT
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=0
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

LOG_ACCOUNTS=0
EOF
  echo
  echo "    INVITE_CODE: $INVITE"
fi

log "nginx (reverse proxy on port 80)"
sudo tee /etc/nginx/sites-available/default > /dev/null <<'NGINX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 64m;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}
NGINX
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl reload nginx

log "systemd service"
sudo tee "/etc/systemd/system/$UNIT.service" > /dev/null <<EOF
[Unit]
Description=Our Little Space
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now "$UNIT"
sudo systemctl restart "$UNIT"
sleep 3

log "Smoke test"
systemctl --no-pager status "$UNIT" | head -n 10 || true
curl -s -o /dev/null -w "  GET /api/auth/me -> HTTP %{http_code}\n" http://127.0.0.1/api/auth/me || true

cat <<MSG

  App:          http://$PUBLIC_IP
  Invite code:  $(grep '^INVITE_CODE=' server/.env | cut -d= -f2)
  SMTP:         edit server/.env (SMTP_USER / SMTP_PASS / SMTP_FROM), then:
                  sudo systemctl restart $UNIT
  Update code:  cd $APP_DIR && git pull && npm ci && npm run build && sudo systemctl restart $UNIT
  Logs:         journalctl -u $UNIT -f
MSG
