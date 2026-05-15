# 🚀 IELTS Learning Platform - Backend (Cloudflare Workers)

Hệ thống API backend mạnh mẽ cho nền tảng học IELTS, được xây dựng trên nền tảng Cloudflare Workers và Hono framework, mang lại hiệu suất cực cao và độ trễ thấp.

## 🛠 Tech Stack

- **Framework:** [Hono](https://hono.dev/) (Siêu nhẹ, tối ưu cho Edge Runtime).
- **Runtime:** Cloudflare Workers.
- **ORM:** [Drizzle ORM](https://orm.drizzle.team/) (Type-safe SQL).
- **Database:** PostgreSQL (with `pg` driver).
- **AI Integration:** Cloudflare AI (Llama 3.1 8B).
- **Storage:** Cloudflare R2 for assets.
- **Validation:** Zod.

## 📂 Cấu Trúc Thư Mục

- `src/api/v1/`: Chứa các định nghĩa route và logic xử lý API (Auth, Courses, Progress, etc.).
- `src/services/`: Chứa logic nghiệp vụ chính (AI Scoring, Lesson logic).
- `src/db/`: Định nghĩa Schema và kết nối Database.
- `drizzle/`: Các file migrations của Database.

## 🚀 Hướng Dẫn Chạy Local

1. **Cài đặt thư viện:**
   ```bash
   npm install
   ```

2. **Cấu hình môi trường:**
   Tạo file `.dev.vars` (cho wrangler local) và điền các thông tin:
   ```env
   DATABASE_URL=postgres://user:password@localhost:5432/ielts_db
   JWT_SECRET=your_jwt_secret
   CLOUDFLARE_AI_TOKEN=your_ai_token (nếu dùng AI từ Cloudflare trực tiếp)
   ```

3. **Tạo Types cho Bindings:**
   ```bash
   npm run cf-typegen
   ```

4. **Chạy server phát triển:**
   ```bash
   npm run dev
   ```

## 🚢 Triển Khai (Deploy)

Để triển khai lên Cloudflare Workers:
```bash
npm run deploy
```

## 📝 Database Migrations

- Tạo migration mới: `npm run db:generate`
- Đẩy migration lên DB: `npm run db:push`

---
*Phát triển bởi IELTS AI Team*
