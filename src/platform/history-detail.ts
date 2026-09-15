import { parsePublicContribution, type PublicHistoryItem } from './history.ts';
import { parsePublicContributionSnapshot } from './snapshots/public.ts';

export type PublicContributionDetail = Extract<PublicHistoryItem, { type: 'contribution' }>;

const HISTORY_DETAIL_PATH = /^\/history\/(0|[1-9][0-9]*)\/?$/;

export function contributionNumberFromHistoryPathname(pathname: string): number | null {
  const match = HISTORY_DETAIL_PATH.exec(pathname);
  if (!match) return null;
  const contributionNumber = Number(match[1]);
  return Number.isSafeInteger(contributionNumber) ? contributionNumber : null;
}

export function buildPublicContributionDetail(
  contributionNumber: number,
  contributionData: unknown,
  snapshotData?: unknown,
): PublicContributionDetail | null {
  if (!Number.isSafeInteger(contributionNumber) || contributionNumber < 0) return null;
  const contribution = parsePublicContribution(contributionData);
  if (!contribution || contribution.number !== contributionNumber) return null;
  const parsedSnapshot = snapshotData === undefined ? null : parsePublicContributionSnapshot(snapshotData);
  const snapshot = parsedSnapshot?.contributionNumber === contributionNumber ? parsedSnapshot : null;
  return {
    id: `contribution-${contribution.number}`,
    type: 'contribution',
    contributionKind: contribution.contributionKind,
    season: contribution.season,
    displayName: contribution.displayName,
    ...(contribution.githubUserId ? { githubUserId: contribution.githubUserId } : {}),
    githubUsername: contribution.githubUsername,
    targetContributionNumber: contribution.number,
    contributionNumber: contribution.number,
    occurredAt: contribution.mergedAt,
    summary: contribution.summary,
    ...(contribution.contributorMessage ? { contributorMessage: contribution.contributorMessage } : {}),
    ...(contribution.socialUrl ? { socialUrl: contribution.socialUrl } : {}),
    prNumber: contribution.prNumber,
    prUrl: contribution.prUrl,
    ...(contribution.beforeGitSha && contribution.afterGitSha
      ? { beforeGitSha: contribution.beforeGitSha, afterGitSha: contribution.afterGitSha }
      : {}),
    ...(snapshot ? { snapshot } : {}),
  };
}
