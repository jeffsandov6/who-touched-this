import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import {
  isNflOddsSnapshot,
  ODDS_FRESH_MILLISECONDS,
  ODDS_REFRESH_LEASE_MILLISECONDS,
  type NflOddsCache,
  type OddsCacheEntry,
} from './nfl-odds.js';

export const NFL_ODDS_CACHE_DOCUMENT = 'platformCache/nflOdds' as const;

function timestampMilliseconds(value: unknown): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (!(value instanceof Timestamp)) return null;
  const milliseconds = value.toMillis();
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function parseEntry(data: Record<string, unknown> | undefined): OddsCacheEntry | null {
  if (!data || !isNflOddsSnapshot(data.snapshot)) return null;
  const fetchedAtMilliseconds = timestampMilliseconds(data.fetchedAt);
  if (fetchedAtMilliseconds === null
    || fetchedAtMilliseconds !== Date.parse(data.snapshot.fetchedAt)) return null;
  return { snapshot: data.snapshot, fetchedAtMilliseconds };
}

export function firestoreNflOddsCache(firestore: Firestore): NflOddsCache {
  const reference = firestore.doc(NFL_ODDS_CACHE_DOCUMENT);
  return {
    async load() {
      const snapshot = await reference.get();
      return parseEntry(snapshot.data());
    },

    claim: (now, token) => firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const data = snapshot.data();
      const entry = parseEntry(data);
      if (entry && now.getTime() - entry.fetchedAtMilliseconds >= 0
        && now.getTime() - entry.fetchedAtMilliseconds < ODDS_FRESH_MILLISECONDS) {
        return { kind: 'fresh' as const, entry };
      }
      const retryAt = timestampMilliseconds(data?.retryAt);
      if (retryAt !== null && retryAt > now.getTime()) {
        return { kind: 'backoff' as const, entry };
      }
      const leaseUntil = timestampMilliseconds(data?.refreshLeaseUntil);
      if (leaseUntil !== null && leaseUntil > now.getTime()) {
        return { kind: 'busy' as const, entry };
      }
      transaction.set(reference, {
        refreshToken: token,
        refreshLeaseUntil: new Date(now.getTime() + ODDS_REFRESH_LEASE_MILLISECONDS),
        updatedAt: now,
        retryAt: FieldValue.delete(),
      }, { merge: true });
      return { kind: 'acquired' as const, previous: entry };
    }),

    store: (token, entry) => firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (snapshot.data()?.refreshToken !== token) {
        throw new Error('Odds refresh lease is no longer current.');
      }
      transaction.set(reference, {
        schemaVersion: 1,
        snapshot: entry.snapshot,
        fetchedAt: new Date(entry.fetchedAtMilliseconds),
        updatedAt: new Date(),
      });
    }),

    markFailure: (token, retryAt) => firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (snapshot.data()?.refreshToken !== token) return;
      transaction.set(reference, {
        refreshToken: FieldValue.delete(),
        refreshLeaseUntil: FieldValue.delete(),
        retryAt,
        updatedAt: new Date(),
      }, { merge: true });
    }),
  };
}
