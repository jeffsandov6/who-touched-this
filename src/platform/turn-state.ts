import type { CurrentPublicTurnStatus } from './turn-lifecycle';

export interface PublicSiteViewState {
  currentVersion: number;
  totalContributions: number;
  turnStatus: CurrentPublicTurnStatus;
  targetContributionNumber: number | null;
  currentContributor: {
    githubUsername: string;
    displayName: string;
  } | null;
  dueAtMillis: number | null;
}

export interface CountdownState {
  expired: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalSeconds: number;
}

export const DEFAULT_PUBLIC_SITE_STATE: PublicSiteViewState = {
  currentVersion: 0,
  totalContributions: 0,
  turnStatus: 'none',
  targetContributionNumber: null,
  currentContributor: null,
  dueAtMillis: null,
};

export function calculateTargetContributionNumber(currentVersion: number): number {
  if (!Number.isSafeInteger(currentVersion) || currentVersion < 0) {
    throw new Error('current version must be a non-negative safe integer.');
  }
  return currentVersion + 1;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index]);
}

function timestampToMillis(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const toMillis = (value as { toMillis?: unknown }).toMillis;
  if (typeof toMillis !== 'function') return null;

  try {
    const result = toMillis.call(value);
    return typeof result === 'number' && Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

export function tryParsePublicSiteState(data: unknown): PublicSiteViewState | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  if (
    !exactKeys(record, [
      'currentVersion',
      'totalContributions',
      'turnStatus',
      'targetContributionNumber',
      'currentContributor',
      'dueAt',
      'updatedAt',
    ]) ||
    !Number.isSafeInteger(record.currentVersion) ||
    (record.currentVersion as number) < 0 ||
    !Number.isSafeInteger(record.totalContributions) ||
    (record.totalContributions as number) < 0 ||
    timestampToMillis(record.updatedAt) === null
  ) {
    return null;
  }

  if (record.turnStatus === 'none') {
    return record.targetContributionNumber === null &&
      record.currentContributor === null &&
      record.dueAt === null
      ? {
          currentVersion: record.currentVersion as number,
          totalContributions: record.totalContributions as number,
          turnStatus: 'none',
          targetContributionNumber: null,
          currentContributor: null,
          dueAtMillis: null,
        }
      : null;
  }

  if (
    !['active', 'submitted', 'under_review'].includes(record.turnStatus as string) ||
    !Number.isSafeInteger(record.targetContributionNumber) ||
    record.targetContributionNumber !== (record.currentVersion as number) + 1 ||
    !record.currentContributor ||
    typeof record.currentContributor !== 'object'
  ) {
    return null;
  }

  const contributor = record.currentContributor as Record<string, unknown>;
  const dueAtMillis = timestampToMillis(record.dueAt);
  if (
    !exactKeys(contributor, ['githubUsername', 'displayName']) ||
    typeof contributor.githubUsername !== 'string' ||
    !contributor.githubUsername ||
    typeof contributor.displayName !== 'string' ||
    !contributor.displayName ||
    dueAtMillis === null
  ) {
    return null;
  }

  return {
    currentVersion: record.currentVersion as number,
    totalContributions: record.totalContributions as number,
    turnStatus: record.turnStatus as Exclude<CurrentPublicTurnStatus, 'none'>,
    targetContributionNumber: record.targetContributionNumber as number,
    currentContributor: {
      githubUsername: contributor.githubUsername,
      displayName: contributor.displayName,
    },
    dueAtMillis,
  };
}

/** Returns the safe empty state for absent, malformed, or unexpectedly expanded public data. */
export function parsePublicSiteState(data: unknown): PublicSiteViewState {
  return tryParsePublicSiteState(data) ?? DEFAULT_PUBLIC_SITE_STATE;
}

export function getCountdownState(dueAtMillis: number, nowMillis: number): CountdownState {
  const remainingMilliseconds = Math.max(0, dueAtMillis - nowMillis);
  const totalSeconds = Math.max(0, Math.ceil(remainingMilliseconds / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  return {
    expired: dueAtMillis <= nowMillis,
    days,
    hours,
    minutes,
    seconds,
    totalSeconds,
  };
}

export function formatCountdown(state: CountdownState): string {
  if (state.expired) return 'deadline passed';
  const padded = (value: number) => String(value).padStart(2, '0');
  return `${state.days}d ${padded(state.hours)}h ${padded(state.minutes)}m ${padded(state.seconds)}s`;
}
