import { githubIdFromAuthToken } from '../email/retry-invitation.js';

const DISPLAY_NAME_MAX = 50;
const SUMMARY_MAX = 160;
const MESSAGE_MAX = 280;
const GIT_SHA = /^[0-9a-f]{40}$/;
const CANONICAL_REPOSITORY = 'JeffSandov6/who-touched-this';

export type FounderSeedErrorCode =
  | 'unauthenticated'
  | 'permission-denied'
  | 'invalid-argument'
  | 'failed-precondition';

export class FounderSeedError extends Error {
  constructor(public readonly code: FounderSeedErrorCode, message: string) {
    super(message);
    this.name = 'FounderSeedError';
  }
}

export interface FounderSeedInput {
  publicDisplayName: string;
  prNumber: number;
  summary: string;
  contributorMessage?: string;
  beforeGitSha: string;
  afterGitSha: string;
}

interface FounderSeedTransaction {
  loadAdmin(githubUserId: string): Promise<Record<string, unknown> | null>;
  loadPrivateSite(): Promise<Record<string, unknown> | null>;
  loadPublicSite(): Promise<Record<string, unknown> | null>;
  anyContributionExists(): Promise<boolean>;
  founderContributionExists(): Promise<boolean>;
  founderHistoryExists(): Promise<boolean>;
  createContribution(data: Record<string, unknown>): void;
  createHistory(data: Record<string, unknown>): void;
  setPublicSite(data: Record<string, unknown>): void;
  setPrivateSite(data: Record<string, unknown>): void;
}

export interface FounderSeedDependencies {
  canonicalRepository: string;
  timestamp(): unknown;
  runTransaction<T>(operation: (transaction: FounderSeedTransaction) => Promise<T>): Promise<T>;
}

function trimmedString(value: unknown, label: string, maximum: number, optional = false): string | undefined {
  if (optional && value === undefined) return undefined;
  if (typeof value !== 'string') throw new FounderSeedError('invalid-argument', `${label} is invalid.`);
  const trimmed = value.trim();
  if ((!optional && !trimmed) || trimmed.length > maximum) {
    throw new FounderSeedError('invalid-argument', `${label} is invalid.`);
  }
  return trimmed || undefined;
}

export function validateFounderSeedInput(value: unknown): FounderSeedInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FounderSeedError('invalid-argument', 'founder contribution #000 details are invalid.');
  }
  const input = value as Record<string, unknown>;
  const allowed = ['afterGitSha', 'beforeGitSha', 'contributorMessage', 'prNumber', 'publicDisplayName', 'summary'];
  if (Object.keys(input).some((key) => !allowed.includes(key))
    || !['afterGitSha', 'beforeGitSha', 'prNumber', 'publicDisplayName', 'summary'].every((key) => key in input)) {
    throw new FounderSeedError('invalid-argument', 'founder contribution #000 details are invalid.');
  }
  const publicDisplayName = trimmedString(input.publicDisplayName, 'public founder name', DISPLAY_NAME_MAX)!;
  const summary = trimmedString(input.summary, 'contribution summary', SUMMARY_MAX)!;
  const contributorMessage = trimmedString(input.contributorMessage, 'founder message', MESSAGE_MAX, true);
  if (!Number.isSafeInteger(input.prNumber) || Number(input.prNumber) < 1) {
    throw new FounderSeedError('invalid-argument', 'GitHub pull request number is invalid.');
  }
  if (typeof input.beforeGitSha !== 'string' || typeof input.afterGitSha !== 'string') {
    throw new FounderSeedError('invalid-argument', 'git provenance is invalid.');
  }
  const beforeGitSha = input.beforeGitSha.toLowerCase();
  const afterGitSha = input.afterGitSha.toLowerCase();
  if (!GIT_SHA.test(beforeGitSha) || !GIT_SHA.test(afterGitSha) || beforeGitSha === afterGitSha) {
    throw new FounderSeedError('invalid-argument', 'git provenance is invalid.');
  }
  return {
    publicDisplayName,
    prNumber: input.prNumber as number,
    summary,
    ...(contributorMessage ? { contributorMessage } : {}),
    beforeGitSha,
    afterGitSha,
  };
}

