import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { LeagueConfig } from './leagues.js';
import {
  isOddsSnapshot,
  ODDS_FRESH_MILLISECONDS,
  ODDS_REFRESH_LEASE_MILLISECONDS,
  type OddsCache,
  type OddsCacheEntry,
  type StaleReason,
} from './odds.js';

export function oddsCacheDocument(league: LeagueConfig): string {
  return `platformCache/odds_${league.id.replaceAll('-', '_')}`;
}

function timestampMilliseconds(value: unknown): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (!(value instanceof Timestamp)) return null;
  const milliseconds = value.toMillis();
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function parseEntry(data: Record<string, unknown> | undefined, league: LeagueConfig): OddsCacheEntry | null {
  if (!data || data.leagueId !== league.id || !isOddsSnapshot(data.snapshot, league.id)) return null;
  const fetchedAtMilliseconds = timestampMilliseconds(data.fetchedAt);
  if (fetchedAtMilliseconds === null
    || fetchedAtMilliseconds !== Date.parse(data.snapshot.fetchedAt)) return null;
  return { snapshot: data.snapshot, fetchedAtMilliseconds };
}

function retryReason(value: unknown): StaleReason {
  return value === 'quota_exhausted' || value === 'budget_limit' || value === 'rate_limited'
    || value === 'upstream_unavailable' || value === 'refresh_in_progress'
    ? value
    : 'refresh_backoff';
}

export function firestoreOddsCache(firestore: Firestore, league: LeagueConfig): OddsCache {
  const reference = firestore.doc(oddsCacheDocument(league));
  return {
    async load() {
      const snapshot = await reference.get();
      return parseEntry(snapshot.data(), league);
    },

    claim: (now, token) => firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const data = snapshot.data();
      const entry = parseEntry(data, league);
      const age = entry ? now.getTime() - entry.fetchedAtMilliseconds : -1;
      if (entry && age >= 0 && age < ODDS_FRESH_MILLISECONDS) {
        return { kind: 'fresh' as const, entry };
      }
      const retryAt = timestampMilliseconds(data?.retryAt);
      if (retryAt !== null && retryAt > now.getTime()) {
        return { kind: 'backoff' as const, entry, reason: retryReason(data?.retryReason) };
      }
      const leaseUntil = timestampMilliseconds(data?.refreshLeaseUntil);
      if (leaseUntil !== null && leaseUntil > now.getTime()) {
        return { kind: 'busy' as const, entry };
      }
      transaction.set(reference, {
        schemaVersion: 2,
        leagueId: league.id,
        refreshToken: token,
        refreshLeaseUntil: new Date(now.getTime() + ODDS_REFRESH_LEASE_MILLISECONDS),
        retryAt: FieldValue.delete(),
        retryReason: FieldValue.delete(),
        updatedAt: now,
      }, { merge: true });
      return { kind: 'acquired' as const, previous: entry };
    }),

    store: (token, entry) => firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (snapshot.data()?.refreshToken !== token) {
        throw new Error('Odds refresh lease is no longer current.');
      }
      transaction.set(reference, {
        schemaVersion: 2,
        leagueId: league.id,
        snapshot: entry.snapshot,
        fetchedAt: new Date(entry.fetchedAtMilliseconds),
        updatedAt: new Date(),
      });
    }),

    markFailure: (token, retryAt, reason) => firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (snapshot.data()?.refreshToken !== token) return;
      transaction.set(reference, {
        schemaVersion: 2,
        leagueId: league.id,
        refreshToken: FieldValue.delete(),
        refreshLeaseUntil: FieldValue.delete(),
        retryAt,
        retryReason: reason,
        updatedAt: new Date(),
      }, { merge: true });
    }),
  };
}
