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

export type ExistingContributionEntitlementResult =
  | { valid: true; status: 'unclaimed' | 'claiming' | 'claimed' }
  | { valid: false; reason: string };

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

function timestampMillis(value: unknown): number | null {
  if (!validTimestamp(value)) return null;
  return (value as { toMillis(): number }).toMillis();
}

export function validateExistingContributionEntitlement(
  expected: WttContributionEntitlementRecord,
  value: unknown,
): ExistingContributionEntitlementResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, reason: 'entitlement is not an object' };
  }
  const record = value as Record<string, unknown>;
  if (record.sourceType !== expected.sourceType || record.sourceId !== expected.sourceId
    || record.githubProviderId !== expected.githubProviderId
    || record.contributorId !== expected.contributorId || record.amount !== expected.amount
    || timestampMillis(record.earnedAt) !== timestampMillis(expected.earnedAt)) {
    return { valid: false, reason: 'immutable entitlement provenance does not match its contribution' };
  }
  if (record.status === 'unclaimed') {
    return record.claimId === null && record.claimedAt === null
      && (record.claimedWallet === null || record.claimedWallet === undefined)
      && (record.claimTransaction === null || record.claimTransaction === undefined)
      ? { valid: true, status: 'unclaimed' }
      : { valid: false, reason: 'unclaimed entitlement lifecycle fields are inconsistent' };
  }
  if (record.status === 'claiming') {
    return typeof record.claimId === 'string' && record.claimId.length > 0
      && record.claimedAt === null
      && (record.claimedWallet === null || record.claimedWallet === undefined)
      && (record.claimTransaction === null || record.claimTransaction === undefined)
      ? { valid: true, status: 'claiming' }
      : { valid: false, reason: 'claiming entitlement lifecycle fields are inconsistent' };
  }
  if (record.status === 'claimed') {
    return typeof record.claimId === 'string' && record.claimId.length > 0
      && validTimestamp(record.claimedAt)
      && typeof record.claimedWallet === 'string' && record.claimedWallet.length > 0
      && typeof record.claimTransaction === 'string' && record.claimTransaction.length > 0
      ? { valid: true, status: 'claimed' }
      : { valid: false, reason: 'claimed entitlement lifecycle fields are inconsistent' };
  }
  return { valid: false, reason: 'entitlement status is unsupported' };
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
