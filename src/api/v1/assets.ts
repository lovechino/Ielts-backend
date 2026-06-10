import { Hono } from 'hono';
import { Bindings } from '../../index';

const assetsRouter = new Hono<{ Bindings: Bindings }>();

/**
 * GET /assets/models/:filename
 * Phục vụ các mô hình AI ONNX từ Cloudflare R2.
 * Hỗ trợ Tier 2 (Mobile Edge).
 */
assetsRouter.get('/models/:filename', async (c) => {
  const filename = c.req.param('filename');
  const bucketKey = `models/${filename}`;

  const object = await c.env.MY_BUCKET.get(bucketKey);

  if (!object) {
    return c.json({ success: false, error: 'Model not found' }, 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable'); // Cache 1 năm

  return new Response(object.body, {
    headers,
  });
});

export default assetsRouter;
