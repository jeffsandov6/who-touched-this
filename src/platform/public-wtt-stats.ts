interface DateLike {
  toDate(): Date;
}

export interface PublicWttStats {
  earned: number;
  claimed: number;
  holders: number;
  supply: number;
  updatedAt: Date;
}

export type PublicWttStatsState =
  | { status: 'loading' }
  | { status: 'ready'; stats: PublicWttStats }
  | { status: 'missing' }
  | { status: 'error' };

function asDate(value: unknown): Date | null {
  if (!value || typeof value !== 'object' || !('toDate' in value)
    || typeof (value as DateLike).toDate !== 'function') return null;
  try {
    const date = (value as DateLike).toDate();
    return Number.isFinite(date.getTime()) ? date : null;
  } catch {
    return null;
  }
}

export function parsePublicWttStats(value: unknown): PublicWttStats | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const updatedAt = asDate(record.updatedAt);
  const keys = ['earned', 'claimed', 'holders', 'supply'] as const;
  const allowedKeys = new Set([...keys, 'updatedAt']);
  if (Object.keys(record).length !== allowedKeys.size
    || !Object.keys(record).every((key) => allowedKeys.has(key as typeof keys[number] | 'updatedAt'))
    || !updatedAt || !keys.every((key) => Number.isSafeInteger(record[key]) && (record[key] as number) >= 0)
    || (record.claimed as number) > (record.earned as number)
    || (record.holders as number) > (record.claimed as number)) return null;
  return {
    earned: record.earned as number,
    claimed: record.claimed as number,
    holders: record.holders as number,
    supply: record.supply as number,
    updatedAt,
  };
}
