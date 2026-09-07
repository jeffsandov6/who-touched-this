import { normalizePullRequestSubmission } from './turn-lifecycle.ts';
import type { PublicContributionSnapshot } from './snapshots/public.ts';
import { isSafeSocialUrl } from './firebase/join-validation.ts';

export type PublicHistoryItem =
  | {
      id: string;
      type: 'contribution';
      contributionKind: 'community' | 'founder_seed';
      season: number;
      displayName: string;
      githubUsername: string;
      targetContributionNumber: number;
      contributionNumber: number;
      occurredAt: Date;
      summary: string;
      contributorMessage?: string;
      socialUrl?: string;
      prNumber: number;
      prUrl: string;
      beforeGitSha?: string;
      afterGitSha?: string;
      snapshot?: PublicContributionSnapshot;
    }
  | {
      id: string;
      type: 'turn_expired' | 'turn_skipped';
      season: number;
      displayName: string;
      githubUsername: string;
      targetContributionNumber: number;
      occurredAt: Date;
    };

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function asDate(value: unknown): Date | null {
  if (!value || typeof value !== 'object') return null;
  const toDate = (value as { toDate?: unknown }).toDate;
  if (typeof toDate !== 'function') return null;
  try {
    const result = toDate.call(value);
    return result instanceof Date && Number.isFinite(result.getTime()) ? result : null;
  } catch {
    return null;
  }
}

function validPresentation(record: Record<string, unknown>): boolean {
  return (
    typeof record.displayName === 'string' &&
    record.displayName.trim() === record.displayName &&
    record.displayName.length >= 1 &&
    record.displayName.length <= 50 &&
    typeof record.githubUsername === 'string' &&
    /^[A-Za-z0-9-]{1,39}$/.test(record.githubUsername)
  );
}

interface ParsedHistoryEventBase {
  id: string;
  season: number;
  displayName: string;
  githubUsername: string;
  targetContributionNumber: number;
  occurredAt: Date;
}

export type ParsedHistoryEvent =
  | (ParsedHistoryEventBase & { type: 'contribution'; contributionNumber: number; contributionKind: 'community' | 'founder_seed' })
  | (ParsedHistoryEventBase & { type: 'turn_expired' | 'turn_skipped' });

