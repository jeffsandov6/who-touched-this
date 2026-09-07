export type RetryErrorCode = 'unauthenticated' | 'permission-denied' | 'invalid-argument' | 'failed-precondition';

export class RetryInvitationError extends Error {
  constructor(public readonly code: RetryErrorCode, message: string) {
    super(message);
    this.name = 'RetryInvitationError';
  }
}

interface AdminData { githubUserId?: unknown; active?: unknown; role?: unknown }
interface InvitationData { status?: unknown }
interface DeliveryData { status?: unknown }

export interface RetryInvitationDependencies {
  loadAdmin(githubUserId: string): Promise<AdminData | null>;
  loadInvitation(invitationId: string): Promise<InvitationData | null>;
  loadDelivery(invitationId: string): Promise<DeliveryData | null>;
  retry(invitationId: string, invitation: InvitationData): Promise<{ kind: string }>;
}

export function githubIdFromAuthToken(token: Record<string, unknown> | null): string | null {
  if (!token) return null;
  const firebase = token.firebase;
  if (!firebase || typeof firebase !== 'object') return null;
  const identities = (firebase as { identities?: unknown }).identities;
  if (!identities || typeof identities !== 'object') return null;
  const ids = (identities as Record<string, unknown>)['github.com'];
  return Array.isArray(ids) && ids.length === 1 && typeof ids[0] === 'string' && ids[0]
    ? ids[0]
    : null;
}

export async function retryInvitationDelivery(
  authToken: Record<string, unknown> | null,
  input: unknown,
  dependencies: RetryInvitationDependencies,
): Promise<{ status: string }> {
  if (!authToken) throw new RetryInvitationError('unauthenticated', 'authentication is required.');
  const githubUserId = githubIdFromAuthToken(authToken);
  if (!githubUserId) throw new RetryInvitationError('permission-denied', 'access denied.');
  const admin = await dependencies.loadAdmin(githubUserId);
  if (!admin || admin.githubUserId !== githubUserId || admin.active !== true
    || !['owner', 'admin'].includes(String(admin.role))) {
    throw new RetryInvitationError('permission-denied', 'access denied.');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).length !== 1 || !('invitationId' in input)
    || typeof input.invitationId !== 'string' || !input.invitationId
    || input.invitationId.includes('/')) {
    throw new RetryInvitationError('invalid-argument', 'invitation identifier is invalid.');
  }
  const invitationId = input.invitationId;
  const invitation = await dependencies.loadInvitation(invitationId);
  if (!invitation || invitation.status !== 'pending') {
    throw new RetryInvitationError('failed-precondition', 'this invitation is no longer pending.');
  }
  const delivery = await dependencies.loadDelivery(invitationId);
  if (delivery?.status === 'sent') return { status: 'already-sent' };
  if (delivery?.status !== 'failed') {
    throw new RetryInvitationError('failed-precondition', 'this email is not currently retryable.');
  }
  const result = await dependencies.retry(invitationId, invitation);
  return { status: result.kind };
}
