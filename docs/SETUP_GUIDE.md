# DCOM Proxy Box — Setup Guide

Complete guide to install and configure the Raspberry Pi 4G Proxy Box system.

## 1. Automated Installation

```bash
# Option A: One-line install (recommended)
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/ngocquy020196/RaspberryPi-Proxy-Box/main/setup.sh)"

# Option B: Clone and install
git clone https://github.com/ngocquy020196/RaspberryPi-Proxy-Box.git /opt/dcom-proxy
cd /opt/dcom-proxy
sudo bash setup.sh
```

The script automatically installs:
- Node.js 18 LTS
- 3proxy (compiled from source)
- cloudflared (Cloudflare Tunnel client)
- usb-modeswitch (for Vodafone K5160 / Huawei E3372)

## 2. Configuration

```bash
# Edit config file
nano .env
```

Key settings:

| Variable | Description | Default |
|----------|-------------|---------|
| `SECRET_KEY` | Dashboard login password | Auto-generated |
| `PORT` | Web dashboard port | `8080` |
| `PROXY_START_PORT` | Starting port for proxies | `10000` |
| `IP_ROTATE_METHOD` | IP rotation method (`hilink` / `interface` / `at_command`) | `hilink` |

## 3. Starting Services

```bash
# Start services
sudo systemctl start 3proxy
sudo systemctl start dcom-proxy

# Check status
sudo systemctl status dcom-proxy

# View logs
sudo journalctl -u dcom-proxy -f
```

Access dashboard: `http://<PI_IP>:8080`

## 4. Cloudflare Tunnel Setup (Remote Dashboard Access)

> **Note:** The installer asks if you want to configure this automatically during setup. If you chose "No", follow these manual steps.

### Step 1: Login to Cloudflare
```bash
cloudflared tunnel login
```
A browser link will appear. Open it to authenticate with your Cloudflare account.

### Step 2: Create a Tunnel
```bash
cloudflared tunnel create dcom-proxy
```

### Step 3: Route DNS
```bash
# Point your subdomain to the tunnel
cloudflared tunnel route dns dcom-proxy proxy.yourdomain.com
```

### Step 4: Create Config File
```bash
cat > ~/.cloudflared/config.yml << EOF
tunnel: <TUNNEL_ID>
credentials-file: /root/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: proxy.yourdomain.com
    service: http://localhost:8080
  - service: http_status:404
EOF
```

### Step 5: Run the Tunnel
```bash
# Test run
cloudflared tunnel run dcom-proxy

# Install as system service (auto-start on boot)
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
```

Access remotely: `https://proxy.yourdomain.com`

## 5. Remote Access for Proxy Ports

### Option A: Cloudflare TCP Tunnel (Recommended)

Add to `config.yml`:
```yaml
ingress:
  - hostname: proxy.yourdomain.com
    service: http://localhost:8080
  # Add TCP tunnel for each proxy port
  - hostname: p1.yourdomain.com
    service: tcp://localhost:10000
  - hostname: p2.yourdomain.com
    service: tcp://localhost:10001
  - service: http_status:404
```

Client connection via `cloudflared access tcp`:
```bash
cloudflared access tcp --hostname p1.yourdomain.com --url localhost:10000
# Then use proxy: localhost:10000
```

### Option B: Tailscale (Simplest)

```bash
# On Raspberry Pi
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# On client machine
# Install Tailscale → Join the same network
# Use Tailscale IP of Pi as proxy host
```

### Option C: Port Forwarding (Router)

If you have a static public IP:
1. Go to your Router admin panel
2. Forward port `8080` (dashboard) and `10000-100XX` (proxy ports) to Pi's local IP
3. Connect via: `http://<PUBLIC_IP>:8080`

> ⚠️ Not recommended without proper firewall configuration.

## 6. Troubleshooting

### USB Dcom Not Detected
```bash
# Check USB devices
lsusb | grep -i huawei

# If product ID shows 14fe (CD-ROM mode):
sudo usb_modeswitch -v 0x12d1 -p 0x14fe \
  -M 55534243123456780000000000000a11062000000000000100000000000000

# Verify switch
lsusb | grep -i huawei
# Should now show product ID 1506 (Modem mode)
```

### No New Network Interface
```bash
# Check interfaces
ip link show

# Check kernel messages
dmesg | tail -30 | grep -i usb
```

### IP Doesn't Change After Rotation
- Try changing `IP_ROTATE_METHOD` in `.env`:
  - `hilink`: For K5160 HiLink mode (default)
  - `interface`: Restart network interface
  - `at_command`: Send AT commands via serial port

### 3proxy Won't Start
```bash
# Check config syntax
3proxy /etc/3proxy/3proxy.cfg

# Check logs
cat /var/log/3proxy/3proxy.log
```
