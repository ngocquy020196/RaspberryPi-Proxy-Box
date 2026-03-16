#!/bin/bash
# ============================================
# DCOM Proxy Box — ONE-COMMAND INSTALLER
# Just run: sudo bash setup.sh
# Auto install + configure + start everything
# ============================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }
info() { echo -e "${CYAN}[i]${NC} $1"; }

# Must run as root
if [ "$EUID" -ne 0 ]; then
  err "Please run as root: sudo bash setup.sh"
fi

# ---- Online mode: if run via curl | bash, clone repo first ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)"
if [ ! -f "${SCRIPT_DIR}/package.json" ] 2>/dev/null; then
  echo -e "${CYAN}[i]${NC} Running in online mode — cloning repo..."
  INSTALL_DIR="/opt/dcom-proxy"
  apt-get update -y -qq && apt-get install -y -qq git > /dev/null 2>&1
  if [ -d "$INSTALL_DIR/.git" ]; then
    cd "$INSTALL_DIR" && git pull --quiet
    echo -e "${GREEN}[✓]${NC} Updated repo at $INSTALL_DIR"
  else
    rm -rf "$INSTALL_DIR"
    git clone --quiet https://github.com/ngocquy020196/RaspberryPi-Proxy-Box.git "$INSTALL_DIR"
    echo -e "${GREEN}[✓]${NC} Cloned repo to $INSTALL_DIR"
  fi
  cd "$INSTALL_DIR"
  exec bash "$INSTALL_DIR/setup.sh"
  exit 0
fi

INSTALL_DIR="$SCRIPT_DIR"
PI_IP=$(hostname -I | awk '{print $1}')

clear
echo -e "${CYAN}"
echo "  ╔══════════════════════════════════════╗"
echo "  ║    DCOM PROXY BOX — AUTO INSTALLER   ║"
echo "  ║    Raspberry Pi 4G Proxy System      ║"
echo "  ╚══════════════════════════════════════╝"
echo -e "${NC}"
echo ""

TOTAL_STEPS=9
CURRENT=0

progress() {
  CURRENT=$((CURRENT + 1))
  echo ""
  echo -e "${BOLD}━━━ Step ${CURRENT}/${TOTAL_STEPS}: $1 ━━━${NC}"
}

# ========================================
# STEP 1: Update system
# ========================================
progress "Updating system"
apt-get update -y -qq
apt-get upgrade -y -qq
log "System updated"

# ========================================
# STEP 2: Install essential tools
# ========================================
progress "Installing essential tools"
apt-get install -y -qq \
  curl wget git build-essential \
  net-tools iproute2 usbutils \
  usb-modeswitch usb-modeswitch-data \
  sg3-utils ppp wvdial minicom \
  iptables > /dev/null 2>&1
log "Essential tools installed"

# ========================================
# STEP 3: Install Node.js 18 LTS
# ========================================
progress "Installing Node.js 18"
if command -v node &> /dev/null; then
  warn "Node.js already installed: $(node -v)"
else
  curl -fsSL https://deb.nodesource.com/setup_18.x | bash - > /dev/null 2>&1
  apt-get install -y -qq nodejs > /dev/null 2>&1
  log "Node.js $(node -v) installed"
fi

# ========================================
# STEP 4: Build & install 3proxy
# ========================================
progress "Installing 3proxy"
if command -v 3proxy &> /dev/null; then
  warn "3proxy already installed at $(which 3proxy)"
else
  # Try apt install first
  apt-get install -y -qq 3proxy > /dev/null 2>&1
  if ! command -v 3proxy &> /dev/null; then
    # Build from source as fallback
    cd /tmp
    rm -rf 3proxy-src
    git clone --quiet https://github.com/3proxy/3proxy.git 3proxy-src
    cd 3proxy-src
    make -f Makefile.Linux -j$(nproc) > /dev/null 2>&1
    sudo cp bin/3proxy /usr/bin/3proxy
    cd "$INSTALL_DIR"
    rm -rf /tmp/3proxy-src
  fi
  log "3proxy installed at $(which 3proxy)"
fi

# Create 3proxy directories
mkdir -p /etc/3proxy
mkdir -p /var/log/3proxy

