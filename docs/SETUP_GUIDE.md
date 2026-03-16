# DCOM Proxy Box — Setup Guide

Complete guide to install and configure the Raspberry Pi 4G Proxy Box system.

## 1. Hardware Setup

### Requirements
- **Raspberry Pi** 3B+/4/5 with Raspberry Pi OS
- **5V/3A Power Supply** (minimum)
- **Powered USB Hub** — required for multiple Dcoms
- **USB 4G Dcom** — Vodafone K5160 / Huawei E3372 / E1550

### Wiring
```
Power Supply → Pi → USB Hub (powered) → Dcom 1, Dcom 2, ...
```

> ⚠️ **Do NOT plug Dcoms directly into Pi USB ports.** Pi can only supply ~1.2A total across all USB ports. Each Dcom uses ~0.5A. Use a powered USB hub.

---

## 2. Installation

```bash
# Option A: One-line install (recommended)
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/ngocquy020196/RaspberryPi-Proxy-Box/main/setup.sh)"

# Option B: Clone and install
git clone https://github.com/ngocquy020196/RaspberryPi-Proxy-Box.git /opt/dcom-proxy
cd /opt/dcom-proxy
sudo bash setup.sh
```

The installer automatically installs:
- Node.js 18 LTS
- 3proxy (compiled from source)
- cloudflared (Cloudflare Tunnel client)
- usb-modeswitch, ppp, wvdial

---

## 3. Configuration

```bash
nano /opt/dcom-proxy/.env
```

| Variable | Description | Default |
|----------|-------------|---------|
| `SECRET_KEY` | Dashboard login + API key | Auto-generated |
| `PORT` | Web dashboard port | `8080` |
| `PROXY_START_PORT` | Starting port for proxies | `10000` |
| `IP_ROTATE_METHOD` | `hilink` / `interface` / `at_command` | `hilink` |
| `DEFAULT_PROXY_USER` | Proxy username | `proxyuser` |
| `DEFAULT_PROXY_PASS` | Proxy password | `proxypass` |
| `CF_API_TOKEN` | Cloudflare API token | **Required** |
| `CF_ZONE_ID` | Cloudflare Zone ID | **Required** |
| `CF_DDNS_DOMAIN` | DDNS domain for proxy access | **Required** |

---

## 4. Network Setup — Port Forwarding

For customers to connect to your proxy from outside your network:

### Single Router
Forward port range `10000:10020` → Pi's local IP (e.g., `192.168.50.22`)

### Two Routers (Main + Secondary)
```
Internet → Router Main → Router Secondary → Pi
```
1. **Router Secondary:** Forward `10000:10020` → Pi IP (TCP)
2. **Router Main:** Forward `10000:10020` → Router Secondary WAN IP (TCP)

### ASUS RT-AX53U Example
- WAN → Virtual Server / Port Forwarding
- Service Name: `DCOM Proxy`
- Protocol: `TCP`
- External Port: `10000:10020`
- Internal Port: `10000` (or leave empty)
- Internal IP: `192.168.50.22`

### Static IP for Pi
Set in router DHCP settings so Pi always gets the same IP.

---

## 5. Cloudflare DDNS

Auto-updates your domain with Pi's public WiFi IP every 5 minutes.

### Get Credentials
1. **API Token:** https://dash.cloudflare.com/profile/api-tokens
   - Create Token → Edit zone DNS → select your domain
2. **Zone ID:** Cloudflare Dashboard → your domain → Overview → right sidebar

### DNS Record Settings
- Type: `A`
- Name: your DDNS subdomain (e.g., `ddns-proxy`)
- Proxy status: **DNS only** (☁️ grey cloud, NOT 🟠 orange)

> ⚠️ Proxy status MUST be "DNS only" for TCP proxy to work. Orange cloud = Cloudflare CDN proxy = blocks TCP connections.

### Verify DDNS
```bash
nslookup ddns-proxy.yourdomain.com   # Should show Pi's public IP
curl https://api.ipify.org            # Pi's public IP for comparison
```

