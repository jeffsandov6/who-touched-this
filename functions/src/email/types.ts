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

export type EmailDeliveryType =
  | 'invitation'
  | 'invitation_reminder'
  | 'turn_started'
  | 'turn_72h_reminder'
  | 'turn_24h_reminder'
  | 'turn_deadline_passed'
  | 'pr_submitted'
  | 'contribution_completed'
  | 'contribution_completed_resend';

export interface DeliveryClaim {
  kind: 'claimed' | 'already-sent' | 'busy';
}

export interface DeliveryIdentity {
  deliveryId: string;
  type: EmailDeliveryType;
  invitationId?: string;
  turnId?: string;
  contributionNumber?: number;
  requestedByGithubUserId?: string;
  githubUserId: string;
  claimToken: string;
}

export interface DeliveryStore {
  claim(identity: DeliveryIdentity): Promise<DeliveryClaim>;
  markSent(identity: DeliveryIdentity, providerMessageId: string): Promise<void>;
  markFailed(identity: DeliveryIdentity, failureCode: string): Promise<void>;
}
