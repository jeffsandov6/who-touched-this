import type {
  DeliveryIdentity,
  DeliveryStore,
  EmailProvider,
  SendEmailInput,
} from './types.js';

export type NotificationDeliveryResult =
  | { kind: 'sent' }
  | { kind: 'already-sent' }
  | { kind: 'busy' };

function safeFailureCode(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'provider_error';
  }
  return 'provider_error';
}

export async function deliverNotification(
  identity: DeliveryIdentity,
  email: SendEmailInput,
  deliveryStore: DeliveryStore,
  emailProvider: EmailProvider,
  alreadyClaimed = false,
): Promise<NotificationDeliveryResult> {
  if (!alreadyClaimed) {
    const claim = await deliveryStore.claim(identity);
    if (claim.kind === 'already-sent') return { kind: 'already-sent' };
    if (claim.kind === 'busy') return { kind: 'busy' };
  }

  try {
    const result = await emailProvider.sendEmail(email);
    await deliveryStore.markSent(identity, result.messageId);
    return { kind: 'sent' };
  } catch (error) {
    await deliveryStore.markFailed(identity, safeFailureCode(error));
    throw error;
  }
}
