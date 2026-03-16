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
1. Installs Node.js, 3proxy, cloudflared, usb-modeswitch
2. Generates a random password & starts all services
3. **Configures Cloudflare DDNS** (auto-update domain with Pi's public IP)
4. **Configures Cloudflare Tunnel** (remote dashboard access)
5. Displays dashboard URL + login credentials

---

## 📋 Features

| Feature | Description |
|---------|-------------|
| 🌐 **Multi-Proxy** | Each USB Dcom = 1 dedicated proxy (HTTP + SOCKS5) |
| 🔄 **IP Rotation** | Change 4G IP with 1 click (HiLink API / AT Commands) |
| 🖥️ **Web Dashboard** | Clean light theme UI with real-time device monitoring |
| 🔒 **Security** | Secret key login, per-device proxy authentication |
| 🌍 **Remote Access** | Cloudflare Tunnel (dashboard) + DDNS + Port Forward (proxy) |
| 📡 **DDNS** | Auto-update domain with Pi's public IP every 5 minutes |
| 📋 **Quick Connect** | Copy proxy string with 1 click, curl commands ready |
| 🔌 **Plug & Play** | Plug in Dcom → auto-detect, auto-switch mode, auto-connect |
| ⚙️ **Auto-start** | All services start on boot (systemd) |

---

## 🖥️ Hardware Requirements

- **Raspberry Pi** (3B+/4/5) — running Raspberry Pi OS / Debian
- **Powered USB Hub** — required for multiple Dcoms (Pi USB ports can't supply enough power)
- **Power Supply** — 5V/3A minimum for Pi
- **USB 4G Dcom**: Vodafone K5160 / Huawei E3372 (HiLink or Stick mode)

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

- **Public IP / Local IP** — view both IPs for each Dcom
- **Quick Connect** — copy-paste curl commands with DDNS domain
- **Copy Button** — copies proxy string with DDNS domain
- **Stop / Start** — control individual Dcom connections
- **IP Rotation** — rotate 4G IP with 1 click
- **Auto-refresh** — dashboard updates every 15 seconds

---

## 🌍 Remote Access Setup

### Cloudflare Tunnel (Dashboard)

Configured automatically during `setup.sh`. Provides HTTPS access to dashboard from anywhere.

### Cloudflare DDNS (Proxy Ports)

Configured automatically during `setup.sh`. Requires:
- **Cloudflare API Token** (Edit zone DNS permission)
- **Zone ID** (from Cloudflare dashboard)
- **DDNS Domain** (e.g., `proxy.yourdomain.com`)

The DDNS timer runs every 5 minutes, updating the A record with Pi's public WiFi IP.

### Port Forwarding (Router)

Required for proxy access from outside your network:

1. Forward port range **`10000:10020`** → `<PI_LOCAL_IP>` (TCP) on your router
2. If using a secondary router, forward on both routers

> **Tip:** Set a static IP for your Pi in the router's DHCP settings.

---

## 🔑 External API

Authenticated with `SECRET_KEY` (same as dashboard login password). Pass via header or query param.

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/ext/api/devices?key=API_KEY` | List all devices |
| GET | `/ext/api/device/:deviceID?key=API_KEY` | Get device status & proxy info by Device ID |
| GET | `/ext/api/rotate/:deviceID?key=API_KEY` | Rotate IP by Device ID |

### Device ID

Each device gets a unique identifier:
- **HiLink modems**: MAC address (e.g., `aa:bb:cc:dd:ee:ff`)
- **Stick modems**: IMEI via AT command (e.g., `IMEI:860000000000000`)
- **Fallback**: USB serial number or bus path

### Examples

```bash
# List all devices
curl -H "x-api-key: YOUR_KEY" https://proxy.yourdomain.com/ext/api/devices

# Get device by ID
curl "https://proxy.yourdomain.com/ext/api/device/IMEI:860000000000000?key=YOUR_KEY"

# Rotate IP
curl "https://proxy.yourdomain.com/ext/api/rotate/IMEI:860000000000000?key=YOUR_KEY"
```

### Response Example

```json
{
  "success": true,
  "device": {
    "mac": "IMEI:860000000000000",
    "interface": "ppp0",
    "publicIP": "113.185.72.162",
    "localIP": "10.173.0.1",
    "status": "active",
    "proxy": {
      "host": "proxy-ddns.yourdomain.com",
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
├── server.js             # Express API server
├── src/
│   ├── auth.js           # Session authentication
│   ├── dcom-scanner.js   # USB Dcom detection + public IP lookup
│   ├── proxy-manager.js  # 3proxy config generator
│   └── ip-rotator.js     # IP rotation (3 methods)
├── scripts/
│   └── ddns-update.sh    # Cloudflare DDNS updater
├── public/               # Dashboard UI
│   ├── index.html        # Login page
│   ├── dashboard.html    # Main dashboard
│   ├── css/style.css     # Light theme
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
| `SECRET_KEY` | Dashboard login password | Auto-generated |
| `PORT` | Web dashboard port | `8080` |
| `PROXY_START_PORT` | Starting port for proxies | `10000` |
| `IP_ROTATE_METHOD` | IP rotation method | `hilink` |
| `DEFAULT_PROXY_USER` | Default proxy username | `proxyuser` |
| `DEFAULT_PROXY_PASS` | Default proxy password | `proxypass` |
| `CF_API_TOKEN` | Cloudflare API token (DDNS) | Required |
| `CF_ZONE_ID` | Cloudflare Zone ID (DDNS) | Required |
| `CF_DDNS_DOMAIN` | DDNS domain for proxy | Required |

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

# Change dashboard password
nano /opt/dcom-proxy/.env    # Edit SECRET_KEY
sudo systemctl restart dcom-proxy
```

### Auto-start Services

All services are enabled by default and start on boot:

| Service | Purpose |
|---------|---------|
| `dcom-proxy` | Dashboard + modem management |
| `3proxy` | Proxy server |
| `ddns-update.timer` | DDNS update every 5 min |
| `cloudflared` | Cloudflare Tunnel |

---

## 📝 License

MIT License — Free to use and modify.
