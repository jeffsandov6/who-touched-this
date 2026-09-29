export const PUBLIC_WTT_STATS_DOCUMENT = 'publicWttStats/current' as const;

const WTT_SOURCE_TYPES = new Set([
  'contribution', 'easter_egg', 'game', 'season_bonus', 'admin_award',
]);

export interface PublicWttStatsValues {
  earned: number;
  claimed: number;
  holders: number;
  supply: number;
}

export interface PublicWttStatsRecord extends PublicWttStatsValues {
  updatedAt: Date;
}

export interface WttStatsEntitlementSource {
  id: string;
  data: Record<string, unknown>;
}

export interface WttSupplyReader {
  loadSupply(): Promise<number>;
}

export interface PublicWttStatsStore {
  listEntitlements(): Promise<WttStatsEntitlementSource[]>;
  loadCurrent(): Promise<Record<string, unknown> | null>;
  writeCurrentIfNewer(record: PublicWttStatsRecord): Promise<'written' | 'stale'>;
}

export interface PublicWttStatsDependencies {
  store: PublicWttStatsStore;
  supply: WttSupplyReader;
}

export class PublicWttStatsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublicWttStatsError';
  }
}

function validTimestamp(value: unknown): boolean {
  if (value instanceof Date) return Number.isFinite(value.getTime());
  if (!value || typeof value !== 'object') return false;
  const toMillis = (value as { toMillis?: unknown }).toMillis;
  if (typeof toMillis !== 'function') return false;
  try { return Number.isFinite(toMillis.call(value)); } catch { return false; }
}

function addSafe(total: number, amount: number): number {
  const next = total + amount;
  if (!Number.isSafeInteger(next)) {
    throw new PublicWttStatsError('WTT entitlement totals exceed the supported safe integer range.');
  }
  return next;
}

function validateEntitlement(source: WttStatsEntitlementSource): {
  amount: number;
  status: 'unclaimed' | 'claiming' | 'claimed';
  claimedWallet: string | null;
} {
  const record = source.data;
  if (!WTT_SOURCE_TYPES.has(String(record.sourceType))
    || typeof record.sourceId !== 'string' || !record.sourceId
    || source.id !== `${record.sourceType}:${record.sourceId}`
    || typeof record.githubProviderId !== 'string' || !/^[0-9]+$/.test(record.githubProviderId)
    || record.contributorId !== record.githubProviderId
    || !Number.isSafeInteger(record.amount) || (record.amount as number) < 1
    || !validTimestamp(record.earnedAt)
    || !['unclaimed', 'claiming', 'claimed'].includes(String(record.status))) {
    throw new PublicWttStatsError(`authoritative entitlement ${source.id} is malformed.`);
  }
  if (record.status === 'unclaimed') {
    if (record.claimId !== null || record.claimedAt !== null
      || (record.claimedWallet !== null && record.claimedWallet !== undefined)
      || (record.claimTransaction !== null && record.claimTransaction !== undefined)) {
      throw new PublicWttStatsError(`authoritative entitlement ${source.id} has inconsistent unclaimed state.`);
    }
    return { amount: record.amount as number, status: 'unclaimed', claimedWallet: null };
  }
  if (record.status === 'claiming') {
    if (typeof record.claimId !== 'string' || !record.claimId || record.claimedAt !== null
      || (record.claimedWallet !== null && record.claimedWallet !== undefined)
      || (record.claimTransaction !== null && record.claimTransaction !== undefined)) {
      throw new PublicWttStatsError(`authoritative entitlement ${source.id} has inconsistent claiming state.`);
    }
    return { amount: record.amount as number, status: 'claiming', claimedWallet: null };
  }
  if (typeof record.claimId !== 'string' || !record.claimId || !validTimestamp(record.claimedAt)
    || typeof record.claimedWallet !== 'string' || !record.claimedWallet
    || typeof record.claimTransaction !== 'string' || !record.claimTransaction) {
    throw new PublicWttStatsError(`authoritative entitlement ${source.id} has inconsistent claimed state.`);
  }
  return {
    amount: record.amount as number,
    status: 'claimed',
    claimedWallet: record.claimedWallet,
  };
}

