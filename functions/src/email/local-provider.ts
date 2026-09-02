import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import type { EmailProvider, SendEmailInput, SendEmailResult } from './types.js';

/** Emulator-only mailbox. Browser access is denied by Firestore Rules. */
export class LocalMailboxEmailProvider implements EmailProvider {
  constructor(private readonly firestore: Firestore) {}

  async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    const reference = this.firestore.doc(`devEmailSink/${input.idempotencyKey}`);
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (snapshot.exists) {
        return { messageId: String(snapshot.data()?.messageId ?? `local_${input.idempotencyKey}`) };
      }
      const messageId = `local_${input.idempotencyKey}`;
      transaction.create(reference, {
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        idempotencyKey: input.idempotencyKey,
        messageId,
        createdAt: FieldValue.serverTimestamp(),
      });
      return { messageId };
    });
  }
}

export class FailingEmailProvider implements EmailProvider {
  async sendEmail(_input: SendEmailInput): Promise<never> {
    const error = new Error('Simulated local email delivery failure.');
    error.name = 'SimulatedDeliveryError';
    throw error;
  }
}
