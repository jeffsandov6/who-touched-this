import { deliverNotification, type NotificationDeliveryResult } from './notification-delivery.js';
import { deliveryIds } from './notification-eligibility.js';
import { applicationUrl, formatInvitationDate } from './template.js';
import { copy, renderAdminEmail } from './email-shell.js';
import type { DeliveryIdentity, DeliveryStore, EmailProvider, SendEmailInput } from './types.js';

export const ADMIN_NOTIFICATION_EMAIL = 'hello@whotouchedthis.website';

interface DateLike { toDate(): Date }

export interface SubmittedTurnData {
  githubUserId: unknown;
  status: unknown;
  targetContributionNumber: unknown;
  prNumber?: unknown;
  prUrl?: unknown;
  submittedAt?: unknown;
}

export interface AdminContributorData {
  displayName: unknown;
  githubUsername?: unknown;
}

export interface AdminSubmissionDependencies {
  appOrigin: string;
  expectedRepository: string;
  deliveryStore: DeliveryStore;
  emailProvider: EmailProvider;
  loadContributor(githubUserId: string): Promise<AdminContributorData | null>;
}

export type AdminSubmissionDeliveryResult = NotificationDeliveryResult
  | { kind: 'ignored' }
  | { kind: 'failed'; code: string };

function dateLike(value: unknown): value is DateLike {
  return typeof value === 'object' && value !== null
    && 'toDate' in value && typeof value.toDate === 'function'
    && Number.isFinite(value.toDate().getTime());
}

function githubPullRequest(value: unknown, number: number, expectedRepository: string): string | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  const repositoryMatch = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(expectedRepository.trim());
  if (!repositoryMatch) return null;
  try {
    const url = new URL(value);
    const pathMatch = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)\/?$/.exec(url.pathname);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com'
      || url.username || url.password || url.search || url.hash
      || !pathMatch || pathMatch[3] !== String(number)
      || pathMatch[1]!.toLowerCase() !== repositoryMatch[1]!.toLowerCase()
      || pathMatch[2]!.toLowerCase() !== repositoryMatch[2]!.toLowerCase()) {
      return null;
    }
    return url.toString();
  } catch { return null; }
}

function contributorPresentation(data: AdminContributorData | null) {
  if (!data || typeof data.displayName !== 'string') return null;
  const displayName = data.displayName.trim();
  if (!displayName || displayName.length > 50) return null;
  const githubUsername = typeof data.githubUsername === 'string'
    && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(data.githubUsername)
    ? data.githubUsername
    : undefined;
  return { displayName, ...(githubUsername ? { githubUsername } : {}) };
}

export function buildAdminPrSubmittedEmail(input: {
  displayName: string;
  githubUsername?: string;
  contributionNumber: number;
  prNumber: number;
  prUrl: string;
  submittedAt: Date;
  appOrigin: string;
  expectedRepository: string;
  idempotencyKey: string;
}): SendEmailInput {
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 50
    || !Number.isSafeInteger(input.contributionNumber) || input.contributionNumber < 1
    || !Number.isSafeInteger(input.prNumber) || input.prNumber < 1
    || !Number.isFinite(input.submittedAt.getTime())
    || (input.githubUsername !== undefined
      && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(input.githubUsername))) {
    throw new Error('Admin PR-submission email input is invalid.');
  }
  const prUrl = githubPullRequest(input.prUrl, input.prNumber, input.expectedRepository);
  if (!prUrl) throw new Error('Admin PR-submission email PR URL is invalid.');
  const number = String(input.contributionNumber).padStart(3, '0');
  const submitted = formatInvitationDate(input.submittedAt);
  const adminUrl = applicationUrl(input.appOrigin, '/admin');
  const identity = input.githubUsername ? `GitHub: @${input.githubUsername}` : undefined;
  const lines = [
    `${displayName} submitted PR #${input.prNumber} for contribution #${number}.`,
    ...(identity ? [identity] : []),
    `Submitted: ${submitted}`,
    '',
    `Review PR: ${prUrl}`,
    `Open Admin: ${adminUrl}`,
  ];
  return renderAdminEmail({
    to: ADMIN_NOTIFICATION_EMAIL,
    subject: `Who Touched This: PR submitted — #${number}`,
    preheader: `${displayName} submitted PR #${input.prNumber}.`,
    appOrigin: input.appOrigin,
    idempotencyKey: input.idempotencyKey,
    headline: `PR submitted for Contribution #${number}`,
    paragraphs: [
      copy(`${displayName} submitted PR #${input.prNumber} for Contribution #${number}.`),
      ...(identity ? [copy(identity)] : []),
      copy(`Submitted: ${submitted}`),
    ],
    actions: [
      { label: 'Review PR', url: prUrl },
      { label: 'Open Admin', url: adminUrl },
    ],
    plainText: lines.join('\n'),
  });
}

export async function processAdminPrSubmission(
  turnId: string,
  before: SubmittedTurnData,
  after: SubmittedTurnData,
  claimToken: string,
  dependencies: AdminSubmissionDependencies,
): Promise<AdminSubmissionDeliveryResult> {
  if (before.status !== 'active' || after.status !== 'submitted') return { kind: 'ignored' };
  if (!turnId || turnId.includes('/') || typeof after.githubUserId !== 'string'
    || !/^[0-9]+$/.test(after.githubUserId)
    || !Number.isSafeInteger(after.targetContributionNumber)
    || (after.targetContributionNumber as number) < 1
    || !Number.isSafeInteger(after.prNumber) || (after.prNumber as number) < 1
    || !dateLike(after.submittedAt)) {
    return { kind: 'failed', code: 'malformed_submission' };
  }
  const prNumber = after.prNumber as number;
  const prUrl = githubPullRequest(after.prUrl, prNumber, dependencies.expectedRepository);
  if (!prUrl) return { kind: 'failed', code: 'malformed_submission' };

  const deliveryId = deliveryIds.prSubmitted(turnId);
  const identity: DeliveryIdentity = {
    deliveryId,
    type: 'pr_submitted',
    turnId,
    contributionNumber: after.targetContributionNumber as number,
    githubUserId: after.githubUserId,
    claimToken,
  };
  const claim = await dependencies.deliveryStore.claim(identity);
  if (claim.kind === 'already-sent') return { kind: 'already-sent' };
  if (claim.kind === 'busy') return { kind: 'busy' };

  const contributor = contributorPresentation(await dependencies.loadContributor(after.githubUserId));
  if (!contributor) {
    await dependencies.deliveryStore.markFailed(identity, 'invalid_contributor');
    return { kind: 'failed', code: 'invalid_contributor' };
  }
  return deliverNotification(identity, buildAdminPrSubmittedEmail({
    ...contributor,
    contributionNumber: after.targetContributionNumber as number,
    prNumber,
    prUrl,
    submittedAt: after.submittedAt.toDate(),
    appOrigin: dependencies.appOrigin,
    expectedRepository: dependencies.expectedRepository,
    idempotencyKey: deliveryId,
  }), dependencies.deliveryStore, dependencies.emailProvider, true);
}
