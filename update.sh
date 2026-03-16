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
echo -e "${CYAN}━━━ DCOM Proxy Box — Updating... ━━━${NC}"
echo ""

# 1. Pull latest code
info "Pulling latest code..."
git fetch --all --quiet
git reset --hard origin/main --quiet
log "Code updated"

# 2. Install system dependencies (in case new ones were added)
info "Checking system packages..."
apt-get install -y -qq wvdial ppp usb-modeswitch usbutils > /dev/null 2>&1
log "System packages OK"

# 3. Install npm dependencies
info "Checking npm dependencies..."
npm install --production --silent 2>/dev/null
log "npm dependencies OK"

# 4. Restart services
info "Restarting services..."
systemctl daemon-reload
systemctl restart dcom-proxy
log "dcom-proxy restarted"

if systemctl is-active --quiet 3proxy; then
  systemctl restart 3proxy
  log "3proxy restarted"
fi

PI_IP=$(hostname -I | awk '{print $1}')
echo ""
echo -e "${GREEN}✅ Update complete!${NC}"
echo -e "   📡 Dashboard: ${CYAN}http://${PI_IP}:8080${NC}"
echo -e "   📄 Logs: ${CYAN}sudo journalctl -u dcom-proxy -f${NC}"
echo ""
