# Hướng dẫn Quản lý Cơ sở dữ liệu (D1 Database & Drizzle)

Tài liệu này hướng dẫn chi tiết cách vận hành, migrate cấu trúc bảng và nạp dữ liệu thử nghiệm giữa môi trường **Local (để Test)** và môi trường **Production (Thực tế)** trên dự án IELTS Platform.

---

## 1. Môi trường Local (Phát triển & Test)

Khi bạn phát triển local, mọi dữ liệu sẽ được ghi vào một file SQLite cục bộ nằm trong thư mục ẩn `.wrangler/`. Thư mục này đã được cấu hình trong `.gitignore` nên **an toàn tuyệt đối**, không sợ đẩy dữ liệu test lên production hoặc Git.

### 📌 Các lệnh thường dùng cho Local:

1. **Khởi động Server Backend Local:**
   ```bash
   npm run dev
   # Hoặc: npx wrangler dev
   ```

2. **Tạo file Migration mới (khi bạn thay đổi schema.ts):**
   ```bash
   npx drizzle-kit generate
   ```

3. **Áp dụng cấu trúc bảng (Migration) vào DB Local:**
   ```bash
   npx wrangler d1 migrations apply DB --local
   ```

4. **Nạp dữ liệu mẫu (Seed Data) vào DB Local:**
   ```bash
   # Nạp dữ liệu cấu trúc đề thi/bài học mẫu
   npx wrangler d1 execute DB --local --file=./seed.sql
   
   # Nạp dữ liệu cấu hình dev/thử nghiệm nhanh
   npx wrangler d1 execute DB --local --file=./seed-dev.sql
   ```

5. **Truy vấn nhanh dữ liệu ở local bằng dòng lệnh:**
   ```bash
   npx wrangler d1 execute DB --local --command="SELECT * FROM users LIMIT 5;"
   ```

---

## 2. Môi trường Production (Thực tế trên Cloudflare)

Khi bạn muốn áp dụng các thay đổi cấu trúc hoặc kiểm tra dữ liệu trên hệ thống Cloud thực tế của Cloudflare.

### 📌 Các lệnh thường dùng cho Production:

1. **Deploy mã nguồn Backend lên Cloudflare:**
   ```bash
   npm run deploy
   # Hoặc: npx wrangler deploy
   ```

2. **Áp dụng cấu trúc bảng (Migration) lên DB thật:**
   ```bash
   npx wrangler d1 migrations apply DB --remote
   ```

3. **Nạp dữ liệu mẫu lên DB thật (Cực kỳ hạn chế sử dụng):**
   ```bash
   npx wrangler d1 execute DB --remote --file=./seed.sql
   ```

4. **Truy vấn kiểm tra dữ liệu thật trên Cloudflare:**
   ```bash
   npx wrangler d1 execute DB --remote --command="SELECT count(*) FROM users;"
   ```

---

## 💡 Các lưu ý quan trọng để tránh nhầm lẫn dữ liệu:

* **Tuyệt đối không dùng tham số `--remote`** khi đang phát triển tính năng mới hoặc nạp dữ liệu test để tránh ghi đè dữ liệu người dùng thật.
* Để kiểm tra cấu trúc bảng cục bộ mà không cần cài đặt gì thêm, bạn có thể chạy `npx drizzle-kit studio` để mở giao diện quản trị database trực quan trên trình duyệt (thường ở cổng `127.0.0.1:4983`).
