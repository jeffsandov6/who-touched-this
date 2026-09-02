import { buildInvitationEmail } from './template.js';
import type { DeliveryIdentity, DeliveryStore, EmailProvider } from './types.js';

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const INVITATION_KEYS = new Set([
  'githubUserId', 'season', 'status', 'invitedAt', 'acceptBy',
  'turnDurationHours', 'createdAt', 'updatedAt',
]);

interface DateLike {
  toDate(): Date;
}

export interface InvitationCreatedData {
  githubUserId: unknown;
  season: unknown;
  status: unknown;
  invitedAt: unknown;
  acceptBy: unknown;
  turnDurationHours: unknown;
  createdAt: unknown;
  updatedAt: unknown;
  [key: string]: unknown;
}

export interface ContributorEmailData {
  email: unknown;
  displayName: unknown;
  githubUsername?: unknown;
}

export interface InvitationDeliveryDependencies {
  appOrigin: string;
  deliveryStore: DeliveryStore;
  emailProvider: EmailProvider;
  loadContributor(githubUserId: string): Promise<ContributorEmailData | null>;
}

export interface InvitationCreatedInput {
  invitationId: string;
  claimToken: string;
  data: InvitationCreatedData;
}

export type InvitationDeliveryResult =
  | { kind: 'sent' }
  | { kind: 'already-sent' }
  | { kind: 'ignored' }
  | { kind: 'failed'; code: string };

export function invitationDeliveryId(invitationId: string): string {
  if (!invitationId || invitationId.includes('/')) throw new Error('Invitation ID is invalid.');
  return `invitation_${invitationId}`;
}

function isDateLike(value: unknown): value is DateLike {
  return typeof value === 'object' && value !== null && 'toDate' in value
    && typeof value.toDate === 'function';
}

function validPendingInvitation(data: InvitationCreatedData): data is InvitationCreatedData & {
  githubUserId: string;
  season: 1;
  status: 'pending';
  acceptBy: DateLike;
  turnDurationHours: number;
} {
  return Object.keys(data).length === INVITATION_KEYS.size
    && [...INVITATION_KEYS].every((key) => Object.hasOwn(data, key))
    && Object.keys(data).every((key) => INVITATION_KEYS.has(key))
    && typeof data.githubUserId === 'string'
    && /^[0-9]+$/.test(data.githubUserId)
    && data.season === 1
    && data.status === 'pending'
    && isDateLike(data.invitedAt)
    && isDateLike(data.acceptBy)
    && isDateLike(data.createdAt)
    && isDateLike(data.updatedAt)
    && Number.isFinite(data.acceptBy.toDate().getTime())
    && Number.isSafeInteger(data.turnDurationHours)
    && (data.turnDurationHours as number) >= 1
    && (data.turnDurationHours as number) <= 720;
}

function safeFailureCode(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'provider_error';
  }
  return 'provider_error';
}

export async function processInvitationCreated(
  input: InvitationCreatedInput,
  dependencies: InvitationDeliveryDependencies,
): Promise<InvitationDeliveryResult> {
  if (input.data.status !== 'pending') return { kind: 'ignored' };
  if (!validPendingInvitation(input.data)) return { kind: 'failed', code: 'malformed_invitation' };

  const deliveryId = invitationDeliveryId(input.invitationId);
  const identity: DeliveryIdentity = {
    deliveryId,
    invitationId: input.invitationId,
    githubUserId: input.data.githubUserId,
    claimToken: input.claimToken,
  };
  const claim = await dependencies.deliveryStore.claim(identity);
  if (claim.kind === 'already-sent') return { kind: 'already-sent' };
  if (claim.kind === 'busy') throw new Error('Invitation delivery is already in progress.');

  const contributor = await dependencies.loadContributor(input.data.githubUserId);
  if (!contributor) {
    await dependencies.deliveryStore.markFailed(identity, 'missing_contributor');
    return { kind: 'failed', code: 'missing_contributor' };
  }
  if (typeof contributor.email !== 'string' || contributor.email.length > 254
    || !EMAIL_PATTERN.test(contributor.email)) {
    await dependencies.deliveryStore.markFailed(identity, 'missing_contact_email');
    return { kind: 'failed', code: 'missing_contact_email' };
  }
  if (typeof contributor.displayName !== 'string' || !contributor.displayName.trim()
    || contributor.displayName.trim().length > 50) {
    await dependencies.deliveryStore.markFailed(identity, 'invalid_contributor');
    return { kind: 'failed', code: 'invalid_contributor' };
  }

  const email = buildInvitationEmail({
    to: contributor.email,
    displayName: contributor.displayName,
    acceptBy: input.data.acceptBy.toDate(),
    turnDurationHours: input.data.turnDurationHours,
    appOrigin: dependencies.appOrigin,
    idempotencyKey: deliveryId,
  });

  try {
    const result = await dependencies.emailProvider.sendEmail(email);
    await dependencies.deliveryStore.markSent(identity, result.messageId);
    return { kind: 'sent' };
  } catch (error) {
    await dependencies.deliveryStore.markFailed(identity, safeFailureCode(error));
    throw error;
  }
}
