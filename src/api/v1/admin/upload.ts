import { Hono } from 'hono';
import type { Bindings, Variables } from '../../../index';
import { adminGuard } from '../../../middleware/auth';
import { writeAdminAuditLog } from '../../../services/admin-audit.service';

const adminUploadRouter = new Hono<{ Bindings: Bindings, Variables: Variables }>({ strict: false });
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['audio/mpeg', 'mp3'],
  ['audio/wav', 'wav'],
  ['audio/x-wav', 'wav'],
  ['audio/mp4', 'm4a'],
]);

adminUploadRouter.use('/*', adminGuard);

adminUploadRouter.post('/', async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file') as any;

  if (!file || typeof file === 'string') {
    return c.json({ success: false, error: { message: 'No file provided' } }, 400);
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json({ success: false, error: { message: 'File too large' } }, 413);
  }

  const safeExt = ALLOWED_UPLOAD_TYPES.get(file.type);
  if (!safeExt) {
    return c.json({ success: false, error: { message: 'Unsupported file type' } }, 415);
  }

  const originalExt = String(file.name || '').split('.').pop()?.toLowerCase();
  const ext = originalExt === 'jpeg' ? 'jpg' : originalExt;
  if (ext && ext !== safeExt) {
    return c.json({ success: false, error: { message: 'File extension does not match content type' } }, 400);
  }

  const uniqueFilename = `${crypto.randomUUID()}.${safeExt}`;

  try {
    await c.env.MY_BUCKET.put(uniqueFilename, await (file as any).arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    });

    const origin = new URL(c.req.url).origin;
    const fileUrl = `${origin}/api/v1/upload/files/${uniqueFilename}`;

    await writeAdminAuditLog(c, 'upload.create', {
      targetType: 'r2_object',
      targetId: uniqueFilename,
      metadata: { originalName: file.name, contentType: file.type, size: file.size },
    });

    return c.json({
      success: true,
      url: fileUrl,
      filename: file.name
    });
  } catch (e: any) {
    return c.json({ success: false, error: { message: `Upload failed: ${e.message}` } }, 500);
  }
});

export default adminUploadRouter;
