# DCOM Proxy Box — Setup Guide

Hướng dẫn cài đặt và cấu hình hệ thống Raspberry Pi 4G Proxy Box.

## 1. Cài đặt tự động

```bash
# Clone hoặc copy project lên Raspberry Pi
cd /opt/dcom-proxy    # hoặc thư mục bạn chọn

# Chạy setup script (cần quyền root)
sudo bash setup.sh
```

Script sẽ tự động cài:
- Node.js 18 LTS
- 3proxy (compile từ source)
- cloudflared
- usb-modeswitch (cho Vodafone K5160)

## 2. Cấu hình

```bash
# Mở file config
nano .env
```

Thay đổi các giá trị quan trọng:
| Variable | Mô tả | Mặc định |
|----------|--------|----------|
| `SECRET_KEY` | Mật khẩu đăng nhập dashboard | `changeme123` |
| `PORT` | Port web dashboard | `8080` |
| `PROXY_START_PORT` | Port bắt đầu cho proxy | `10000` |
| `IP_ROTATE_METHOD` | Phương thức xoay IP | `hilink` |

## 3. Khởi động

```bash
# Start services
sudo systemctl start 3proxy
sudo systemctl start dcom-proxy

# Kiểm tra status
sudo systemctl status dcom-proxy

# Xem logs
sudo journalctl -u dcom-proxy -f
```

Truy cập: `http://<PI_IP>:8080`

## 4. Cấu hình Cloudflare Tunnel (Remote Access cho Dashboard)

### Bước 1: Đăng nhập Cloudflare
```bash
cloudflared tunnel login
```

### Bước 2: Tạo Tunnel
```bash
cloudflared tunnel create dcom-proxy
```

### Bước 3: Cấu hình DNS
```bash
# Trỏ subdomain về tunnel
cloudflared tunnel route dns dcom-proxy proxy.yourdomain.com
```

### Bước 4: Tạo config file
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

### Bước 5: Chạy tunnel
```bash
# Chạy thử
cloudflared tunnel run dcom-proxy

# Cài đặt như service (auto-start)
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
```

Truy cập: `https://proxy.yourdomain.com`

## 5. Remote Access cho Proxy Ports

### Phương án A: Cloudflare TCP Tunnel (Khuyên dùng)

Thêm vào `config.yml`:
```yaml
ingress:
  - hostname: proxy.yourdomain.com
    service: http://localhost:8080
  # Thêm TCP tunnel cho mỗi proxy port
  - hostname: p1.yourdomain.com
    service: tcp://localhost:10000
  - hostname: p2.yourdomain.com
    service: tcp://localhost:10001
  - service: http_status:404
```

Client kết nối qua `cloudflared access tcp`:
```bash
cloudflared access tcp --hostname p1.yourdomain.com --url localhost:10000
# Sau đó dùng proxy: localhost:10000
```

### Phương án B: Tailscale (Đơn giản nhất)

```bash
# Trên Raspberry Pi
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# Trên máy client
# Cài Tailscale → Join cùng network
# Dùng Tailscale IP của Pi làm proxy host
```

### Phương án C: Port Forwarding (Router)

Nếu có IP Public tĩnh:
1. Vào trang quản trị Router
2. Forward port `8080` (dashboard) và `10000-100XX` (proxy ports) về IP nội bộ của Pi
3. Kết nối qua: `http://<PUBLIC_IP>:8080`

> ⚠️ Không khuyến khích nếu không có tường lửa phù hợp.

## 6. Troubleshooting

### USB Dcom không nhận
```bash
# Kiểm tra USB
lsusb | grep -i huawei

# Nếu hiện product ID 14fe (CD-ROM mode):
sudo usb_modeswitch -v 0x12d1 -p 0x14fe \
  -M 55534243123456780000000000000a11062000000000000100000000000000

# Kiểm tra lại
lsusb | grep -i huawei
# Phải chuyển sang product ID 1506 (Modem mode)
```

### Không có network interface mới
```bash
# Kiểm tra interfaces
ip link show

# Kiểm tra dmesg
dmesg | tail -30 | grep -i usb
```

### IP không đổi sau khi rotate
- Thử đổi `IP_ROTATE_METHOD` trong `.env`:
  - `hilink`: Cho K5160 HiLink mode (mặc định)
  - `interface`: Restart network interface
  - `at_command`: Gửi AT commands qua serial

### 3proxy không start
```bash
# Kiểm tra config
3proxy /etc/3proxy/3proxy.cfg

# Kiểm tra logs
cat /var/log/3proxy/3proxy.log
```
