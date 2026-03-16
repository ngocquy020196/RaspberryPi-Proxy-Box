# YÊU CẦU DỰ ÁN: PHÁT TRIỂN HỆ THỐNG QUẢN LÝ RASPBERRY PI 4G PROXY BOX

**Vai trò của bạn:** Bạn là một System Engineer và Full-stack Developer chuyên gia về Linux, Network Routing, và phần cứng Raspberry Pi.

**Mục tiêu:** Viết toàn bộ mã nguồn và hướng dẫn cài đặt (setup scripts) để biến một mạch Raspberry Pi thành một trạm Proxy Box chuyên nghiệp sử dụng nhiều USB Dcom 4G.

**Phần cứng sử dụng:**
- Raspberry Pi (Chạy Raspberry Pi OS / Debian).
- USB Hub có nguồn phụ.
- Nhiều USB Dcom 4G LTE Vodafone K5160 150Mbps (Bản nâng cấp của Huawei E3372 - HiLink hoặc Stick mode).

**Yêu cầu tính năng cốt lõi:**

1. **Quản lý & Định tuyến Proxy (Core Proxy Engine):**
   - Sử dụng `3proxy` (hoặc phần mềm tương đương nhẹ, tối ưu cho Pi) để tạo HTTP/SOCKS5 proxy.
   - Mỗi USB Dcom khi cắm vào sẽ nhận một interface mạng riêng (VD: `eth1`, `usb0`, `eth2`...).
   - Tự động map mỗi IP tĩnh/Port của Proxy với một Interface mạng của Dcom tương ứng (Cấu hình Outgoing IP).

2. **Giao diện quản trị Web (Web Dashboard):**
   - **Bảo mật:** Bắt buộc có trang đăng nhập bảo vệ bằng Password hoặc Secret Key để tránh truy cập trái phép từ bên ngoài.
   - **Dashboard:** Hiển thị số lượng và danh sách các USB Dcom đang được cắm và hoạt động (Scan qua `lsusb` hoặc danh sách network interfaces).
   - **Cấu hình:** Giao diện cho phép người dùng thiết lập cấu hình cho từng Dcom: Port của proxy, Username, và Password để xác thực proxy.
   - **Reset IP (Xoay IP):** Có nút bấm trên web cho từng Dcom để ngắt kết nối và kết nối lại nhằm lấy IP mạng 4G mới (Thực hiện qua API gọi lệnh bash, có thể dùng `usb-modeswitch`, khởi động lại interface `ifdown`/`ifup`, hoặc gửi lệnh AT qua cổng Serial tùy thuộc vào firmware của Vodafone K5160).

3. **Truy cập từ xa & Kết nối ngoài LAN:**
   - **Web Dashboard:** Sử dụng **Cloudflare Tunnel (`cloudflared`)** để trỏ domain về localhost của Raspberry Pi, giúp truy cập trang quản trị an toàn từ bất cứ đâu mà không cần mở port (Port Forwarding) trên Router.
   - **Kết nối Proxy từ máy tính ngoài mạng LAN:** Hãy đưa ra giải pháp mạng hợp lý nhất để các máy tính bên ngoài có thể kết nối vào các Port Proxy này (Ví dụ: Dùng ZeroTier, Tailscale, ngrok, thiết lập TCP Tunneling trên Cloudflare, hoặc cấu hình Port Forwarding cơ bản trên Router nếu dùng IP Public).

**Cấu trúc công nghệ đề xuất (Tech Stack):**
- **Backend:** Node.js (Express) hoặc Python (FastAPI/Flask) để dễ dàng chạy các lệnh shell (child_process/subprocess) giao tiếp với hệ điều hành.
- **Frontend:** HTML/CSS/JS thuần, Bootstrap hoặc TailwindCSS cho nhẹ nhàng.
- **Proxy Server:** `3proxy` (cấu hình linh hoạt cho nhiều outgoing IP).

**Nhiệm vụ của bạn (Hãy xuất ra chi tiết):**
1. Viết **Shell Script** tự động cài đặt các môi trường cần thiết (Node.js/Python, 3proxy, cloudflared).
2. Viết mã nguồn **Backend** xử lý logic: Đọc danh sách thiết bị, tạo/chỉnh sửa file config của 3proxy, và hàm reset IP Dcom.
3. Viết mã nguồn **Frontend** giao diện quản trị rõ ràng, dễ sử dụng.
4. Cung cấp hướng dẫn chi tiết (Step-by-step) cách cấu hình Cloudflare Tunnel và cách thiết lập mạng để máy tính ngoài LAN có thể sử dụng các proxy này.
5. Xử lý các edge-case phổ biến của dòng Vodafone K5160 (Huawei) trên Linux (chuyển đổi mode từ Storage sang Modem nếu cần).