# ========================================
# STEP 5: Install cloudflared
# ========================================
progress "Installing cloudflared"
if command -v cloudflared &> /dev/null; then
  warn "cloudflared already installed"
else
  ARCH=$(dpkg --print-architecture)
  if [ "$ARCH" = "armhf" ] || [ "$ARCH" = "arm64" ] || [ "$ARCH" = "amd64" ]; then
    curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb" -o /tmp/cloudflared.deb
    dpkg -i /tmp/cloudflared.deb > /dev/null 2>&1
    rm -f /tmp/cloudflared.deb
    log "cloudflared installed"
  else
    warn "Unsupported architecture ($ARCH) — install cloudflared manually"
  fi
fi

# ========================================
# STEP 6: Setup application
# ========================================
progress "Configuring application"
cd "$INSTALL_DIR"

# Auto-generate .env if not exists
if [ ! -f .env ]; then
  SESSION_SECRET=$(openssl rand -hex 32)
  SECRET_KEY=$(openssl rand -hex 8)
  
  cat > .env << EOF
# ===== DCOM Proxy Box Configuration =====

# Secret key to login to the dashboard
SECRET_KEY=${SECRET_KEY}

# Web dashboard port
PORT=8080

# Session secret
SESSION_SECRET=${SESSION_SECRET}

# Proxy port range start
PROXY_START_PORT=10000

# 3proxy config file path
PROXY_CONFIG_PATH=/etc/3proxy/3proxy.cfg

# 3proxy log directory
PROXY_LOG_DIR=/var/log/3proxy

# IP rotation method: hilink | interface | at_command
IP_ROTATE_METHOD=hilink

# Default proxy auth
DEFAULT_PROXY_USER=proxyuser
DEFAULT_PROXY_PASS=proxypass
EOF
  log ".env file generated"
  info "Random SECRET_KEY: ${SECRET_KEY}"
else
  warn ".env already exists — keeping current config"
  SECRET_KEY=$(grep SECRET_KEY .env | head -1 | cut -d'=' -f2)
fi

# Install npm dependencies
npm install --production --silent 2>/dev/null
log "Dependencies installed"

# ========================================
# STEP 7: USB Modeswitch rules
# ========================================
progress "Configuring USB Modeswitch for K5160"

mkdir -p /etc/usb_modeswitch.d

cat > /etc/usb_modeswitch.d/12d1:14fe << 'EOF'
# Vodafone K5160 / Huawei E3372 — auto switch CD-ROM → Modem
TargetVendor=0x12d1
TargetProduct=0x1506
MessageContent="55534243123456780000000000000a11062000000000000100000000000000"
EOF

# Udev rule to auto-trigger modeswitch
cat > /etc/udev/rules.d/99-dcom-proxy.rules << 'EOF'
# Auto modeswitch Huawei modems when plugged in
ACTION=="add", SUBSYSTEM=="usb", ATTRS{idVendor}=="12d1", ATTRS{idProduct}=="14fe", RUN+="/usr/sbin/usb_modeswitch -v 0x12d1 -p 0x14fe -M 55534243123456780000000000000a11062000000000000100000000000000"
EOF

udevadm control --reload-rules 2>/dev/null || true
log "USB modeswitch + udev rules configured"

# ========================================
# STEP 8: Install & start systemd services
# ========================================
progress "Installing and starting services"

# dcom-proxy service
cat > /etc/systemd/system/dcom-proxy.service << EOF
[Unit]
Description=DCOM Proxy Box — Web Dashboard
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

# 3proxy service
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

# Reload, enable, and START everything
systemctl daemon-reload
systemctl enable dcom-proxy.service > /dev/null 2>&1
systemctl enable 3proxy.service > /dev/null 2>&1
systemctl restart dcom-proxy.service
log "All services started"


# ========================================
# STEP 10: Cloudflare Tunnel (Interactive)
# ========================================
progress "Cloudflare Tunnel Setup"

echo ""
echo -e "${CYAN}Cloudflare Tunnel allows you to access the Dashboard remotely via your domain.${NC}"
echo -e "${YELLOW}Requires: A Cloudflare account and a domain pointed to Cloudflare.${NC}"
echo ""
read -p "Would you like to configure Cloudflare Tunnel now? (y/N): " CF_CHOICE

