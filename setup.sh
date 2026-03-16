#!/bin/bash
# ============================================
# DCOM Proxy Box — ONE-COMMAND INSTALLER
# Chỉ cần 1 lệnh: sudo bash setup.sh
# Tự động cài đặt + cấu hình + khởi động
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
  err "Chạy bằng root: sudo bash setup.sh"
fi

# ---- Online mode: nếu chạy từ curl | bash thì tự clone repo ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)"
if [ ! -f "${SCRIPT_DIR}/package.json" ] 2>/dev/null; then
  echo -e "${CYAN}[i]${NC} Đang chạy online mode — clone repo..."
  INSTALL_DIR="/opt/dcom-proxy"
  apt-get update -y -qq && apt-get install -y -qq git > /dev/null 2>&1
  if [ -d "$INSTALL_DIR/.git" ]; then
    cd "$INSTALL_DIR" && git pull --quiet
    echo -e "${GREEN}[✓]${NC} Đã cập nhật repo tại $INSTALL_DIR"
  else
    rm -rf "$INSTALL_DIR"
    git clone --quiet https://github.com/ngocquy020196/RaspberryPi-Proxy-Box.git "$INSTALL_DIR"
    echo -e "${GREEN}[✓]${NC} Đã clone repo vào $INSTALL_DIR"
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

TOTAL_STEPS=8
CURRENT=0

progress() {
  CURRENT=$((CURRENT + 1))
  echo ""
  echo -e "${BOLD}━━━ Step ${CURRENT}/${TOTAL_STEPS}: $1 ━━━${NC}"
}

# ========================================
# STEP 1: Update system
# ========================================
progress "Cập nhật hệ thống"
apt-get update -y -qq
apt-get upgrade -y -qq
log "Hệ thống đã cập nhật"

# ========================================
# STEP 2: Install essential tools
# ========================================
progress "Cài đặt công cụ cần thiết"
apt-get install -y -qq \
  curl wget git build-essential \
  net-tools iproute2 usbutils \
  usb-modeswitch usb-modeswitch-data \
  sg3-utils ppp minicom \
  iptables > /dev/null 2>&1
log "Công cụ đã cài đặt"

# ========================================
# STEP 3: Install Node.js 18 LTS
# ========================================
progress "Cài đặt Node.js 18"
if command -v node &> /dev/null; then
  warn "Node.js đã có: $(node -v)"
else
  curl -fsSL https://deb.nodesource.com/setup_18.x | bash - > /dev/null 2>&1
  apt-get install -y -qq nodejs > /dev/null 2>&1
  log "Node.js $(node -v) đã cài đặt"
fi

# ========================================
# STEP 4: Build & install 3proxy
# ========================================
progress "Cài đặt 3proxy"
if command -v 3proxy &> /dev/null || [ -f /usr/local/bin/3proxy ]; then
  warn "3proxy đã có"
else
  cd /tmp
  rm -rf 3proxy-src
  git clone --quiet https://github.com/3proxy/3proxy.git 3proxy-src
  cd 3proxy-src
  ln -sf Makefile.Linux Makefile
  make -f Makefile.Linux -j$(nproc) > /dev/null 2>&1
  make -f Makefile.Linux install > /dev/null 2>&1
  cd "$INSTALL_DIR"
  rm -rf /tmp/3proxy-src
  log "3proxy đã build và cài đặt"
fi

# Create 3proxy directories
mkdir -p /etc/3proxy
mkdir -p /var/log/3proxy

# ========================================
# STEP 5: Install cloudflared
# ========================================
progress "Cài đặt cloudflared"
if command -v cloudflared &> /dev/null; then
  warn "cloudflared đã có"
else
  ARCH=$(dpkg --print-architecture)
  if [ "$ARCH" = "armhf" ] || [ "$ARCH" = "arm64" ] || [ "$ARCH" = "amd64" ]; then
    curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb" -o /tmp/cloudflared.deb
    dpkg -i /tmp/cloudflared.deb > /dev/null 2>&1
    rm -f /tmp/cloudflared.deb
    log "cloudflared đã cài đặt"
  else
    warn "Kiến trúc không hỗ trợ ($ARCH) — cài cloudflared thủ công"
  fi
fi

# ========================================
# STEP 6: Setup ứng dụng
# ========================================
progress "Cấu hình ứng dụng"
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
  log "File .env đã tạo tự động"
  info "SECRET_KEY được tạo ngẫu nhiên: ${SECRET_KEY}"
else
  warn "File .env đã tồn tại — giữ nguyên"
  SECRET_KEY=$(grep SECRET_KEY .env | head -1 | cut -d'=' -f2)
fi

# Install npm dependencies
npm install --production --silent 2>/dev/null
log "Dependencies đã cài đặt"

# ========================================
# STEP 7: USB Modeswitch rules
# ========================================
progress "Cấu hình USB Modeswitch cho K5160"

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
log "USB modeswitch + udev rules đã cấu hình"

# ========================================
# STEP 8: Install & start systemd services
# ========================================
progress "Cài đặt và khởi động services"

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
cat > /etc/systemd/system/3proxy.service << 'EOF'
[Unit]
Description=3proxy — Lightweight Proxy Server
After=network.target

[Service]
Type=forking
PIDFile=/var/run/3proxy.pid
ExecStart=/usr/local/bin/3proxy /etc/3proxy/3proxy.cfg
ExecReload=/bin/kill -HUP $MAINPID
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
log "Tất cả services đã khởi động"

# ========================================
# DONE!
# ========================================
echo ""
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                                                  ║${NC}"
echo -e "${GREEN}║   ${BOLD}✅ CÀI ĐẶT HOÀN TẤT!${NC}${GREEN}                         ║${NC}"
echo -e "${GREEN}║                                                  ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}                                                  ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  📡 Dashboard: ${CYAN}http://${PI_IP}:8080${NC}          ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  🔑 Mật khẩu:  ${YELLOW}${SECRET_KEY}${NC}              ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}                                                  ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  📂 Thư mục:   ${INSTALL_DIR}${NC}"
echo -e "${GREEN}║${NC}  📄 Logs:      ${CYAN}sudo journalctl -u dcom-proxy -f${NC}"
echo -e "${GREEN}║${NC}                                                  ${GREEN}║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}  ${BOLD}Tiếp theo:${NC}                                       ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  1. Cắm USB Dcom vào hub                         ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  2. Mở dashboard bằng trình duyệt                ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  3. Đăng nhập bằng mật khẩu ở trên              ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}                                                  ${GREEN}║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
