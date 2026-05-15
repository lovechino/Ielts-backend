import { Hono } from 'hono';
import { VocabularyService } from '../../services/vocabulary.service';
import type { Bindings } from '../../index';

const vocabRouter = new Hono<{ Bindings: Bindings }>({ strict: false });

// GET /api/v1/vocabulary/
vocabRouter.get('/', async (c) => {
  const level = c.req.query('level');
  const topic = c.req.query('topic');
  const limit = c.req.query('limit');
  const offset = c.req.query('offset');

  const service = new VocabularyService(c.env.DB, c.env.CACHE);
  const words = await service.getAll({
    level,
    topic,
    limit: limit ? parseInt(limit) : undefined,
    offset: offset ? parseInt(offset) : undefined
  });
  
  return c.json({ success: true, data: words });
});

// GET /api/v1/vocabulary/:word
vocabRouter.get('/:word', async (c) => {
  const word = c.req.param('word');
  const service = new VocabularyService(c.env.DB, c.env.CACHE);
  const data = await service.getByWord(word);
  
  if (!data) {
    return c.json({ success: false, error: { message: 'Word not found' } }, 404);
  }
  return c.json({ success: true, data });
});

export default vocabRouter;