if [ "$CF_CHOICE" = "y" ] || [ "$CF_CHOICE" = "Y" ]; then
  # Step 9a: Login
  echo ""
  info "Step 1/4: Login to Cloudflare"
  info "A browser link will open — log in and select your domain."
  info "If using SSH without a browser, copy the link and open it on another device."
  echo ""
  cloudflared tunnel login
  
  if [ $? -eq 0 ]; then
    log "Login successful"
    
    # Step 9b: Create tunnel
    info "Step 2/4: Creating tunnel"
    TUNNEL_NAME="dcom-proxy"
    cloudflared tunnel create $TUNNEL_NAME 2>/dev/null || warn "Tunnel '$TUNNEL_NAME' may already exist"
    
    # Get tunnel ID
    TUNNEL_ID=$(cloudflared tunnel list 2>/dev/null | grep $TUNNEL_NAME | awk '{print $1}' | head -1)
    
    if [ -n "$TUNNEL_ID" ]; then
      log "Tunnel ID: $TUNNEL_ID"
      
      # Step 9c: Get domain from user
      echo ""
      info "Step 3/4: Configure domain"
      read -p "Enter subdomain (e.g., proxy.yourdomain.com): " CF_DOMAIN
      
      if [ -n "$CF_DOMAIN" ]; then
        # Route DNS
        cloudflared tunnel route dns $TUNNEL_NAME $CF_DOMAIN 2>/dev/null || warn "DNS route may already exist"
        log "Routed $CF_DOMAIN → tunnel"
        
        # Step 9d: Generate config.yml
        info "Step 4/4: Generating config and installing service"
        CRED_FILE=$(ls /root/.cloudflared/*.json 2>/dev/null | head -1)
        
        mkdir -p /root/.cloudflared
        cat > /root/.cloudflared/config.yml << CFEOF
tunnel: ${TUNNEL_ID}
credentials-file: ${CRED_FILE:-/root/.cloudflared/${TUNNEL_ID}.json}

ingress:
  - hostname: ${CF_DOMAIN}
    service: http://localhost:8080
  - service: http_status:404
CFEOF
        log "Config created at /root/.cloudflared/config.yml"
        
        # Install as service
        cloudflared service install 2>/dev/null || true
        systemctl enable cloudflared 2>/dev/null || true
        systemctl restart cloudflared 2>/dev/null || true
        log "Cloudflare Tunnel started"
        
        CF_URL="https://${CF_DOMAIN}"
      else
        warn "Skipped — no domain entered"
      fi
    else
      warn "Tunnel ID not found — configure manually later"
    fi
  else
    warn "Login failed — configure Cloudflare later: see docs/SETUP_GUIDE.md"
  fi
else
  info "Skipped Cloudflare Tunnel — configure later: see docs/SETUP_GUIDE.md"
fi

# ========================================
# DONE!
# ========================================
echo ""
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                                                  ║${NC}"
echo -e "${GREEN}║   ${BOLD}✅ INSTALLATION COMPLETE!${NC}${GREEN}                      ║${NC}"
echo -e "${GREEN}║                                                  ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}                                                  ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  📡 Dashboard (LAN):  ${CYAN}http://${PI_IP}:8080${NC}"
if [ -n "$CF_URL" ]; then
echo -e "${GREEN}║${NC}  🌍 Dashboard (WAN):  ${CYAN}${CF_URL}${NC}"
fi
echo -e "${GREEN}║${NC}  🔑 Password:  ${YELLOW}${SECRET_KEY}${NC}"
echo -e "${GREEN}║${NC}                                                  ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  📂 Directory: ${INSTALL_DIR}${NC}"
echo -e "${GREEN}║${NC}  📄 Logs:      ${CYAN}sudo journalctl -u dcom-proxy -f${NC}"
echo -e "${GREEN}║${NC}                                                  ${GREEN}║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}  ${BOLD}Next steps:${NC}                                       ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  1. Plug USB Dcom into the hub                    ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  2. Open dashboard in your browser                ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  3. Login with the password above                 ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}                                                  ${GREEN}║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
