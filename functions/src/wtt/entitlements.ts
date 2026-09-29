export const WTT_CONTRIBUTION_AMOUNT = 1 as const;

export interface WttContributionEntitlementRecord {
  sourceType: 'contribution';
  sourceId: string;
  githubProviderId: string;
  contributorId: string;
  amount: typeof WTT_CONTRIBUTION_AMOUNT;
  status: 'unclaimed';
  claimId: null;
  earnedAt: unknown;
  claimedAt: null;
  claimedWallet: null;
  claimTransaction: null;
}

export interface WttEntitlementStore {
  createIfAbsent(
    entitlementId: string,
    record: WttContributionEntitlementRecord,
  ): Promise<'created' | 'already_exists'>;
}

export type GrantContributionEntitlementResult =
  | { status: 'created' | 'already_exists'; entitlementId: string }
  | { status: 'ineligible' };

function validTimestamp(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const toMillis = (value as { toMillis?: unknown }).toMillis;
  if (typeof toMillis !== 'function') return false;
  try {
    return Number.isFinite(toMillis.call(value));
  } catch {
    return false;
  }
}

export function contributionEntitlementId(contributionNumber: number): string {
  if (!Number.isSafeInteger(contributionNumber) || contributionNumber < 0) {
    throw new Error('contribution number must be a non-negative safe integer.');
  }
  return `contribution:${contributionNumber}`;
}

export function buildContributionEntitlement(
  contributionId: string,
  contribution: Record<string, unknown>,
): WttContributionEntitlementRecord | null {
  if (!/^(0|[1-9][0-9]*)$/.test(contributionId)) return null;
  const contributionNumber = Number(contributionId);
  if (!Number.isSafeInteger(contributionNumber)
    || contribution.number !== contributionNumber
    || typeof contribution.githubUserId !== 'string'
    || !/^[0-9]+$/.test(contribution.githubUserId)
    || !Number.isSafeInteger(contribution.season)
    || (contribution.season as number) < 1
    || !validTimestamp(contribution.mergedAt)
    || (contribution.contributionKind !== undefined
      && contribution.contributionKind !== 'community'
      && contribution.contributionKind !== 'founder_seed')) return null;

  return {
    sourceType: 'contribution',
    sourceId: contributionId,
    githubProviderId: contribution.githubUserId,
    contributorId: contribution.githubUserId,
    amount: WTT_CONTRIBUTION_AMOUNT,
    status: 'unclaimed',
    claimId: null,
    earnedAt: contribution.mergedAt,
    claimedAt: null,
    claimedWallet: null,
    claimTransaction: null,
  };
}

export async function grantContributionEntitlement(
  contributionId: string,
  contribution: Record<string, unknown>,
  store: WttEntitlementStore,
): Promise<GrantContributionEntitlementResult> {
  const record = buildContributionEntitlement(contributionId, contribution);
  if (!record) return { status: 'ineligible' };
  const entitlementId = contributionEntitlementId(contribution.number as number);
  const status = await store.createIfAbsent(entitlementId, record);
  return { status, entitlementId };
}
