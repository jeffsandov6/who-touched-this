import { githubIdFromAuthToken } from './retry-invitation.js';
import {
  buildContributionEntitlement,
  validateExistingContributionEntitlement,
} from '../wtt/entitlements.js';

export type ResendContributionErrorCode =
  | 'unauthenticated' | 'permission-denied' | 'invalid-argument' | 'failed-precondition';

export class ResendContributionError extends Error {
  constructor(public readonly code: ResendContributionErrorCode, message: string) {
    super(message);
    this.name = 'ResendContributionError';
  }
}

export interface ResendContributionDependencies {
  loadAdmin(id: string): Promise<Record<string, unknown> | null>;
  loadContribution(id: string): Promise<Record<string, unknown> | null>;
  loadEntitlement(id: string): Promise<Record<string, unknown> | null>;
  resend(
    contributionId: string,
    contribution: Record<string, unknown>,
    requestedByGithubUserId: string,
  ): Promise<{ kind: string }>;
}

export async function resendContributionCompletedEmail(
  authToken: Record<string, unknown> | null,
  input: unknown,
  dependencies: ResendContributionDependencies,
): Promise<{ status: string }> {
  if (!authToken) throw new ResendContributionError('unauthenticated', 'authentication is required.');
  const adminId = githubIdFromAuthToken(authToken);
  if (!adminId || !/^[0-9]+$/.test(adminId)) {
    throw new ResendContributionError('permission-denied', 'access denied.');
  }
  const admin = await dependencies.loadAdmin(adminId);
  if (!admin || admin.githubUserId !== adminId || admin.active !== true
    || !['owner', 'admin'].includes(String(admin.role))) {
    throw new ResendContributionError('permission-denied', 'access denied.');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).length !== 1 || !Number.isSafeInteger((input as Record<string, unknown>).contributionNumber)
    || Number((input as Record<string, unknown>).contributionNumber) < 0) {
    throw new ResendContributionError('invalid-argument', 'contribution number is invalid.');
  }
  const contributionId = String((input as Record<string, unknown>).contributionNumber);
  const contribution = await dependencies.loadContribution(contributionId);
  if (!contribution) throw new ResendContributionError('failed-precondition', 'contribution does not exist.');
  const expected = buildContributionEntitlement(contributionId, contribution);
  if (!expected) throw new ResendContributionError('failed-precondition', 'contribution is not eligible for WTT.');
  const entitlement = await dependencies.loadEntitlement(`contribution:${contributionId}`);
  const validation = validateExistingContributionEntitlement(expected, entitlement);
  if (!validation.valid) {
    throw new ResendContributionError('failed-precondition', 'canonical WTT entitlement is missing or inconsistent.');
  }
  const result = await dependencies.resend(contributionId, contribution, adminId);
  return { status: result.kind };
}
