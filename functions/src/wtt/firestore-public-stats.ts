import type { Firestore } from 'firebase-admin/firestore';
import {
  PUBLIC_WTT_STATS_DOCUMENT,
  type PublicWttStatsStore,
} from './public-stats.js';

const ENTITLEMENT_COLLECTION = 'wttEntitlements';

function timestampMillis(value: unknown): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (!value || typeof value !== 'object') return null;
  const toMillis = (value as { toMillis?: unknown }).toMillis;
  if (typeof toMillis !== 'function') return null;
  try {
    const milliseconds = toMillis.call(value) as number;
    return Number.isFinite(milliseconds) ? milliseconds : null;
  } catch {
    return null;
  }
}

export function firestorePublicWttStatsStore(firestore: Firestore): PublicWttStatsStore {
  const statsReference = firestore.doc(PUBLIC_WTT_STATS_DOCUMENT);
  return {
    async listEntitlements() {
      const snapshot = await firestore.collection(ENTITLEMENT_COLLECTION).get();
      return snapshot.docs.map((document) => ({ id: document.id, data: document.data() }));
    },
    async loadCurrent() {
      const snapshot = await statsReference.get();
      return snapshot.exists ? snapshot.data() ?? null : null;
    },
    writeCurrentIfNewer: (record) => firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(statsReference);
      const currentUpdatedAt = timestampMillis(current.data()?.updatedAt);
      if (currentUpdatedAt !== null && currentUpdatedAt >= record.updatedAt.getTime()) {
        return 'stale' as const;
      }
      transaction.set(statsReference, {
        earned: record.earned,
        claimed: record.claimed,
        holders: record.holders,
        supply: record.supply,
        updatedAt: record.updatedAt,
      });
      return 'written' as const;
    }),
  };
}
