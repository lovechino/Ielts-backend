import { Hono } from 'hono';
import type { Bindings } from '../../index';

const uploadRouter = new Hono<{ Bindings: Bindings }>({ strict: false });

// POST /api/v1/upload/
uploadRouter.post('/', async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file') as any;

  if (!file || typeof file === 'string') {
    return c.json({ success: false, error: { message: 'No file provided' } }, 400);
  }

  // Generate unique filename
  const ext = file.name.split('.').pop();
  const uniqueFilename = `${crypto.randomUUID()}.${ext}`;

  try {
    // Save to R2
    await c.env.MY_BUCKET.put(uniqueFilename, await (file as any).arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    });

    // Return absolute URL so frontend knows where to fetch the file
    const origin = new URL(c.req.url).origin;
    const fileUrl = `${origin}/api/v1/upload/files/${uniqueFilename}`;
    
    return c.json({
      success: true,
      url: fileUrl,
      filename: file.name
    });
  } catch (e: any) {
    return c.json({ success: false, error: { message: `Upload failed: ${e.message}` } }, 500);
  }
});

// GET /api/v1/upload/files/:filename (Optional: to serve files from R2)
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
