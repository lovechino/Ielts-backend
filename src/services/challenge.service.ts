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

    // 1. Lấy 5 từ vựng ngẫu nhiên (A1-B2)
    const randomWords = await db.select({ id: vocabulary.id })
      .from(vocabulary)
      .where(sql`level IN ('A1', 'A2', 'B1', 'B2')`)
      .orderBy(sql`RANDOM()`)
      .limit(5)
      .all();

    // 2. Lấy 1 bài Reading mini (ưu tiên is_test=true)
    const randomReading = await db.select({ id: lessons.id })
      .from(lessons)
      .where(and(
        eq(lessons.lesson_type, 'reading'),
        eq(lessons.is_test, true as any)
      ))
      .orderBy(sql`RANDOM()`)
      .limit(1)
      .get();

    // 3. Lấy 1 bài Listening mini
    const randomListening = await db.select({ id: lessons.id })
      .from(lessons)
      .where(and(
        eq(lessons.lesson_type, 'listening'),
        eq(lessons.is_test, true as any)
      ))
      .orderBy(sql`RANDOM()`)
      .limit(1)
      .get();

    // 4. Lấy 1 từ vựng khó (B2-C2) để làm Pronunciation Challenge
    const randomHardWord = await db.select({ word: vocabulary.word })
      .from(vocabulary)
      .where(sql`level IN ('B2', 'C1', 'C2')`)
      .orderBy(sql`RANDOM()`)
      .limit(1)
      .get();

    const tasks = {
      vocab_ids: randomWords.map(w => w.id),
      reading_id: randomReading?.id || null,
      listening_id: randomListening?.id || null,
      pronunciation_word: randomHardWord?.word || "extraordinary"
    };

    // 5. Tự động gán một Topic ngẫu nhiên cho ngày hôm nay để sinh động
    const topics = [
      'Environment & Nature', 
      'Technology & Future', 
      'Education & Learning', 
      'Health & Lifestyle', 
      'Travel & Culture',
      'Work & Business',
      'Society & Relationships'
    ];
    const randomTopic = topics[Math.floor(Math.random() * topics.length)];

    const newChallenge = {
      id: crypto.randomUUID(),
      challenge_date: date,
      topic: randomTopic,
      tasks: tasks,
      content: null,
      created_at: new Date(),
    };

    // Sử dụng onConflictDoNothing để tránh lỗi khi có nhiều request cùng lúc tạo challenge
    await db.insert(dailyChallenges)
      .values(newChallenge)
      .onConflictDoNothing()
      .run();
    
    // Query lại để lấy bản ghi thực tế (có thể là bản vừa tạo hoặc bản do request khác tạo trước đó)
    const finalChallenge = await db.select()
      .from(dailyChallenges)
      .where(eq(dailyChallenges.challenge_date, date))
      .get();

    return finalChallenge || newChallenge;
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
