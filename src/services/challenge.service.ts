import { drizzle } from 'drizzle-orm/d1';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { dailyChallenges, vocabulary, lessons, userWordVault } from '../db/schema';

export class ChallengeService {
  constructor(private db: D1Database) {}

  async getOrCreateDailyChallenge(userId: string) {
    const db = drizzle(this.db);
    const today = new Date().toISOString().split('T')[0];

    // 1. Kiểm tra xem challenge hôm nay đã tồn tại chưa
    let challenge = await db.select()
      .from(dailyChallenges)
      .where(eq(dailyChallenges.challenge_date, today))
      .get();

    if (!challenge) {
      // 2. Nếu chưa có, tiến hành tạo mới
      challenge = await this.generateGlobalChallenge(today);
    }

    return challenge;
  }

  private async generateGlobalChallenge(date: string) {
    const db = drizzle(this.db);

    // Lấy 5 từ vựng ngẫu nhiên (A1-B2)
    const randomWords = await db.select({ id: vocabulary.id })
      .from(vocabulary)
      .where(sql`level IN ('A1', 'A2', 'B1', 'B2')`)
      .orderBy(sql`RANDOM()`)
      .limit(5)
      .all();

    // Lấy 1 bài Reading mini
    const randomReading = await db.select({ id: lessons.id })
      .from(lessons)
      .where(eq(lessons.lesson_type, 'reading'))
      .orderBy(sql`RANDOM()`)
      .limit(1)
      .get();

    // Lấy 1 bài Listening mini
    const randomListening = await db.select({ id: lessons.id })
      .from(lessons)
      .where(eq(lessons.lesson_type, 'listening'))
      .orderBy(sql`RANDOM()`)
      .limit(1)
      .get();

    const tasks = {
      vocab_ids: randomWords.map(w => w.id),
      reading_id: randomReading?.id || null,
      listening_id: randomListening?.id || null,
      pronunciation_word: "extraordinary" // Tạm thời hardcode hoặc lấy ngẫu nhiên 1 từ khó
    };

    const newChallenge = {
      id: crypto.randomUUID(),
      challenge_date: date,
      topic: null,
      tasks: tasks,
      content: null,
      created_at: new Date(),
    };

    await db.insert(dailyChallenges).values(newChallenge).run();
    return newChallenge;
  }

  async getUserPersonalizedTasks(userId: string) {
    const db = drizzle(this.db);
    const now = Math.floor(Date.now() / 1000);

    // Lấy 5 từ cần review (SRS Due)
    const dueWords = await db.select({ id: userWordVault.vocab_id })
      .from(userWordVault)
      .where(and(
        eq(userWordVault.user_id, userId),
        sql`next_review_at <= ${now}`
      ))
      .orderBy(userWordVault.next_review_at)
      .limit(5)
      .all();

    return {
      review_vocab_ids: dueWords.map(w => w.id)
    };
  }
}
