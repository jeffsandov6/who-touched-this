import { deliverNotification, type NotificationDeliveryResult } from './notification-delivery.js';
import { deliveryIds } from './notification-eligibility.js';
import {
  buildContributionCompletedEmail,
  buildDeadlinePassedEmail,
  buildInvitationReminderEmail,
  buildTurnReminderEmail,
  buildTurnStartedEmail,
} from './lifecycle-template.js';
import type { DeliveryIdentity, DeliveryStore, EmailProvider, SendEmailInput } from './types.js';

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface DateLike { toDate(): Date }
export interface ContributorData { email: unknown; displayName: unknown }
export interface FounderOwnerData {
  githubUserId: unknown;
  role: unknown;
  active: unknown;
  founderCompletionEmail: unknown;
}
export interface LifecycleDeliveryDependencies {
  appOrigin: string;
  deliveryStore: DeliveryStore;
  emailProvider: EmailProvider;
  loadContributor(githubUserId: string): Promise<ContributorData | null>;
}

export interface FounderCompletionDeliveryDependencies extends LifecycleDeliveryDependencies {
  loadFounderOwner(githubUserId: string): Promise<FounderOwnerData | null>;
}

export type LifecycleDeliveryResult = NotificationDeliveryResult | { kind: 'failed'; code: string };

function isDateLike(value: unknown): value is DateLike {
  return typeof value === 'object' && value !== null
    && 'toDate' in value && typeof value.toDate === 'function'
    && Number.isFinite(value.toDate().getTime());
}

function validGitHubId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9]+$/.test(value);
}

async function deliverToContributor(
  identity: DeliveryIdentity,
  dependencies: LifecycleDeliveryDependencies,
  build: (recipient: { email: string; displayName: string }) => SendEmailInput,
): Promise<LifecycleDeliveryResult> {
  const claim = await dependencies.deliveryStore.claim(identity);
  if (claim.kind === 'already-sent') return { kind: 'already-sent' };
  if (claim.kind === 'busy') return { kind: 'busy' };
  const contributor = await dependencies.loadContributor(identity.githubUserId);
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
  return deliverNotification(
    identity,
    build({ email: contributor.email, displayName: contributor.displayName }),
    dependencies.deliveryStore,
    dependencies.emailProvider,
    true,
  );
}

async function deliverToFounder(
  identity: DeliveryIdentity,
  displayName: unknown,
  dependencies: FounderCompletionDeliveryDependencies,
  build: (recipient: { email: string; displayName: string }) => SendEmailInput,
): Promise<LifecycleDeliveryResult> {
  const claim = await dependencies.deliveryStore.claim(identity);
  if (claim.kind === 'already-sent') return { kind: 'already-sent' };
  if (claim.kind === 'busy') return { kind: 'busy' };
  const owner = await dependencies.loadFounderOwner(identity.githubUserId);
  if (!owner || owner.githubUserId !== identity.githubUserId
    || owner.role !== 'owner' || owner.active !== true) {
    await dependencies.deliveryStore.markFailed(identity, 'missing_founder_owner');
    return { kind: 'failed', code: 'missing_founder_owner' };
  }
  if (typeof owner.founderCompletionEmail !== 'string'
    || owner.founderCompletionEmail.length > 254
    || !EMAIL_PATTERN.test(owner.founderCompletionEmail)) {
    await dependencies.deliveryStore.markFailed(identity, 'missing_contact_email');
    return { kind: 'failed', code: 'missing_contact_email' };
  }
  if (typeof displayName !== 'string' || !displayName.trim()
    || displayName.trim().length > 50) {
    await dependencies.deliveryStore.markFailed(identity, 'invalid_founder_display_name');
    return { kind: 'failed', code: 'invalid_founder_display_name' };
  }
  return deliverNotification(
    identity,
    build({ email: owner.founderCompletionEmail, displayName }),
    dependencies.deliveryStore,
    dependencies.emailProvider,
    true,
  );
}

