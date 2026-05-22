import { Hono } from 'hono';
import type { Bindings } from '../../index';

const uploadRouter = new Hono<{ Bindings: Bindings }>({ strict: false });

uploadRouter.get('/files/:filename', async (c) => {
  const filename = c.req.param('filename');
  const object = await c.env.MY_BUCKET.get(filename);

  if (!object) {
    return c.text('File not found', 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);

  return new Response(object.body, {
    headers,
  });
});

export default uploadRouter;
