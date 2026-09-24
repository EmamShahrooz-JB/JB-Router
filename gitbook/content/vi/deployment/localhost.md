# 🏠 Triển khai Localhost

Chạy JB-Router trên máy cá nhân để phát triển và dùng cá nhân.

---

## 📦 Cài đặt

Cài đặt JB-Router toàn cục qua npm:

```bash
npm install -g jb-router-cli
```

**Yêu cầu:**
- Node.js 20 trở lên
- npm 9 trở lên

---

## 🚀 Khởi động Server

Khởi động JB-Router với một lệnh duy nhất:

```bash
jb-router
```

Dashboard sẽ tự động mở trong trình duyệt tại `http://localhost:3000`

**Cấu hình mặc định:**
- **Dashboard**: `http://localhost:3000`
- **API Endpoint**: `http://localhost:20128/v1`
- **Data Directory**: `~/.jb-router`

---

## 🔧 Cấu hình

### Custom Data Directory

Đặt thư mục data tùy chỉnh qua biến môi trường:

```bash
DATA_DIR=/path/to/data jb-router
```

### Custom Port

Port API (20128) và port dashboard (3000) được cấu hình trong application. Để đổi, bạn cần sửa source code hoặc dùng biến môi trường nếu được hỗ trợ.

---

## 🛑 Dừng Server

Nhấn `Ctrl+C` trong terminal đang chạy JB-Router.

```bash
# In the terminal running jb-router
^C  # Press Ctrl+C
```

Server sẽ shutdown an toàn và lưu mọi dữ liệu.

---

## 🔄 Khởi động lại Server

Chỉ cần chạy lệnh start lại:

```bash
jb-router
```

Mọi cấu hình, API keys và combos được giữ lại trong thư mục data.

---

## 📊 Cập nhật JB-Router

Cập nhật phiên bản mới nhất:

```bash
npm update -g jb-router
```

Kiểm tra version hiện tại:

```bash
npm list -g jb-router
```

---

## 🔍 Troubleshooting

### Port đã được dùng

Nếu port 20128 hoặc 3000 đã được dùng:

```bash
# Find process using the port (macOS/Linux)
lsof -i :20128
lsof -i :3000

# Kill the process
kill -9 <PID>
```

### Lỗi Permission

Nếu gặp lỗi permission khi cài đặt:

```bash
# Use sudo (not recommended)
sudo npm install -g jb-router-cli

# Or fix npm permissions (recommended)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

### Vấn đề Data Directory

Nếu thư mục data không truy cập được:

```bash
# Check permissions
ls -la ~/.jb-router

# Fix permissions
chmod 755 ~/.jb-router
```

---

## 📁 Cấu trúc Data Directory

```
~/.jb-router/
├── db.json           # Main database (providers, combos, settings)
├── logs/             # Application logs
└── cache/            # Temporary cache files
```

**Backup Data:**

```bash
# Backup
cp -r ~/.jb-router ~/.jb-router.backup

# Restore
cp -r ~/.jb-router.backup ~/.jb-router
```

---

## 🔗 Bước tiếp theo

- [Kết nối Providers](/providers/subscription.md)
- [Tạo Combos](/features/combos.md)
- [Tích hợp với CLI Tools](/integration/cursor.md)