export interface InvitationReminderData {
  githubUserId: unknown;
  status: unknown;
  acceptBy: unknown;
  turnDurationHours: unknown;
}

export async function sendInvitationReminder(
  invitationId: string,
  data: InvitationReminderData,
  claimToken: string,
  dependencies: LifecycleDeliveryDependencies,
): Promise<LifecycleDeliveryResult> {
  if (data.status !== 'pending' || !validGitHubId(data.githubUserId)
    || !isDateLike(data.acceptBy) || !Number.isSafeInteger(data.turnDurationHours)
    || (data.turnDurationHours as number) < 1 || (data.turnDurationHours as number) > 720) {
    return { kind: 'failed', code: 'malformed_invitation' };
  }
  const deliveryId = deliveryIds.invitationReminder(invitationId);
  const acceptBy = data.acceptBy;
  const turnDurationHours = data.turnDurationHours as number;
  return deliverToContributor({
    deliveryId, type: 'invitation_reminder', invitationId,
    githubUserId: data.githubUserId, claimToken,
  }, dependencies, ({ email, displayName }) => buildInvitationReminderEmail({
    to: email, displayName, acceptBy: acceptBy.toDate(),
    turnDurationHours,
    appOrigin: dependencies.appOrigin, idempotencyKey: deliveryId,
  }));
}

export interface TurnEmailData {
  githubUserId: unknown;
  status: unknown;
  targetContributionNumber: unknown;
  startedAt: unknown;
  dueAt: unknown;
}

function validTurnData(data: TurnEmailData): data is TurnEmailData & {
  githubUserId: string; targetContributionNumber: number; startedAt: DateLike; dueAt: DateLike;
} {
  return validGitHubId(data.githubUserId)
    && Number.isSafeInteger(data.targetContributionNumber)
    && (data.targetContributionNumber as number) > 0
    && isDateLike(data.startedAt) && isDateLike(data.dueAt);
}

type TurnNotification = 'turn_started' | 'turn_72h_reminder' | 'turn_24h_reminder' | 'turn_deadline_passed';

export async function sendTurnNotification(
  type: TurnNotification,
  turnId: string,
  data: TurnEmailData,
  claimToken: string,
  dependencies: LifecycleDeliveryDependencies,
): Promise<LifecycleDeliveryResult> {
  if (!validTurnData(data) || data.status !== 'active') {
    return { kind: 'failed', code: 'malformed_turn' };
  }
  const deliveryId = type === 'turn_started' ? deliveryIds.turnStarted(turnId)
    : type === 'turn_72h_reminder' ? deliveryIds.turn72HourReminder(turnId)
      : type === 'turn_24h_reminder' ? deliveryIds.turn24HourReminder(turnId)
        : deliveryIds.turnDeadlinePassed(turnId);
  return deliverToContributor({
    deliveryId, type, turnId, githubUserId: data.githubUserId, claimToken,
  }, dependencies, ({ email, displayName }) => {
    const turnDurationHours = Math.round(
      (data.dueAt.toDate().getTime() - data.startedAt.toDate().getTime()) / (60 * 60 * 1_000),
    );
    if (!Number.isSafeInteger(turnDurationHours) || turnDurationHours < 1 || turnDurationHours > 720) {
      throw new Error('Contribution duration is invalid.');
    }
    const base = {
      to: email, displayName, targetContributionNumber: data.targetContributionNumber,
      dueAt: data.dueAt.toDate(), turnDurationHours,
      appOrigin: dependencies.appOrigin, idempotencyKey: deliveryId,
    };
    if (type === 'turn_started') return buildTurnStartedEmail(base);
    if (type === 'turn_72h_reminder') return buildTurnReminderEmail(base, 72);
    if (type === 'turn_24h_reminder') return buildTurnReminderEmail(base, 24);
    return buildDeadlinePassedEmail(base);
  });
}

export interface ContributionData {
  number: unknown;
  githubUserId: unknown;
  contributionKind?: unknown;
  displayName?: unknown;
  summary: unknown;
  prUrl: unknown;
}

