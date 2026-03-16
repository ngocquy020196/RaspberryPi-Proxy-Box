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

INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo -e "${CYAN}━━━ DCOM Proxy Box — Updating... ━━━${NC}"
echo ""

# Pull latest code
info "Pulling latest code from GitHub..."
cd "$INSTALL_DIR"
git fetch --all --quiet
git reset --hard origin/main --quiet
log "Code updated"

# Install any new dependencies
info "Checking dependencies..."
npm install --production --silent 2>/dev/null
log "Dependencies OK"

# Restart services
info "Restarting services..."
sudo systemctl restart dcom-proxy
log "dcom-proxy restarted"

# Restart 3proxy only if running
if systemctl is-active --quiet 3proxy; then
  sudo systemctl restart 3proxy
  log "3proxy restarted"
fi

echo ""
echo -e "${GREEN}✅ Update complete!${NC}"
echo -e "   📡 Dashboard: ${CYAN}http://$(hostname -I | awk '{print $1}'):8080${NC}"
echo -e "   📄 Logs: ${CYAN}sudo journalctl -u dcom-proxy -f${NC}"
echo ""