export function parseHistoryEvent(id: string, data: unknown): ParsedHistoryEvent | null {
  if (!id || !data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  const type = record.type;
  const contribution = type === 'contribution';
  const hasKind = 'contributionKind' in record;
  const contributionKind = hasKind ? record.contributionKind : 'community';
  if (
    !['contribution', 'turn_expired', 'turn_skipped'].includes(type as string) ||
    !hasExactKeys(record, [
      'type', 'season', 'displayName', 'githubUsername', 'targetContributionNumber',
      ...(hasKind ? ['contributionKind'] : []),
      ...(contribution ? ['contributionNumber'] : []), 'occurredAt',
    ]) ||
    record.season !== 1 ||
    !validPresentation(record) ||
    !Number.isSafeInteger(record.targetContributionNumber) ||
    (record.targetContributionNumber as number) < 0 ||
    (contribution && !['community', 'founder_seed'].includes(contributionKind as string)) ||
    (!contribution && hasKind) ||
    (contribution && (
      !Number.isSafeInteger(record.contributionNumber) ||
      record.contributionNumber !== record.targetContributionNumber ||
      (contributionKind === 'founder_seed'
        ? record.contributionNumber !== 0
        : (record.contributionNumber as number) < 1)
    )) ||
    (!contribution && (record.targetContributionNumber as number) < 1)
  ) return null;

  const occurredAt = asDate(record.occurredAt);
  if (!occurredAt) return null;
  const base: ParsedHistoryEventBase = {
    id,
    season: 1,
    displayName: record.displayName as string,
    githubUsername: record.githubUsername as string,
    targetContributionNumber: record.targetContributionNumber as number,
    occurredAt,
  };
  return contribution
    ? {
        ...base,
        type: 'contribution',
        contributionNumber: record.contributionNumber as number,
        contributionKind: contributionKind as 'community' | 'founder_seed',
      }
    : { ...base, type: type as 'turn_expired' | 'turn_skipped' };
}

export interface ParsedContribution {
  number: number;
  contributionKind: 'community' | 'founder_seed';
  season: number;
  displayName: string;
  githubUsername: string;
  summary: string;
  contributorMessage?: string;
  socialUrl?: string;
  prNumber: number;
  prUrl: string;
  beforeGitSha?: string;
  afterGitSha?: string;
  mergedAt: Date;
  createdAt: Date;
}

export function parsePublicContribution(data: unknown): ParsedContribution | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  const hasMessage = 'contributorMessage' in record;
  const hasSocialUrl = 'socialUrl' in record;
  const hasKind = 'contributionKind' in record;
  const hasBeforeSha = 'beforeGitSha' in record;
  const hasAfterSha = 'afterGitSha' in record;
  const contributionKind = hasKind ? record.contributionKind : 'community';
  if (
    !hasExactKeys(record, [
      'number', 'season', 'displayName', 'githubUsername', 'summary',
      ...(hasKind ? ['contributionKind'] : []),
      ...(hasMessage ? ['contributorMessage'] : []),
      ...(hasSocialUrl ? ['socialUrl'] : []), 'prNumber', 'prUrl', 'mergedAt', 'createdAt',
      ...(hasBeforeSha ? ['beforeGitSha'] : []),
      ...(hasAfterSha ? ['afterGitSha'] : []),
    ]) ||
    !Number.isSafeInteger(record.number) ||
    (record.number as number) < 0 ||
    !['community', 'founder_seed'].includes(contributionKind as string) ||
    (contributionKind === 'founder_seed' ? record.number !== 0 : (record.number as number) < 1) ||
    (record.number === 0 && contributionKind !== 'founder_seed') ||
    record.season !== 1 ||
    !validPresentation(record) ||
    typeof record.summary !== 'string' ||
    record.summary.trim() !== record.summary ||
    record.summary.length < 1 ||
    record.summary.length > 160 ||
    (hasMessage && (
      typeof record.contributorMessage !== 'string' ||
      record.contributorMessage.trim() !== record.contributorMessage ||
      record.contributorMessage.length < 1 ||
      record.contributorMessage.length > 280
    )) ||
    (hasSocialUrl && !isSafeSocialUrl(record.socialUrl)) ||
    typeof record.prUrl !== 'string' ||
    !Number.isSafeInteger(record.prNumber) ||
    hasBeforeSha !== hasAfterSha ||
    (hasBeforeSha && (
      typeof record.beforeGitSha !== 'string' || typeof record.afterGitSha !== 'string'
      || !/^[0-9a-f]{40}$/.test(record.beforeGitSha)
      || !/^[0-9a-f]{40}$/.test(record.afterGitSha)
      || record.beforeGitSha === record.afterGitSha
    )) ||
    (contributionKind === 'founder_seed' && !hasBeforeSha)
  ) return null;

  try {
    const pullRequest = normalizePullRequestSubmission(record.prUrl, record.prNumber as number);
    if (contributionKind === 'founder_seed'
      && pullRequest.prUrl !== `https://github.com/JeffSandov6/who-touched-this/pull/${record.prNumber}`) return null;
  } catch {
    return null;
  }
  const mergedAt = asDate(record.mergedAt);
  const createdAt = asDate(record.createdAt);
  if (!mergedAt || !createdAt) return null;
  return {
    number: record.number as number,
    contributionKind: contributionKind as 'community' | 'founder_seed',
    season: 1,
    displayName: record.displayName as string,
    githubUsername: record.githubUsername as string,
    summary: record.summary,
    ...(hasMessage ? { contributorMessage: record.contributorMessage as string } : {}),
    ...(hasSocialUrl ? { socialUrl: record.socialUrl as string } : {}),
    prNumber: record.prNumber as number,
    prUrl: record.prUrl,
    ...(hasBeforeSha ? {
      beforeGitSha: record.beforeGitSha as string,
      afterGitSha: record.afterGitSha as string,
    } : {}),
    mergedAt,
    createdAt,
  };
}

export function formatContributionNumber(number: number): string {
  return `#${String(number).padStart(3, '0')}`;
}
