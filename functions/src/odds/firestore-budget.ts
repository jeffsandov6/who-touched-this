import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { BudgetClaim, BudgetReservation, OddsBudget, ProviderQuotaObservation } from './odds.js';

export const ODDS_BUDGET_DOCUMENT = 'platformCache/odds_budget' as const;
export const ODDS_MONTHLY_CREDIT_LIMIT = 500;
export const ODDS_CREDIT_SAFETY_MARGIN = 25;
export const ODDS_RESERVATION_MILLISECONDS = 2 * 60 * 1000;
export const ODDS_QUOTA_RECHECK_MILLISECONDS = 6 * 60 * 60 * 1000;

interface StoredReservation { credits: number; expiresAt: Date }

interface BudgetState {
  periodKey: string;
  estimatedUsed: number;
  providerUsed: number | null;
  providerRemaining: number | null;
  providerLastCost: number | null;
  providerObservedAt: Date | null;
  reservations: Record<string, StoredReservation>;
  quotaExhausted: boolean;
  quotaExhaustedAt: Date | null;
  quotaRecheckAt: Date | null;
}

function periodKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function firstConservativeRecheck(now: Date): Date {
  const boundary = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 12);
  return new Date(Math.max(boundary, now.getTime() + ODDS_QUOTA_RECHECK_MILLISECONDS));
}

function currentPeriodRecheck(now: Date): Date {
  const boundary = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 12);
  return new Date(Math.max(boundary, now.getTime()));
}

function storedDate(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (value instanceof Timestamp) {
    const date = value.toDate();
    return Number.isFinite(date.getTime()) ? date : null;
  }
  return null;
}

function safeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 1_000_000_000
    ? value as number : null;
}

function emptyState(now: Date): BudgetState {
  return {
    periodKey: periodKey(now), estimatedUsed: 0,
    providerUsed: null, providerRemaining: null, providerLastCost: null, providerObservedAt: null,
    reservations: {}, quotaExhausted: false, quotaExhaustedAt: null, quotaRecheckAt: null,
  };
}

function parseState(data: Record<string, unknown> | undefined, now: Date): BudgetState {
  if (!data) return emptyState(now);
  if (data.schemaVersion !== 1 || typeof data.periodKey !== 'string' || !/^\d{4}-\d{2}$/.test(data.periodKey)
    || safeInteger(data.estimatedUsed) === null || typeof data.quotaExhausted !== 'boolean'
    || !data.reservations || typeof data.reservations !== 'object' || Array.isArray(data.reservations)) {
    throw new Error('Shared odds budget state is malformed.');
  }
  const nullableInteger = (value: unknown) => value === null ? null : safeInteger(value);
  const providerUsed = nullableInteger(data.providerUsed);
  const providerRemaining = nullableInteger(data.providerRemaining);
  const providerLastCost = nullableInteger(data.providerLastCost);
  if ((data.providerUsed !== null && providerUsed === null)
    || (data.providerRemaining !== null && providerRemaining === null)
    || (data.providerLastCost !== null && providerLastCost === null)) {
    throw new Error('Shared odds budget provider observation is malformed.');
  }
  const nullableDate = (value: unknown) => value === null ? null : storedDate(value);
  const providerObservedAt = nullableDate(data.providerObservedAt);
  const quotaExhaustedAt = nullableDate(data.quotaExhaustedAt);
  const quotaRecheckAt = nullableDate(data.quotaRecheckAt);
  if ((data.providerObservedAt !== null && !providerObservedAt)
    || (data.quotaExhaustedAt !== null && !quotaExhaustedAt)
    || (data.quotaRecheckAt !== null && !quotaRecheckAt)) {
    throw new Error('Shared odds budget timestamp is malformed.');
  }
  const reservations: Record<string, StoredReservation> = {};
  for (const [token, raw] of Object.entries(data.reservations as Record<string, unknown>)) {
    if (!token || token.length > 200 || !raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Shared odds budget reservation is malformed.');
    }
    const record = raw as Record<string, unknown>;
    const credits = safeInteger(record.credits);
    const expiresAt = storedDate(record.expiresAt);
    if (credits === null || credits < 1 || !expiresAt) throw new Error('Shared odds budget reservation is malformed.');
    reservations[token] = { credits, expiresAt };
  }
  return {
    periodKey: data.periodKey,
    estimatedUsed: data.estimatedUsed as number,
    providerUsed, providerRemaining, providerLastCost, providerObservedAt, reservations,
    quotaExhausted: data.quotaExhausted, quotaExhaustedAt, quotaRecheckAt,
  };
}

function expireReservations(state: BudgetState, now: Date): void {
  for (const [token, reservation] of Object.entries(state.reservations)) {
    if (reservation.expiresAt.getTime() <= now.getTime()) {
      state.estimatedUsed += reservation.credits;
      delete state.reservations[token];
    }
  }
}