function validInactivePublicSite(site: Record<string, unknown> | null): boolean {
  return site === null || (
    site.currentVersion === 0
    && site.totalContributions === 0
    && site.turnStatus === 'none'
    && site.targetContributionNumber === null
    && site.currentContributor === null
    && site.dueAt === null
  );
}

function validUnlockedPrivateSite(site: Record<string, unknown> | null): boolean {
  return site === null || (site.activeTurnId === null && site.pendingInvitationId === null
    && (site.pendingArchiveContributionNumber ?? null) === null);
}

export async function recordFounderSeedContribution(
  authToken: Record<string, unknown> | null,
  rawInput: unknown,
  dependencies: FounderSeedDependencies,
): Promise<{ status: 'recorded'; contributionNumber: 0 }> {
  if (!authToken) throw new FounderSeedError('unauthenticated', 'authentication is required.');
  const githubUserId = githubIdFromAuthToken(authToken);
  if (!githubUserId || !/^[0-9]+$/.test(githubUserId)) {
    throw new FounderSeedError('permission-denied', 'access denied.');
  }
  const repositoryParts = dependencies.canonicalRepository.split('/');
  const githubUsername = repositoryParts[0] ?? '';
  const repositoryName = repositoryParts[1] ?? '';
  if (dependencies.canonicalRepository !== CANONICAL_REPOSITORY
    || repositoryParts.length !== 2 || !/^[A-Za-z0-9-]{1,39}$/.test(githubUsername)
    || !/^[A-Za-z0-9_.-]+$/.test(repositoryName)) {
    throw new FounderSeedError('failed-precondition', 'canonical GitHub repository configuration is invalid.');
  }

  return dependencies.runTransaction(async (transaction) => {
    const [admin, privateSite, publicSite, anyContribution, founderContribution, founderHistory] = await Promise.all([
      transaction.loadAdmin(githubUserId),
      transaction.loadPrivateSite(),
      transaction.loadPublicSite(),
      transaction.anyContributionExists(),
      transaction.founderContributionExists(),
      transaction.founderHistoryExists(),
    ]);
    if (!admin || admin.githubUserId !== githubUserId || admin.active !== true || admin.role !== 'owner') {
      throw new FounderSeedError('permission-denied', 'only the active owner can record founder contribution #000.');
    }
    const input = validateFounderSeedInput(rawInput);
    if (founderContribution || founderHistory) {
      throw new FounderSeedError('failed-precondition', 'founder contribution #000 has already been recorded.');
    }
    if (anyContribution) {
      throw new FounderSeedError('failed-precondition', 'founder contribution #000 must precede every permanent contribution.');
    }
    if (!validUnlockedPrivateSite(privateSite) || !validInactivePublicSite(publicSite)) {
      throw new FounderSeedError('failed-precondition', 'founder contribution #000 cannot be recorded during an invitation or turn.');
    }

    const timestamp = dependencies.timestamp();
    const prUrl = `https://github.com/${githubUsername}/${repositoryName}/pull/${input.prNumber}`;
    transaction.createContribution({
      number: 0,
      season: 1,
      contributionKind: 'founder_seed',
      githubUserId,
      displayName: input.publicDisplayName,
      githubUsername,
      summary: input.summary,
      ...(input.contributorMessage ? { contributorMessage: input.contributorMessage } : {}),
      prNumber: input.prNumber,
      prUrl,
      beforeGitSha: input.beforeGitSha,
      afterGitSha: input.afterGitSha,
      archiveStatus: 'pending',
      mergedAt: timestamp,
      createdAt: timestamp,
    });
    transaction.createHistory({
      type: 'contribution',
      contributionKind: 'founder_seed',
      season: 1,
      displayName: input.publicDisplayName,
      githubUsername,
      targetContributionNumber: 0,
      contributionNumber: 0,
      occurredAt: timestamp,
    });
    transaction.setPublicSite({
      currentVersion: 0,
      totalContributions: 1,
      turnStatus: 'none',
      targetContributionNumber: null,
      currentContributor: null,
      dueAt: null,
      updatedAt: timestamp,
    });
    transaction.setPrivateSite({
      activeTurnId: null,
      pendingInvitationId: null,
      pendingArchiveContributionNumber: 0,
      updatedAt: timestamp,
    });
    return { status: 'recorded', contributionNumber: 0 };
  });
}
