import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { dailyChallenges } from '../../../db/schema';
import type { Bindings } from '../../../index';
import { AIService } from '../../../services/ai.service';

const adminDailyRouter = new Hono<{ Bindings: Bindings }>();

// POST /api/v1/admin/daily/generate - Generate challenge from raw text
adminDailyRouter.post('/generate', async (c) => {
  const { raw_text } = await c.req.json();

  if (!raw_text) {
    return c.json({ success: false, message: 'Missing raw_text' }, 422);
  }

  try {
    const aiService = new AIService(c.env.AI, c.env.CACHE);
    const generated = await aiService.generateDailyChallenge(raw_text);
    
    return c.json({ 
      success: true, 
      data: generated 
    });
  } catch (error: any) {
    console.error('Generation Error:', error);
    return c.json({ success: false, message: error.message }, 500);
  }
});

// POST /api/v1/admin/daily/push - Manually push a generated challenge
adminDailyRouter.post('/push', async (c) => {
  const db = drizzle(c.env.DB);
  const body = await c.req.json();
  const { date, content } = body;

  if (!date || !content) {
    return c.json({ success: false, message: 'Missing date or content' }, 422);
  }

  try {
    await db.insert(dailyChallenges)
      .values({
        id: crypto.randomUUID(),
        challenge_date: date, // YYYY-MM-DD
        topic: content.metadata?.topic || 'General',
        content: content,
      })
      .onConflictDoUpdate({
        target: dailyChallenges.challenge_date,
        set: { 
          topic: content.metadata?.topic || 'General',
          content: content 
        }
      })
      .run();

    return c.json({ success: true, message: `Challenge for ${date} pushed successfully` });
  } catch (error: any) {
    return c.json({ success: false, message: error.message }, 500);
  }
});

export default adminDailyRouter;
