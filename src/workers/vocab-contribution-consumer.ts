/**
 * Vocab Contribution Auto-Review Consumer
 * Chạy nền qua SCORING_QUEUE (tái dụng queue hiện có).
 * Message type: 'vocab_contribution_review'
 * 
 * Khi nhận message:
 * 1. Kiểm tra score đã tính sẵn từ API
 * 2. Nếu score >= 70 → auto-approve + merge vào vocabulary + tặng coins bonus
 * 3. Nếu score < 70 → chuyển sang needs_review để admin duyệt tay
 */
import type { MessageBatch, ExecutionContext } from '@cloudflare/workers-types';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, sql } from 'drizzle-orm';
import { vocabContributions, vocabulary, users, transactions } from '../db/schema';
import type { Bindings } from '../index';

const REWARD_AUTO_APPROVE = 20; // Xu bonus khi auto-approved
const REWARD_PIONEER = 100;     // Bonus người đầu tiên có từ trong hệ thống

export async function vocabContributionConsumer(
  batch: MessageBatch<any>,
  env: Bindings,
  _ctx: ExecutionContext
) {
  const db = drizzle(env.DB);

  for (const message of batch.messages) {
    const body = message.body;

    // Chỉ xử lý đúng message type này
    if (body?.type !== 'vocab_contribution_review') {
      message.ack();
      continue;
    }

    const { contribution_id, user_id, word, auto_score, auto_status } = body;

    try {
      // Đọc lại contribution để đảm bảo còn ở trạng thái pending
      const contrib = await db
        .select()
        .from(vocabContributions)
        .where(eq(vocabContributions.id, contribution_id))
        .get();

      if (!contrib || contrib.status !== 'pending') {
        // Đã được xử lý rồi hoặc không tồn tại → ack và bỏ qua
        message.ack();
        continue;
      }

      if (auto_status === 'approved') {
        // ── Kiểm tra từ đã có trong vocabulary chính chưa ──
        const existingVocab = await db
          .select({ id: vocabulary.id })
          .from(vocabulary)
          .where(eq(vocabulary.word, word))
          .get();

        const isPioneer = !existingVocab;

        // Merge vào vocabulary nếu là từ mới
        if (isPioneer) {
          await db.insert(vocabulary).values({
            word: contrib.word,
            pronunciation: contrib.phonetic || '',
            part_of_speech: contrib.part_of_speech || '',
            definition: contrib.definition || '',
            definition_vi: contrib.definition_vi || '',
            example: contrib.example || '',
            example_vi: contrib.example_vi || '',
            topic: 'Contributed',
            status: 'published',
            updated_at: Math.floor(Date.now() / 1000),
          }).onConflictDoNothing().execute();
        }

        // Cập nhật status → approved
        await db.update(vocabContributions)
          .set({ status: 'approved', auto_score })
          .where(eq(vocabContributions.id, contribution_id))
          .execute();

        // Tặng xu bonus
        const bonusCoins = REWARD_AUTO_APPROVE + (isPioneer ? REWARD_PIONEER : 0);

        await db.update(users)
          .set({ coins: sql`${users.coins} + ${bonusCoins}` })
          .where(eq(users.id, user_id))
          .execute();

        await db.insert(transactions).values({
          id: crypto.randomUUID(),
          user_id: user_id,
          amount: bonusCoins,
          currency: 'COINS',
          type: 'vocab_contribution_auto_approved',
          status: 'completed',
          metadata: {
            contribution_id,
            word,
            event: isPioneer ? 'auto_approved_pioneer' : 'auto_approved',
          } as any,
        }).execute();

        console.log(`[VocabContrib] Auto-approved "${word}" for user ${user_id}. Pioneer: ${isPioneer}. +${bonusCoins} coins.`);

      } else {
        // score < 70 → đẩy sang needs_review
        await db.update(vocabContributions)
          .set({ status: 'needs_review', auto_score })
          .where(eq(vocabContributions.id, contribution_id))
          .execute();

        console.log(`[VocabContrib] "${word}" needs admin review (score: ${auto_score}).`);
      }

      message.ack();

    } catch (err) {
      console.error(`[VocabContrib Consumer] Error for contribution ${contribution_id}:`, err);
      message.retry();
    }
  }
}
