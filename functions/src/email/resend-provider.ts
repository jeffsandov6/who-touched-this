import { Resend } from 'resend';
import type { EmailProvider, SendEmailInput, SendEmailResult } from './types.js';

const FROM = 'who touched this <hello@whotouchedthis.website>';
const REPLY_TO = 'hello@whotouchedthis.website';

export class ResendEmailProvider implements EmailProvider {
  readonly #client: Resend;

  constructor(apiKey: string) {
    if (!apiKey) throw new Error('RESEND_API_KEY is unavailable.');
    this.#client = new Resend(apiKey);
  }

  async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    const { data, error } = await this.#client.emails.send({
      from: FROM,
      replyTo: REPLY_TO,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    }, { idempotencyKey: input.idempotencyKey });
    if (error || !data?.id) {
      const failure = new Error('The email provider rejected the invitation email.');
      failure.name = 'ResendDeliveryError';
      throw failure;
    }
    return { messageId: data.id };
  }
}
