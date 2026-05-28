import { drizzle } from 'drizzle-orm/d1';
import { eq, and, gt, sql } from 'drizzle-orm';
import { users, userProgress } from '../db/schema';

const SENDER_EMAIL = 'hello@ielts-peak.com';

export interface EmailPayload {
  type: 'welcome' | 'weekly_report';
  email: string;
  name: string;
  data?: any;
}

export async function getWeeklyReportData(dbRaw: D1Database): Promise<EmailPayload[]> {
  const db = drizzle(dbRaw);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  // Find users who have completed progress in the last 7 days
  const activeUsers = await db.select({
    id: users.id,
    email: users.email,
    full_name: users.full_name
  })
  .from(users)
  .innerJoin(userProgress, eq(users.id, userProgress.user_id))
  .where(gt(userProgress.completed_at, sevenDaysAgo))
  .groupBy(users.id)
  .all();

  const payloads: EmailPayload[] = [];

  for (const u of activeUsers) {
    // Get their stats
    const stats = await db.select({
      totalLessons: sql<number>`count(${userProgress.id})`,
      avgScore: sql<number>`avg(${userProgress.score})`
    })
    .from(userProgress)
    .where(and(
      eq(userProgress.user_id, u.id),
      gt(userProgress.completed_at, sevenDaysAgo),
      eq(userProgress.status, 'completed')
    )).get();

    payloads.push({
      type: 'weekly_report',
      email: u.email,
      name: u.full_name,
      data: {
        lessonsCompleted: stats?.totalLessons || 0,
        avgScore: Math.round((stats?.avgScore || 0) * 10) / 10
      }
    });
  }

  return payloads;
}

export async function sendEmailViaResend(apiKey: string, to: string, subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: `IELTS Peak <${SENDER_EMAIL}>`,
      to: [to],
      subject,
      html
    })
  });
  
  if (!res.ok) {
    const error = await res.text();
    console.error(`[Resend Error] Failed to send email to ${to}: ${error}`);
    throw new Error(`Resend API Error: ${res.statusText}`);
  }
}

export function getWelcomeEmailHtml(name: string) {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #4F46E5;">Chào mừng ${name} đến với IELTS Peak! 🎉</h1>
      <p>Cảm ơn bạn đã đăng ký nền tảng học tiếng Anh AI-powered của chúng tôi.</p>
      <p>Tại IELTS Peak, bạn có thể rèn luyện 4 kỹ năng với sự hỗ trợ của các AI Tutor thông minh.</p>
      <a href="https://ielts-platform.pages.dev" style="display: inline-block; background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin-top: 20px;">Bắt đầu học ngay</a>
    </div>
  `;
}

export function getWeeklyReportHtml(name: string, data: any) {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #10B981;">Báo cáo học tập tuần qua 📊</h1>
      <p>Chào ${name}, tuần qua bạn đã hoạt động rất tích cực trên IELTS Peak!</p>
      <div style="background-color: #F3F4F6; padding: 20px; border-radius: 12px; margin: 20px 0;">
        <h3 style="margin-top: 0;">Thành tích của bạn:</h3>
        <ul style="font-size: 16px; line-height: 1.6;">
          <li>📚 Bài học hoàn thành: <strong>${data.lessonsCompleted}</strong></li>
          <li>🎯 Điểm trung bình: <strong>${data.avgScore}</strong></li>
        </ul>
      </div>
      <p>Tiếp tục giữ vững phong độ tuần tới nhé!</p>
      <a href="https://ielts-platform.pages.dev" style="display: inline-block; background-color: #10B981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px;">Vào học tiếp</a>
    </div>
  `;
}