interface ContributionDeliveryOptions {
  turnId?: string;
  deliveryId?: string;
  type?: 'contribution_completed' | 'contribution_completed_resend';
  requestedByGithubUserId?: string;
}

export async function sendContributionCompletedFromContribution(
  contributionId: string,
  contribution: ContributionData,
  claimToken: string,
  dependencies: LifecycleDeliveryDependencies,
  options: ContributionDeliveryOptions = {},
): Promise<LifecycleDeliveryResult> {
  if (!/^(0|[1-9][0-9]*)$/.test(contributionId)
    || !Number.isSafeInteger(contribution.number)
    || contribution.number !== Number(contributionId)
    || !validGitHubId(contribution.githubUserId)
    || typeof contribution.summary !== 'string' || !contribution.summary.trim()
    || typeof contribution.prUrl !== 'string') {
    return { kind: 'failed', code: 'malformed_contribution' };
  }
  const number = contribution.number as number;
  const deliveryId = options.deliveryId ?? deliveryIds.contributionCompleted(number);
  return deliverToContributor({
    deliveryId,
    type: options.type ?? 'contribution_completed',
    ...(options.turnId ? { turnId: options.turnId } : {}),
    contributionNumber: number,
    githubUserId: contribution.githubUserId,
    claimToken,
    ...(options.requestedByGithubUserId
      ? { requestedByGithubUserId: options.requestedByGithubUserId }
      : {}),
  }, dependencies, ({ email, displayName }) => buildContributionCompletedEmail({
    to: email, displayName, contributionNumber: number,
    summary: contribution.summary as string, prUrl: contribution.prUrl as string,
    appOrigin: dependencies.appOrigin, idempotencyKey: deliveryId,
  }));
}

export async function sendFounderContributionCompletedFromContribution(
  contributionId: string,
  contribution: ContributionData,
  claimToken: string,
  dependencies: FounderCompletionDeliveryDependencies,
  options: ContributionDeliveryOptions = {},
): Promise<LifecycleDeliveryResult> {
  if (contributionId !== '0' || contribution.number !== 0
    || contribution.contributionKind !== 'founder_seed'
    || !validGitHubId(contribution.githubUserId)
    || typeof contribution.summary !== 'string' || !contribution.summary.trim()
    || typeof contribution.prUrl !== 'string') {
    return { kind: 'failed', code: 'malformed_founder_contribution' };
  }
  const deliveryId = options.deliveryId ?? deliveryIds.contributionCompleted(0);
  return deliverToFounder({
    deliveryId,
    type: options.type ?? 'contribution_completed',
    contributionNumber: 0,
    githubUserId: contribution.githubUserId,
    claimToken,
    ...(options.requestedByGithubUserId
      ? { requestedByGithubUserId: options.requestedByGithubUserId }
      : {}),
  }, contribution.displayName, dependencies, ({ email, displayName }) => buildContributionCompletedEmail({
    to: email, displayName, contributionNumber: 0,
    summary: contribution.summary as string, prUrl: contribution.prUrl as string,
    appOrigin: dependencies.appOrigin, idempotencyKey: deliveryId,
  }));
}

export async function sendContributionCompleted(
  turnId: string,
  turn: TurnEmailData,
  contribution: ContributionData,
  claimToken: string,
  dependencies: LifecycleDeliveryDependencies,
): Promise<LifecycleDeliveryResult> {
  if (turn.status !== 'merged' || !validTurnData(turn)
    || !Number.isSafeInteger(contribution.number) || contribution.number !== turn.targetContributionNumber
    || contribution.githubUserId !== turn.githubUserId
    || typeof contribution.summary !== 'string' || !contribution.summary.trim()
    || typeof contribution.prUrl !== 'string') {
    return { kind: 'failed', code: 'malformed_contribution' };
  }
  return sendContributionCompletedFromContribution(
    String(contribution.number), contribution, claimToken, dependencies, { turnId },
  );
}