export function aggregateWttEntitlements(
  entitlements: readonly WttStatsEntitlementSource[],
): Omit<PublicWttStatsValues, 'supply'> {
  let earned = 0;
  let claimed = 0;
  // During the frozen-token phase, distinct confirmed destination wallets are
  // the canonical holder metric. If WTT becomes transferable, this metric must
  // move to an on-chain owner calculation instead.
  const wallets = new Set<string>();
  const ids = new Set<string>();
  for (const source of entitlements) {
    if (ids.has(source.id)) {
      throw new PublicWttStatsError(`authoritative entitlement ${source.id} was returned more than once.`);
    }
    ids.add(source.id);
    const entitlement = validateEntitlement(source);
    earned = addSafe(earned, entitlement.amount);
    if (entitlement.status === 'claimed') {
      claimed = addSafe(claimed, entitlement.amount);
      wallets.add(entitlement.claimedWallet!);
    }
  }
  return { earned, claimed, holders: wallets.size };
}

export async function computePublicWttStats(
  dependencies: Pick<PublicWttStatsDependencies, 'store' | 'supply'>,
): Promise<PublicWttStatsValues> {
  const entitlements = await dependencies.store.listEntitlements();
  const aggregate = aggregateWttEntitlements(entitlements);
  const supply = await dependencies.supply.loadSupply();
  if (!Number.isSafeInteger(supply) || supply < 0) {
    throw new PublicWttStatsError('on-chain WTT supply is outside the supported safe integer range.');
  }
  return { ...aggregate, supply };
}

export async function refreshPublicWttStats(
  requestedAt: Date,
  dependencies: PublicWttStatsDependencies,
): Promise<{ values: PublicWttStatsValues; write: 'written' | 'stale' }> {
  if (!Number.isFinite(requestedAt.getTime())) {
    throw new PublicWttStatsError('public WTT stats refresh time is invalid.');
  }
  // Supply must succeed before the only write. RPC failure therefore preserves
  // the last known valid public aggregate.
  const values = await computePublicWttStats(dependencies);
  const write = await dependencies.store.writeCurrentIfNewer({ ...values, updatedAt: requestedAt });
  return { values, write };
}

function parseStoredValues(value: Record<string, unknown> | null): PublicWttStatsValues | null {
  if (!value) return null;
  const keys: Array<keyof PublicWttStatsValues> = ['earned', 'claimed', 'holders', 'supply'];
  const allowedKeys = new Set([...keys, 'updatedAt']);
  if (Object.keys(value).length !== allowedKeys.size
    || !Object.keys(value).every((key) => allowedKeys.has(key as keyof PublicWttStatsValues | 'updatedAt'))
    || !keys.every((key) => Number.isSafeInteger(value[key]) && (value[key] as number) >= 0)
    || !validTimestamp(value.updatedAt)) return null;
  return {
    earned: value.earned as number,
    claimed: value.claimed as number,
    holders: value.holders as number,
    supply: value.supply as number,
  };
}

export interface PublicWttStatsReconciliationReport {
  mode: 'dry-run' | 'apply';
  stored: PublicWttStatsValues | null;
  storedStatus: 'missing' | 'valid' | 'malformed';
  expected: PublicWttStatsValues;
  differences: Array<keyof PublicWttStatsValues>;
  applied: boolean;
  write: 'not-requested' | 'written' | 'stale';
}

export async function reconcilePublicWttStats(
  apply: boolean,
  requestedAt: Date,
  dependencies: PublicWttStatsDependencies,
): Promise<PublicWttStatsReconciliationReport> {
  const [expected, storedDocument] = await Promise.all([
    computePublicWttStats(dependencies),
    dependencies.store.loadCurrent(),
  ]);
  const stored = parseStoredValues(storedDocument);
  const storedStatus = storedDocument === null ? 'missing' : stored ? 'valid' : 'malformed';
  const keys: Array<keyof PublicWttStatsValues> = ['earned', 'claimed', 'holders', 'supply'];
  const differences = keys.filter((key) => stored?.[key] !== expected[key]);
  if (!apply) {
    return {
      mode: 'dry-run', stored, storedStatus, expected, differences,
      applied: false, write: 'not-requested',
    };
  }
  const write = await dependencies.store.writeCurrentIfNewer({ ...expected, updatedAt: requestedAt });
  return {
    mode: 'apply', stored, storedStatus, expected, differences,
    applied: write === 'written', write,
  };
}
