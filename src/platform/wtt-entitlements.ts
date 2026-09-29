import { formatContributionNumber } from './history.ts';
import {
  WTT_ENTITLEMENT_SOURCE_TYPES,
  type WttEntitlementSourceType,
} from './firebase/models.ts';

interface DateLike {
  toDate(): Date;
}

interface ParsedWttEntitlementBase {
  id: string;
  sourceType: WttEntitlementSourceType;
  sourceId: string;
  githubProviderId: string;
  contributorId: string;
  amount: number;
  earnedAt: Date;
}

export type ParsedWttEntitlement = ParsedWttEntitlementBase & ({
  status: 'unclaimed';
  claimId: null;
  claimedAt: null;
  claimedWallet: null;
  claimTransaction: null;
} | {
  status: 'claiming';
  claimId: string;
  claimedAt: null;
  claimedWallet: null;
  claimTransaction: null;
} | {
  status: 'claimed';
  claimId: string;
  claimedAt: Date;
  claimedWallet: string;
  claimTransaction: string;
});

export interface WttEntitlementTotals {
  earned: number;
  unclaimed: number;
  claimed: number;
}

function asDate(value: unknown): Date | null {
  if (!value || typeof value !== 'object' || !('toDate' in value)
    || typeof (value as DateLike).toDate !== 'function') return null;
  const date = (value as DateLike).toDate();
  return Number.isFinite(date.getTime()) ? date : null;
}

function isSourceType(value: unknown): value is WttEntitlementSourceType {
  return typeof value === 'string'
    && (WTT_ENTITLEMENT_SOURCE_TYPES as readonly string[]).includes(value);
}

export function parseWttEntitlement(
  id: string,
  data: unknown,
  expectedGithubProviderId: string,
): ParsedWttEntitlement | null {
  if (!data || typeof data !== 'object' || !/^[0-9]+$/.test(expectedGithubProviderId)) return null;
  const record = data as Record<string, unknown>;
  if (!isSourceType(record.sourceType)
    || typeof record.sourceId !== 'string' || !record.sourceId
    || id !== `${record.sourceType}:${record.sourceId}`
    || record.githubProviderId !== expectedGithubProviderId
    || record.contributorId !== expectedGithubProviderId
    || !Number.isSafeInteger(record.amount) || (record.amount as number) < 1
    || !['unclaimed', 'claiming', 'claimed'].includes(record.status as string)) return null;

  if (record.sourceType === 'contribution') {
    const contributionNumber = Number(record.sourceId);
    if (!/^(0|[1-9][0-9]*)$/.test(record.sourceId)
      || !Number.isSafeInteger(contributionNumber)) return null;
  }
  const earnedAt = asDate(record.earnedAt);
  if (!earnedAt) return null;
  const base = {
    id,
    sourceType: record.sourceType,
    sourceId: record.sourceId,
    githubProviderId: expectedGithubProviderId,
    contributorId: expectedGithubProviderId,
    amount: record.amount as number,
    earnedAt,
  };

  if (record.status === 'unclaimed') {
    return record.claimId === null && record.claimedAt === null
      && (record.claimedWallet === undefined || record.claimedWallet === null)
      && (record.claimTransaction === undefined || record.claimTransaction === null)
      ? {
        ...base, status: 'unclaimed', claimId: null, claimedAt: null,
        claimedWallet: null, claimTransaction: null,
      }
      : null;
  }
  if (record.status === 'claiming') {
    return typeof record.claimId === 'string' && record.claimId.length > 0
      && record.claimedAt === null
      && (record.claimedWallet === undefined || record.claimedWallet === null)
      && (record.claimTransaction === undefined || record.claimTransaction === null)
      ? {
        ...base, status: 'claiming', claimId: record.claimId, claimedAt: null,
        claimedWallet: null, claimTransaction: null,
      }
      : null;
  }
  const claimedAt = asDate(record.claimedAt);
  return typeof record.claimId === 'string' && record.claimId.length > 0 && claimedAt
    && typeof record.claimedWallet === 'string' && record.claimedWallet.length > 0
    && typeof record.claimTransaction === 'string' && record.claimTransaction.length > 0
    ? {
      ...base, status: 'claimed', claimId: record.claimId, claimedAt,
      claimedWallet: record.claimedWallet, claimTransaction: record.claimTransaction,
    }
    : null;
}

export function calculateWttEntitlementTotals(
  entitlements: readonly ParsedWttEntitlement[],
): WttEntitlementTotals {
  return entitlements.reduce<WttEntitlementTotals>((totals, entitlement) => ({
    earned: totals.earned + entitlement.amount,
    unclaimed: totals.unclaimed + (entitlement.status !== 'claimed' ? entitlement.amount : 0),
    claimed: totals.claimed + (entitlement.status === 'claimed' ? entitlement.amount : 0),
  }), { earned: 0, unclaimed: 0, claimed: 0 });
}

export function wttEntitlementSourceLabel(entitlement: ParsedWttEntitlement): string {
  switch (entitlement.sourceType) {
    case 'contribution':
      return `Contribution ${formatContributionNumber(Number(entitlement.sourceId))}`;
    case 'easter_egg':
      return `Easter egg: ${entitlement.sourceId}`;
    case 'game':
      return `Game: ${entitlement.sourceId}`;
    case 'season_bonus':
      return `Season ${entitlement.sourceId} bonus`;
    case 'admin_award':
      return `WTT award: ${entitlement.sourceId}`;
  }
}
