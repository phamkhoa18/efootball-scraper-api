# ⚽ eFootball Scraper

> Một công cụ cào dữ liệu (web scraper) chuyên nghiệp và web dashboard dùng để trích xuất và quản lý toàn bộ dữ liệu cầu thủ eFootball từ eFootbase API, lưu trữ an toàn trong cơ sở dữ liệu MongoDB.

---

## 📌 Tính năng nổi bật

- 🚀 **Tốc độ & Ổn định**: Cào toàn bộ ~43,000 cầu thủ hiệu quả (khoảng 2-3 tiếng).
- 🔄 **Tính năng Resume**: Có thể dừng bất cứ lúc nào (Ctrl+C) và tiếp tục từ vị trí đang lưu.
- 🛡️ **Anti-Block**: Tự động thay đổi User-Agent và delay ngẫu nhiên (2.5-5.5s) giữa các page để tránh bị block IP.
- 🗄️ **MongoDB Độc lập**: Dữ liệu được lưu trong DB riêng biệt (`efootball_scraper`), không gây ảnh hưởng đến hệ thống chính.
- 📦 **Raw Data Backup**: Lưu trữ dữ liệu gốc nguyên bản trong trường `_raw` để tránh thất thoát khi có thay đổi cấu trúc dữ liệu.
- 🖼️ **Quản lý Hình ảnh**: Tải và phân loại đầy đủ ảnh cầu thủ (trong suốt), ảnh thẻ (thường, mobile, dynamic) và logo/emblem.

---

## 🛠️ Cài đặt & Chuẩn bị

1. **Yêu cầu hệ thống**:
   - Node.js (phiên bản >= 16)
   - MongoDB đang chạy (Local hoặc Atlas)

2. **Cài đặt thư viện**:

   ```bash
   npm install
   ```

3. **Cấu hình**:
   - Kiểm tra và tùy chỉnh các thông số kết nối ở file `config/default.js` (URI, tên DB, delay).

---

## 🚀 Hướng dẫn sử dụng

### 1. Cào Dữ Liệu (Scraping)

```bash
# Cào toàn bộ dữ liệu từ trang 1
npm run scrape

# Dừng giữa chừng? Chạy lệnh sau để tiếp tục ở trang bị gián đoạn:
npm run scrape:resume

# Cào lại những trang bị lỗi:
npm run scrape:retry

# Chạy tùy chỉnh bằng CLI
node src/scraper.js --startPage 100 --endPage 200
node src/scraper.js --skipImages
```

### 2. Xem Trạng Thái (Status)

Kiểm tra tiến độ, số lượng dữ liệu đã cào, và các trang bị lỗi:

```bash
npm run status
```

### 3. Xuất Dữ Liệu (Export)

Dữ liệu có thể được xuất ra file JSON để import/backup dễ dàng:

```bash
# Xuất JSON đầy đủ
npm run export

# Xuất JSON đã rút gọn (Bỏ field _raw)
npm run export -- --noRaw

# Xuất JSON với tên file tự chọn
npm run export -- --output players_data.json
```

### 4. Giao Diện (Dashboard)

Start server API & Web UI:

```bash
npm run start
# hoặc chế độ dev (watch)
npm run dev
```

---

## 📁 Cấu trúc thư mục

```text
efootball-scraper/
├── config/
│   └── default.js             # Cấu hình tham số, kết nối DB, delays, paths
├── src/
│   ├── scraper.js             # Logic cào dữ liệu chính
│   ├── downloader.js          # Module xử lý tải hình ảnh
│   ├── mapper.js              # Ánh xạ/chuyển đổi data từ API sang format DB
│   ├── progress.js            # Theo dõi và quản lý file tiến trình
│   ├── status.js              # Script CLI hiển thị trạng thái
│   ├── export.js              # Script xuất dữ liệu ra file JSON
│   ├── logger.js              # Helper ghi lại nhật ký (logs)
│   ├── server.js              # Web Server API & Dashboard
│   ├── utils.js               # Các hàm tiện ích dùng chung
│   └── views/                 # Giao diện HTML (Dashboard, Docs)
├── data/
│   ├── images/                # Nơi lưu toàn bộ hình ảnh tải về (Bỏ qua trên Git)
│   │   ├── players/           # Ảnh render cắt nền (transparent)
│   │   ├── cards/             # Thẻ cầu thủ (front, back, mobile, dynamic)
│   │   └── emblems/           # Logo đội bóng, giải đấu, quốc gia
│   └── sync-progress.json     # File lưu tiến độ cào
└── logs/                      # Log file hệ thống từng ngày (Bỏ qua trên Git)
```

---

## ⚠️ Lưu ý quan trọng

- Thư mục `node_modules/`, `data/images/`, `logs/` và các file `data/export-*.json` đã được đưa vào `.gitignore` để tránh việc đẩy dữ liệu không cần thiết / quá nặng lên Git.
- Luôn đảm bảo MongoDB Service đang được khởi chạy và có quyền truy cập trước khi tiến hành script scraping.
