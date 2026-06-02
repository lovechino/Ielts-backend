import { D1Database } from '@cloudflare/workers-types';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, desc, sql } from 'drizzle-orm';
import { users, dailyActivity } from '../db/schema';

export interface StreakData {
  current_streak: number;
  longest_streak: number;
  last_active_date: string | null;
  today_active: boolean;
}

export class StreakService {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  private getTodayInTimezone(timezone: string): string {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(now);
  }

  private getYesterdayInTimezone(today: string): string {
    const [y, m, d] = today.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() - 1);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  }

  async getUserTimezone(userId: string): Promise<string> {
    const user = await this.db.select({ timezone: users.timezone })
      .from(users)
      .where(eq(users.id, userId))
      .get();
    return user?.timezone ?? 'UTC';
  }

  async calculateStreak(userId: string, timezone: string): Promise<StreakData> {
    const today = this.getTodayInTimezone(timezone);
    const yesterday = this.getYesterdayInTimezone(today);

    const activityRows = await this.db.select({ activity_date: dailyActivity.activity_date })
      .from(dailyActivity)
      .where(eq(dailyActivity.user_id, userId))
      .orderBy(desc(dailyActivity.activity_date))
      .all();

    const activeDates = new Set(activityRows.map(r => r.activity_date));
    const todayActive = activeDates.has(today);

    let currentStreak = 0;

    if (todayActive || activeDates.has(yesterday)) {
      let checkDate = todayActive ? today : yesterday;
      while (activeDates.has(checkDate)) {
        currentStreak++;
        checkDate = this.getYesterdayInTimezone(checkDate);
      }
    }

    const user = await this.db.select({ longest_streak: users.longest_streak })
      .from(users)
      .where(eq(users.id, userId))
      .get();

    const longestStreak = Math.max(user?.longest_streak ?? 0, currentStreak);

    return {
      current_streak: currentStreak,
      longest_streak: longestStreak,
      last_active_date: activeDates.size > 0 ? [...activeDates].sort().pop()! : null,
      today_active: todayActive,
    };
  }

  async recordActivity(userId: string, timezone?: string): Promise<StreakData> {
    const tz = timezone ?? await this.getUserTimezone(userId);
    const today = this.getTodayInTimezone(tz);

    const existing = await this.db.select({ id: dailyActivity.id })
      .from(dailyActivity)
      .where(and(
        eq(dailyActivity.user_id, userId),
        eq(dailyActivity.activity_date, today),
      ))
      .get();

    if (!existing) {
      await this.db.insert(dailyActivity).values({
        id: crypto.randomUUID(),
        user_id: userId,
        activity_date: today,
        source: 'mobile',
      }).run();
    }

    const streak = await this.calculateStreak(userId, tz);

    await this.db.update(users)
      .set({
        current_streak: streak.current_streak,
        longest_streak: streak.longest_streak,
        last_active_date: today,
        timezone: tz,
      })
      .where(eq(users.id, userId))
      .run();

    return streak;
  }

  async getStreak(userId: string): Promise<StreakData> {
    const tz = await this.getUserTimezone(userId);
    return this.calculateStreak(userId, tz);
  }

  async batchResetStaleStreaks(): Promise<number> {
    // Lấy tất cả user đang có streak > 0 cùng với ngày hoạt động gần nhất
    // Dùng một query duy nhất thay vì N+1 queries
    const today = this.getTodayInTimezone('UTC'); // Cron chạy UTC
    const yesterday = this.getYesterdayInTimezone(today);

    // Lấy user_id của những user có activity hôm nay hoặc hôm qua
    const activeUserRows = await this.db
      .select({ user_id: dailyActivity.user_id })
      .from(dailyActivity)
      .where(
        sql`${dailyActivity.activity_date} IN (${today}, ${yesterday})`
      )
      .all();

    const activeUserIds = new Set(activeUserRows.map(r => r.user_id));

    // Reset streak cho user có streak > 0 nhưng KHÔNG có activity hôm nay hoặc hôm qua
    const staleUsers = await this.db
      .select({ id: users.id, longest_streak: users.longest_streak })
      .from(users)
      .where(
        and(
          eq(users.is_active, true as any),
          sql`${users.current_streak} > 0`
        )
      )
      .all();

    const toReset = staleUsers.filter(u => !activeUserIds.has(u.id));

    if (toReset.length === 0) return 0;

    // Batch update: reset current_streak = 0 cho tất cả user stale
    // D1 không hỗ trợ bulk update với IN clause qua Drizzle trực tiếp,
    // nên dùng raw SQL với prepared statement
    const ids = toReset.map(u => `'${u.id}'`).join(',');
    await this.db.run(
      sql`UPDATE users SET current_streak = 0 WHERE id IN (${sql.raw(ids)})`
    );

    return toReset.length;
  }
}
