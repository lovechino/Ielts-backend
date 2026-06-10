import { MessageBatch, ExecutionContext } from '@cloudflare/workers-types';
import { Bindings } from '../index';
import { ProgressService } from '../services/progress.service';

export async function scoringConsumer(batch: MessageBatch<any>, env: Bindings, ctx: ExecutionContext) {
  const service = new ProgressService(env.DB);
  
  for (const message of batch.messages) {
    try {
      const { userId, lessonId, answers, persona, progressId, resultAvailableAt } = message.body;
      
      const user = { ai_persona: persona };
      const date = new Date(resultAvailableAt);
      
      await service.runBackgroundScoring(userId, lessonId, answers, env, user, progressId, date);
      
      message.ack();
    } catch (err) {
      console.error('[Scoring Consumer] Message processing failed', err);
      message.retry();
    }
  }
}