---

## 6. Cloudflare Tunnel (Dashboard)

Provides HTTPS remote access to the web dashboard.

### Automatic Setup
The installer handles tunnel creation, DNS routing, and service setup during `setup.sh`.

### Manual Setup
```bash
cloudflared tunnel login
cloudflared tunnel create dcom-proxy
cloudflared tunnel route dns dcom-proxy dashboard.yourdomain.com

cat > ~/.cloudflared/config.yml << EOF
tunnel: <TUNNEL_ID>
credentials-file: /root/.cloudflared/<TUNNEL_ID>.json
ingress:
  - hostname: dashboard.yourdomain.com
    service: http://localhost:8080
  - service: http_status:404
EOF

sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
```

---

## 7. External API

### Authentication
Use `SECRET_KEY` (same as dashboard login password):
- Query param: `?key=YOUR_KEY`
- Header: `x-api-key: YOUR_KEY`

### Endpoints (all GET)

| Endpoint | Description |
|----------|-------------|
| `/ext/api/devices` | List all devices |
| `/ext/api/device/:deviceId` | Status & proxy info by Device ID |
| `/ext/api/rotate/:deviceId` | Rotate IP (resets uptime) |

### Device ID
Each device gets a unique **8-character MD5 hash** (e.g., `a1b2c3d4`) based on MAC address, IMEI, or USB bus path.

### Examples
```bash
curl "https://dashboard.yourdomain.com/ext/api/devices?key=YOUR_KEY"
curl "https://dashboard.yourdomain.com/ext/api/device/a1b2c3d4?key=YOUR_KEY"
curl "https://dashboard.yourdomain.com/ext/api/rotate/a1b2c3d4?key=YOUR_KEY"
```

---

## 8. Services

All services auto-start on boot:

| Service | Command | Purpose |
|---------|---------|---------|
| `dcom-proxy` | `systemctl status dcom-proxy` | Dashboard + API |
| `3proxy` | `systemctl status 3proxy` | Proxy server |
| `ddns-update.timer` | `systemctl status ddns-update.timer` | DDNS every 5 min |
| `cloudflared` | `systemctl status cloudflared` | Tunnel |

```bash
# Check all services
sudo systemctl is-enabled dcom-proxy 3proxy ddns-update.timer cloudflared

# Restart all
sudo systemctl restart dcom-proxy 3proxy
```

---

## 9. Updating

```bash
cd /opt/dcom-proxy && sudo git pull && sudo bash update.sh
```

---

## 10. Troubleshooting

### Pi Loses Network / Can't Ping
- **Power issue:** Use powered USB hub + 5V/3A supply
- **PPP took default route:** Restart Pi
- **WiFi disconnected:** Check `ip addr show wlan0`

### USB Dcom Not Detected
```bash
lsusb | grep -i huawei
# If in CD-ROM mode (14fe), switch:
sudo usb_modeswitch -v 0x12d1 -p 0x14fe \
  -M 55534243123456780000000000000a11062000000000000100000000000000
```

### DDNS Domain Not Resolving
1. Check Cloudflare DNS record exists (A record)
2. Ensure proxy status is **DNS only** (grey cloud ☁️)
3. Flush local DNS: `sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder`
4. Verify: `nslookup ddns-proxy.yourdomain.com`

### Cannot Connect to Proxy from Outside
1. Check port forwarding on router(s)
2. Check DDNS domain resolves to correct IP
3. Test locally first: `curl -x http://proxyuser:proxypass@localhost:10000 https://api.ipify.org`

### DDNS Not Updating
```bash
sudo bash /opt/dcom-proxy/scripts/ddns-update.sh   # Run manually
sudo systemctl status ddns-update.timer             # Check timer
sudo journalctl -u ddns-update -n 20                # Check logs
```

### 3proxy Won't Start
```bash
cat /etc/3proxy/3proxy.cfg    # Check config
cat /var/log/3proxy/3proxy.log # Check logs
sudo systemctl restart 3proxy  # Restart
```