function activeCredits(state: BudgetState): number {
  return Object.values(state.reservations).reduce((sum, reservation) => sum + reservation.credits, 0);
}

function persisted(state: BudgetState, now: Date): Record<string, unknown> {
  return { schemaVersion: 1, ...state, updatedAt: now };
}

function applyObservation(state: BudgetState, observation: ProviderQuotaObservation, now: Date): void {
  state.providerUsed = observation.used;
  state.providerRemaining = observation.remaining;
  state.providerLastCost = observation.last;
  state.providerObservedAt = now;
  state.estimatedUsed = Math.max(state.estimatedUsed, observation.used);
}

function blockedRetryAt(state: BudgetState, now: Date): Date {
  if (state.quotaExhausted && state.quotaRecheckAt) return state.quotaRecheckAt;
  return firstConservativeRecheck(now);
}

/** A single transactional budget shared by every odds league and Function instance. */
export function firestoreOddsBudget(firestore: Firestore): OddsBudget {
  const reference = firestore.doc(ODDS_BUDGET_DOCUMENT);
  return {
    reserve: (now, token, credits): Promise<BudgetClaim> => firestore.runTransaction(async (transaction) => {
      if (!Number.isSafeInteger(credits) || credits < 1 || credits > 10 || !token || token.length > 200) {
        throw new Error('Odds budget reservation request is invalid.');
      }
      const snapshot = await transaction.get(reference);
      let state = parseState(snapshot.data(), now);
      expireReservations(state, now);

      const currentPeriod = periodKey(now);
      if (state.periodKey !== currentPeriod && !state.quotaExhausted) {
        if (state.providerRemaining !== null && state.providerRemaining < ODDS_CREDIT_SAFETY_MARGIN) {
          state.quotaExhausted = true;
          state.quotaRecheckAt = currentPeriodRecheck(now);
        } else {
          state = emptyState(now);
        }
      }

      let quotaRecheck = false;
      if (state.quotaExhausted) {
        const retryAt = state.quotaRecheckAt ?? firstConservativeRecheck(now);
        if (now.getTime() < retryAt.getTime() || Object.values(state.reservations).some((item) => item.expiresAt > now)) {
          state.quotaRecheckAt = retryAt;
          transaction.set(reference, persisted(state, now));
          return { kind: 'blocked' as const, reason: 'quota_exhausted' as const, retryAt };
        }
        quotaRecheck = true;
      }

      const committed = Math.max(state.estimatedUsed, state.providerUsed ?? 0);
      const reserved = activeCredits(state);
      const locallyAllowed = committed + reserved + credits <= ODDS_MONTHLY_CREDIT_LIMIT - ODDS_CREDIT_SAFETY_MARGIN;
      const providerAllowed = state.providerRemaining === null
        || state.providerRemaining - reserved - credits >= ODDS_CREDIT_SAFETY_MARGIN;
      if (!quotaRecheck && (!locallyAllowed || !providerAllowed)) {
        const retryAt = blockedRetryAt(state, now);
        transaction.set(reference, persisted(state, now));
        return { kind: 'blocked' as const, reason: 'budget_limit' as const, retryAt };
      }

      state.periodKey = currentPeriod;
      state.reservations[token] = {
        credits,
        expiresAt: new Date(now.getTime() + ODDS_RESERVATION_MILLISECONDS),
      };
      transaction.set(reference, persisted(state, now));
      return { kind: 'acquired' as const, reservation: { token, credits, quotaRecheck } };
    }),

    settle: (reservation, now, result) => firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const state = parseState(snapshot.data(), now);
      const stored = state.reservations[reservation.token];
      if (stored) {
        state.estimatedUsed += stored.credits;
        delete state.reservations[reservation.token];
      }
      expireReservations(state, now);
      if (result.quotaExhausted) {
        state.quotaExhausted = true;
        state.quotaExhaustedAt = now;
        state.quotaRecheckAt = reservation.quotaRecheck
          ? new Date(now.getTime() + ODDS_QUOTA_RECHECK_MILLISECONDS)
          : firstConservativeRecheck(now);
      } else if (reservation.quotaRecheck && result.successful) {
        state.estimatedUsed = 0;
        state.providerUsed = null;
        state.providerRemaining = null;
        state.providerLastCost = null;
        state.providerObservedAt = null;
        state.quotaExhausted = false;
        state.quotaExhaustedAt = null;
        state.quotaRecheckAt = null;
        state.periodKey = periodKey(now);
      } else if (reservation.quotaRecheck) {
        state.quotaExhausted = true;
        state.quotaRecheckAt = new Date(now.getTime() + ODDS_QUOTA_RECHECK_MILLISECONDS);
      }
      if (result.quota) applyObservation(state, result.quota, now);
      transaction.set(reference, persisted(state, now));
      return state.quotaExhausted && state.quotaRecheckAt ? { retryAt: state.quotaRecheckAt } : {};
    }),
  };
}
