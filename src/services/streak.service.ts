import { D1Database } from '@cloudflare/workers-types';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { users, dailyActivity, userInventory, shopItems } from '../db/schema';

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

    // Lấy 100 ngày gần nhất để tính chuỗi
    const activityRows = await this.db.select({ activity_date: dailyActivity.activity_date })
      .from(dailyActivity)
      .where(eq(dailyActivity.user_id, userId))
      .orderBy(desc(dailyActivity.activity_date))
      .limit(100)
      .all();

    const activeDates = new Set(activityRows.map(r => r.activity_date));
    const todayActive = activeDates.has(today);

    let currentStreak = 0;
    // Bắt đầu đếm từ 'hôm nay' nếu có hoạt động, ngược lại đếm từ 'hôm qua'
    let checkDate = todayActive ? today : yesterday;

    while (activeDates.has(checkDate)) {
      currentStreak++;
      checkDate = this.getYesterdayInTimezone(checkDate);
    }

    const user = await this.db.select({ longest_streak: users.longest_streak })
      .from(users)
      .where(eq(users.id, userId))
      .get();

    const longestStreak = Math.max(user?.longest_streak ?? 0, currentStreak);

    return {
      current_streak: currentStreak,
      longest_streak: longestStreak,
      last_active_date: activityRows.length > 0 ? activityRows[0].activity_date : null,
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
    const today = this.getTodayInTimezone('UTC'); // Cron chạy UTC
    const yesterday = this.getYesterdayInTimezone(today);

    // 1. Lấy user_id của những user có activity hôm nay hoặc hôm qua
    const activeUserRows = await this.db
      .select({ user_id: dailyActivity.user_id })
      .from(dailyActivity)
      .where(
        sql`${dailyActivity.activity_date} IN (${today}, ${yesterday})`
      )
      .all();

    const activeUserIds = new Set(activeUserRows.map(r => r.user_id));

    // 2. Lấy user có streak > 0 nhưng KHÔNG có activity hôm nay hoặc hôm qua
    const staleUsers = await this.db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.is_active, true as any),
          sql`${users.current_streak} > 0`
        )
      )
      .all();

    const potentiallyToReset = staleUsers.filter(u => !activeUserIds.has(u.id));

    if (potentiallyToReset.length === 0) return 0;

    const potentiallyToResetIds = potentiallyToReset.map(u => u.id);

    // 3. Kiểm tra xem ai có Streak Freeze (protection)
    const protectedInventoryItems = await this.db
      .select({ 
        user_id: userInventory.user_id,
        inventory_id: userInventory.id,
        quantity: userInventory.quantity
      })
      .from(userInventory)
      .innerJoin(shopItems, eq(userInventory.item_id, shopItems.id))
      .where(
        and(
          inArray(userInventory.user_id, potentiallyToResetIds),
          eq(shopItems.item_type, 'protection'),
          sql`${userInventory.quantity} > 0`
        )
      )
      .all();

    const protectedUserMap = new Map(protectedInventoryItems.map(item => [item.user_id, item]));
    const toResetUsers = potentiallyToReset.filter(u => !protectedUserMap.has(u.id));
    const toProtectUsers = potentiallyToReset.filter(u => protectedUserMap.has(u.id));

    // 4. Reset những user KHÔNG được bảo vệ
    if (toResetUsers.length > 0) {
      const ids = toResetUsers.map(u => `'${u.id}'`).join(',');
      await this.db.run(
        sql`UPDATE users SET current_streak = 0 WHERE id IN (${sql.raw(ids)})`
      );
    }

    // 5. Tiêu thụ Streak Freeze cho những user được bảo vệ
    for (const user of toProtectUsers) {
      const item = protectedUserMap.get(user.id)!;
      
      // Sử dụng db.batch() để thay thế db.transaction() nhằm tránh lỗi BEGIN TRANSACTION trên D1
      const batch = [];

      // Giảm số lượng hoặc xóa nếu hết
      if ((item.quantity ?? 0) > 1) {
        batch.push(
          this.db.update(userInventory)
            .set({ quantity: (item.quantity ?? 0) - 1, updated_at: new Date() })
            .where(eq(userInventory.id, item.inventory_id))
        );
      } else {
        batch.push(
          this.db.delete(userInventory)
            .where(eq(userInventory.id, item.inventory_id))
        );
      }

      // Insert activity giả cho 'today' để streak không bị reset
      batch.push(
        this.db.insert(dailyActivity).values({
          id: crypto.randomUUID(),
          user_id: user.id,
          activity_date: today,
          source: 'streak_freeze',
        })
      );

      await this.db.batch(batch as any);
    }

    return toResetUsers.length;
  }
}
