#!/bin/bash
# ============================================
# DCOM Proxy Box — Auto Update
# Pull latest code from GitHub and restart
# Usage: sudo bash update.sh
# ============================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }
info() { echo -e "${CYAN}[i]${NC} $1"; }

if [ "$EUID" -ne 0 ]; then
  err "Please run as root: sudo bash update.sh"
fi

INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$INSTALL_DIR"

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}    DCOM Proxy Box — Auto Update${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# 1. Pull latest code
info "Pulling latest code..."
git fetch --all --quiet
git reset --hard origin/main --quiet
log "Code updated"

# 2. Install system dependencies
info "Checking system packages..."
apt-get install -y -qq wvdial ppp usb-modeswitch usbutils > /dev/null 2>&1
log "System packages OK"

# 3. Install npm dependencies
info "Checking npm dependencies..."
npm install --production --silent 2>/dev/null
log "npm dependencies OK"

# 4. Update systemd service files from repo
info "Updating service files..."
if [ -f "$INSTALL_DIR/systemd/dcom-proxy.service" ]; then
  cp "$INSTALL_DIR/systemd/dcom-proxy.service" /etc/systemd/system/dcom-proxy.service
fi

# Create/update 3proxy service (auto-detect binary path)
PROXY_BIN=$(which 3proxy 2>/dev/null || echo /usr/bin/3proxy)
cat > /etc/systemd/system/3proxy.service << EOF
[Unit]
Description=3proxy — Lightweight Proxy Server
After=network.target

[Service]
Type=forking
PIDFile=/run/3proxy.pid
ExecStart=${PROXY_BIN} /etc/3proxy/3proxy.cfg
ExecReload=/bin/kill -HUP \$MAINPID
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# Fix PID path in 3proxy config if exists
if [ -f /etc/3proxy/3proxy.cfg ]; then
  sed -i 's|/var/run/3proxy.pid|/run/3proxy.pid|' /etc/3proxy/3proxy.cfg
fi

# Create log dir
mkdir -p /var/log/3proxy

systemctl daemon-reload
log "Service files updated"

# 5. Enable services
systemctl enable dcom-proxy > /dev/null 2>&1
systemctl enable 3proxy > /dev/null 2>&1

# 6. Kill old processes
info "Stopping old connections..."
killall pppd 2>/dev/null || true
systemctl stop 3proxy 2>/dev/null || true
systemctl stop dcom-proxy 2>/dev/null || true
sleep 2
log "Old processes stopped"

# 7. Restart main service (auto-connects modems + applies 3proxy config)
info "Starting dcom-proxy..."
systemctl start dcom-proxy
log "dcom-proxy started"

# Wait for auto-connect
info "Waiting for modem auto-connect (10s)..."
sleep 10

# 8. Install Tailscale if not present
if ! command -v tailscale &> /dev/null; then
  info "Installing Tailscale..."
  curl -fsSL https://tailscale.com/install.sh | sh
  systemctl enable tailscaled > /dev/null 2>&1
  systemctl start tailscaled > /dev/null 2>&1
  log "Tailscale installed — run 'sudo tailscale up' to connect"
fi

# Check results
PI_IP=$(hostname -I | awk '{print $1}')
PPP_UP=$(ip -4 addr show ppp0 2>/dev/null | grep -oP 'inet \K[\d.]+')
DDNS_DOMAIN=$(grep "CF_DDNS_DOMAIN=" "$INSTALL_DIR/.env" 2>/dev/null | cut -d= -f2)

echo ""
echo -e "${GREEN}✅ Update complete!${NC}"
echo -e "   📡 Dashboard: ${CYAN}http://${PI_IP}:8080${NC}"
if [ -n "$PPP_UP" ]; then
  echo -e "   🌐 PPP0 IP:   ${CYAN}${PPP_UP}${NC}"
  PROXY_STATUS=$(sudo systemctl is-active 3proxy 2>/dev/null)
  echo -e "   🔌 3proxy:    ${CYAN}${PROXY_STATUS}${NC}"
fi
if [ -n "$DDNS_DOMAIN" ]; then
  echo -e "   🌍 DDNS:      ${CYAN}${DDNS_DOMAIN}${NC}"
fi
echo -e "   📄 Logs:      ${CYAN}sudo journalctl -u dcom-proxy -f${NC}"
echo ""
