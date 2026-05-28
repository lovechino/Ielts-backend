import { MessageBatch, ExecutionContext } from '@cloudflare/workers-types';
import { Bindings } from '../index';
import { sendEmailViaResend, getWelcomeEmailHtml, getWeeklyReportHtml, EmailPayload } from '../services/email.service';

export async function emailConsumer(batch: MessageBatch<EmailPayload>, env: Bindings, ctx: ExecutionContext) {
  if (!env.RESEND_API_KEY) {
    console.warn('[Email Consumer] RESEND_API_KEY is not set. Skipping email sending.');
    for (const msg of batch.messages) {
      msg.ack();
    }
    return;
  }

  for (const message of batch.messages) {
    try {
      const payload = message.body;
      
      let subject = '';
      let html = '';

      if (payload.type === 'welcome') {
        subject = `Chào mừng ${payload.name} đến với IELTS Peak!`;
        html = getWelcomeEmailHtml(payload.name);
      } else if (payload.type === 'weekly_report') {
        subject = `Báo cáo học tập tuần qua của ${payload.name}`;
        html = getWeeklyReportHtml(payload.name, payload.data);
      } else {
        console.warn(`[Email Consumer] Unknown email type: ${payload.type}`);
        message.ack();
        continue;
      }

      await sendEmailViaResend(env.RESEND_API_KEY, payload.email, subject, html);
      console.log(`[Email Consumer] Sent ${payload.type} email to ${payload.email}`);
      
      message.ack();
    } catch (err) {
      console.error('[Email Consumer] Message processing failed', err);
      message.retry();
    }
  }
}
