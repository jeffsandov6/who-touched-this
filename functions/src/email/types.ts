export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}

export interface SendEmailResult {
  messageId: string;
}

export interface EmailProvider {
  sendEmail(input: SendEmailInput): Promise<SendEmailResult>;
}

export type EmailDeliveryStatus = 'sending' | 'sent' | 'failed';

export interface DeliveryClaim {
  kind: 'claimed' | 'already-sent' | 'busy';
}

export interface DeliveryIdentity {
  deliveryId: string;
  invitationId: string;
  githubUserId: string;
  claimToken: string;
}

export interface DeliveryStore {
  claim(identity: DeliveryIdentity): Promise<DeliveryClaim>;
  markSent(identity: DeliveryIdentity, providerMessageId: string): Promise<void>;
  markFailed(identity: DeliveryIdentity, failureCode: string): Promise<void>;
}
