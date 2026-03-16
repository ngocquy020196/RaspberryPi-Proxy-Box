# 🚀 DCOM Proxy Box

Turn your Raspberry Pi into a professional 4G Proxy Station using multiple USB Dcom modems.

![Node.js](https://img.shields.io/badge/Node.js-18_LTS-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![3proxy](https://img.shields.io/badge/3proxy-HTTP%2FSOCKS5-22d3ee?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)

---

## ⚡ One-Command Install

SSH into your Raspberry Pi and run:

```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/ngocquy020196/RaspberryPi-Proxy-Box/refs/heads/main/setup.sh)"
```

Or install step by step:

```bash
git clone https://github.com/ngocquy020196/RaspberryPi-Proxy-Box.git /opt/dcom-proxy
cd /opt/dcom-proxy
sudo bash setup.sh
```

✅ The setup script automatically:
1. Installs Node.js, 3proxy, cloudflared, usb-modeswitch, ppp
2. Generates a random password & starts all services
3. **Configures Cloudflare DDNS** (auto-update domain with Pi's public IP)
4. **Configures Cloudflare Tunnel** (remote dashboard access)
5. Displays dashboard URL + login credentials

---

## 📋 Features

| Feature | Description |
|---------|-------------|
| 🌐 **Multi-Proxy** | Each USB Dcom = 1 dedicated proxy (HTTP + SOCKS5) |
| 🔄 **IP Rotation** | Change 4G IP with 1 click — resets uptime |
| 🖥️ **Web Dashboard** | Clean light theme, real-time monitoring, favicon 🚀 |
| 🔒 **Security** | Secret key login, per-device proxy authentication |
| 🌍 **Remote Access** | Cloudflare Tunnel (dashboard) + DDNS + Port Forward (proxy) |
| 📡 **DDNS** | Auto-update domain with Pi's public IP every 5 minutes |
| 📋 **Quick Connect** | Copy curl commands & proxy strings with 1 click |
| 🔑 **External API** | GET endpoints with API key — list, status, rotate by Device ID |
| ⏱️ **Uptime** | Per-device uptime tracking, resets on IP rotate |
| 🆔 **Device ID** | Unique MD5 hash (8 chars) per device for API access |
| 🔌 **Plug & Play** | Plug in Dcom → auto-detect, auto-switch mode, auto-connect |
| ⚙️ **Auto-start** | All services start on boot (systemd) |

---

## 🖥️ Hardware Requirements

- **Raspberry Pi** (3B+/4/5) — running Raspberry Pi OS / Debian
- **Powered USB Hub** — required for multiple Dcoms (Pi USB ports can't supply enough power)
- **Power Supply** — 5V/3A minimum for Pi
- **USB 4G Dcom**: Vodafone K5160 / Huawei E3372 / E1550 (HiLink or Stick mode)

> ⚠️ **Important:** Always use a powered USB hub. Plugging multiple Dcoms directly into Pi causes power issues and crashes.

---

## 📡 Usage

### 1. Access Dashboard

| Method | URL |
|--------|-----|
| **Local (LAN)** | `http://<PI_IP>:8080` |
| **Remote (WAN)** | `https://proxy.yourdomain.com` (Cloudflare Tunnel) |

### 2. Connect via Proxy

```bash
# HTTP Proxy
curl -x http://proxyuser:proxypass@<DDNS_DOMAIN>:10000 https://api.ipify.org

# SOCKS5 Proxy
curl --socks5 proxyuser:proxypass@<DDNS_DOMAIN>:11000 https://api.ipify.org
```

### 3. SwitchyOmega / Browser Proxy

| Setting | Value |
|---------|-------|
| Host | `your-ddns-domain.com` |
| Port | `10000` (DCOM 1), `10001` (DCOM 2), etc. |
| Username | `proxyuser` |
| Password | `proxypass` |

### 4. Dashboard Features

- **Device ID** — unique 8-char hash per USB device
- **Public IP / Local IP** — both IPs for each Dcom
- **Uptime** — how long each device has been connected (resets on rotate)
- **Quick Connect** — curl & proxy string with individual Copy buttons
- **External API** — full API URLs with key, each with Copy button
- **Stop / Start** — control individual Dcom connections
- **IP Rotation** — rotate 4G IP with 1 click
- **Auto-refresh** — dashboard updates every 15 seconds

---

## 🌍 Remote Access Setup

### Cloudflare Tunnel (Dashboard)

Configured automatically during `setup.sh`. Provides HTTPS access to dashboard from anywhere.

### Cloudflare DDNS (Proxy Ports)

Configured automatically during `setup.sh`. All fields are **required**:
- **Cloudflare API Token** (Edit zone DNS permission)
- **Zone ID** (from Cloudflare dashboard)
- **DDNS Domain** (e.g., `ddns-proxy.yourdomain.com`)

> ⚠️ DDNS domain must be set to **DNS only** (grey cloud ☁️) in Cloudflare, NOT proxied (orange 🟠).

### Port Forwarding (Router)

Required for proxy access from outside your network:

1. Forward port range **`10000:10020`** → `<PI_LOCAL_IP>` (TCP) on your router
2. If using a secondary router, forward on both routers (main → secondary → Pi)

> **Tip:** Set a static IP for your Pi in the router's DHCP settings.

---

## 🔑 External API

Authenticated with `SECRET_KEY` (same as dashboard login password). Pass via `?key=` query param or `x-api-key` header. All endpoints use **GET**.

### Endpoints

| Endpoint | Description |
|----------|-------------|
| `/ext/api/devices?key=KEY` | List all devices with IP, status, Device ID |
| `/ext/api/device/:deviceId?key=KEY` | Get device status, proxy info by Device ID |
| `/ext/api/rotate/:deviceId?key=KEY` | Rotate IP by Device ID (resets uptime) |

### Device ID

Each device gets a unique **8-character MD5 hash** based on:
- HiLink modems → hash of MAC address
- Stick modems → hash of USB serial / IMEI / bus path

Example Device ID: `a1b2c3d4`

### Examples

```bash
# List all devices
curl "https://proxy.yourdomain.com/ext/api/devices?key=YOUR_KEY"

# Get device by ID
curl "https://proxy.yourdomain.com/ext/api/device/a1b2c3d4?key=YOUR_KEY"

# Rotate IP
curl "https://proxy.yourdomain.com/ext/api/rotate/a1b2c3d4?key=YOUR_KEY"
```

### Response Example

```json
{
  "success": true,
  "device": {
    "deviceId": "a1b2c3d4",
    "interface": "ppp0",
    "publicIP": "113.185.72.162",
    "localIP": "10.173.0.1",
    "status": "active",
    "type": "stick",
    "proxy": {
      "host": "ddns-proxy.yourdomain.com",
      "port": 10000,
      "username": "proxyuser",
      "password": "proxypass"
    }
  }
}
```

---

## 📁 Project Structure

```
├── setup.sh              # One-command installer
├── update.sh             # Update script
├── server.js             # Express API server + uptime tracking + ext API
├── src/
│   ├── auth.js           # Session authentication
│   ├── dcom-scanner.js   # USB detection, Device ID (MD5), public IP
│   ├── proxy-manager.js  # 3proxy config generator
│   └── ip-rotator.js     # IP rotation (3 methods)
├── scripts/
│   └── ddns-update.sh    # Cloudflare DDNS updater
├── public/               # Dashboard UI (light theme, favicon 🚀)
│   ├── index.html        # Login page
│   ├── dashboard.html    # Main dashboard
│   ├── css/style.css     # Light theme styles
│   └── js/               # Frontend logic
├── config/               # 3proxy template
├── docs/                 # Setup guide
└── systemd/              # Service files (dcom-proxy, 3proxy, ddns-update)
```

---

## ⚙️ Configuration

The `.env` file is auto-generated during setup:

| Variable | Description | Default |
|----------|-------------|---------|
| `SECRET_KEY` | Dashboard login + API key | Auto-generated |
| `PORT` | Web dashboard port | `8080` |
| `PROXY_START_PORT` | Starting port for proxies | `10000` |
| `IP_ROTATE_METHOD` | IP rotation method | `hilink` |
| `DEFAULT_PROXY_USER` | Default proxy username | `proxyuser` |
| `DEFAULT_PROXY_PASS` | Default proxy password | `proxypass` |
| `CF_API_TOKEN` | Cloudflare API token (DDNS) | **Required** |
| `CF_ZONE_ID` | Cloudflare Zone ID (DDNS) | **Required** |
| `CF_DDNS_DOMAIN` | DDNS domain for proxy | **Required** |

---

## 🛠️ Management

```bash
# Update to latest version
cd /opt/dcom-proxy && sudo git pull && sudo bash update.sh

# Check service status
sudo systemctl status dcom-proxy 3proxy ddns-update.timer cloudflared

# View logs
sudo journalctl -u dcom-proxy -f

# Restart services
sudo systemctl restart dcom-proxy
sudo systemctl restart 3proxy

# Change dashboard password (also changes API key)
nano /opt/dcom-proxy/.env    # Edit SECRET_KEY
sudo systemctl restart dcom-proxy
```

### Auto-start Services

All services are enabled by default and start on boot:

| Service | Purpose |
|---------|---------|
| `dcom-proxy` | Dashboard + modem management + API |
| `3proxy` | Proxy server |
| `ddns-update.timer` | DDNS update every 5 min |
| `cloudflared` | Cloudflare Tunnel |

---

## 📝 License

MIT License — Free to use and modify.
