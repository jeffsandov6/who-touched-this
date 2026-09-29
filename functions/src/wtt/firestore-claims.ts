import type { DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore';
import {
  WTT_CLAIM_SCHEMA_VERSION,
  WTT_PREPARATION_LEASE_MS,
  WttClaimError,
  type WttAttemptHistoryEntry,
  type WttClaimChallengeSnapshot,
  type WttClaimEntitlementSnapshot,
  type WttClaimRecord,
  type WttClaimStateStore,
  type WttPreparedAttempt,
  type WttPreparationLease,
} from './claims.js';

const CHALLENGE_COLLECTION = 'wttClaimChallenges';
const CLAIM_COLLECTION = 'wttClaims';
const ENTITLEMENT_COLLECTION = 'wttEntitlements';

function asDate(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (!value || typeof value !== 'object') return null;
  const toDate = (value as { toDate?: unknown }).toDate;
  if (typeof toDate !== 'function') return null;
  try {
    const date = toDate.call(value) as Date;
    return date instanceof Date && Number.isFinite(date.getTime()) ? date : null;
  } catch {
    return null;
  }
}

function parsePreparedAttempt(value: unknown): WttPreparedAttempt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const preparedAt = asDate(record.preparedAt);
  const submittedAt = record.submittedAt === null ? null : asDate(record.submittedAt);
  if (!Number.isSafeInteger(record.number) || (record.number as number) < 1
    || typeof record.transactionSignature !== 'string' || !record.transactionSignature
    || typeof record.rawTransactionBase64 !== 'string' || !record.rawTransactionBase64
    || typeof record.blockhash !== 'string' || !record.blockhash
    || !Number.isSafeInteger(record.lastValidBlockHeight) || (record.lastValidBlockHeight as number) < 1
    || !preparedAt || (record.submittedAt !== null && !submittedAt)) return null;
  return {
    number: record.number as number,
    transactionSignature: record.transactionSignature,
    rawTransactionBase64: record.rawTransactionBase64,
    blockhash: record.blockhash,
    lastValidBlockHeight: record.lastValidBlockHeight as number,
    preparedAt,
    submittedAt,
  };
}

function parseHistoryEntry(value: unknown): WttAttemptHistoryEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const preparedAt = asDate(record.preparedAt);
  const submittedAt = record.submittedAt === null ? null : asDate(record.submittedAt);
  const resolvedAt = asDate(record.resolvedAt);
  if (!Number.isSafeInteger(record.number) || (record.number as number) < 1
    || typeof record.transactionSignature !== 'string' || !record.transactionSignature
    || typeof record.blockhash !== 'string' || !record.blockhash
    || !Number.isSafeInteger(record.lastValidBlockHeight) || (record.lastValidBlockHeight as number) < 1
    || !['expired', 'failed'].includes(String(record.outcome))
    || !preparedAt || (record.submittedAt !== null && !submittedAt) || !resolvedAt) return null;
  return {
    number: record.number as number,
    transactionSignature: record.transactionSignature,
    blockhash: record.blockhash,
    lastValidBlockHeight: record.lastValidBlockHeight as number,
    outcome: record.outcome as 'expired' | 'failed',
    preparedAt,
    submittedAt,
    resolvedAt,
  };
}

function parseLease(value: unknown): WttPreparationLease | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const expiresAt = asDate(record.expiresAt);
  return typeof record.token === 'string' && record.token && expiresAt
    ? { token: record.token, expiresAt }
    : null;
}

export function parseWttClaimSnapshot(snapshot: DocumentSnapshot): WttClaimRecord | null {
  const data = snapshot.data();
  if (!data || data.schemaVersion !== WTT_CLAIM_SCHEMA_VERSION
    || typeof data.githubProviderId !== 'string' || !/^[0-9]+$/.test(data.githubProviderId)
    || typeof data.walletAddress !== 'string' || !data.walletAddress
    || !Array.isArray(data.entitlementIds)
    || data.entitlementIds.length === 0 || data.entitlementIds.length > 100
    || !data.entitlementIds.every((id): id is string => typeof id === 'string' && id.length > 0)
    || new Set(data.entitlementIds).size !== data.entitlementIds.length
    || !Number.isSafeInteger(data.amount) || data.amount < 1
    || !['reserved', 'preparing', 'prepared', 'submitted', 'confirmed'].includes(String(data.status))
    || !Number.isSafeInteger(data.attemptCount)
    || !Array.isArray(data.attemptHistory)) return null;
  const createdAt = asDate(data.createdAt);
  const updatedAt = asDate(data.updatedAt);
  const confirmedAt = data.confirmedAt === null ? null : asDate(data.confirmedAt);
  const currentAttempt = data.currentAttempt === null ? null : parsePreparedAttempt(data.currentAttempt);
  const preparationLease = data.preparationLease === null ? null : parseLease(data.preparationLease);
  const attemptHistory = data.attemptHistory.map(parseHistoryEntry);
  if (!createdAt || !updatedAt || (data.confirmedAt !== null && !confirmedAt)
    || (data.currentAttempt !== null && !currentAttempt)
    || (data.preparationLease !== null && !preparationLease)
    || attemptHistory.some((entry) => !entry)
    || (data.transactionSignature !== null && (typeof data.transactionSignature !== 'string' || !data.transactionSignature))
    || (data.status === 'reserved' && (currentAttempt || preparationLease))
    || (data.status === 'preparing' && (currentAttempt || !preparationLease))
    || (['prepared', 'submitted'].includes(data.status) && (!currentAttempt || preparationLease
      || data.transactionSignature !== currentAttempt.transactionSignature))
    || (data.status === 'prepared' && currentAttempt?.submittedAt !== null)
    || (data.status === 'submitted' && !currentAttempt?.submittedAt)
    || (data.status === 'confirmed' && (!confirmedAt || !data.transactionSignature || preparationLease))
    || (currentAttempt && currentAttempt.number !== data.attemptCount)) return null;
  return {
    schemaVersion: WTT_CLAIM_SCHEMA_VERSION,
    githubProviderId: data.githubProviderId,
    walletAddress: data.walletAddress,
    entitlementIds: [...data.entitlementIds],
    amount: data.amount,
    status: data.status as WttClaimRecord['status'],
    createdAt,
    updatedAt,
    confirmedAt,
    transactionSignature: data.transactionSignature as string | null,
    attemptCount: data.attemptCount,
    currentAttempt,
    attemptHistory: attemptHistory as WttAttemptHistoryEntry[],
    preparationLease,
  };
}

function parseChallenge(snapshot: DocumentSnapshot): WttClaimChallengeSnapshot | null {
  const data = snapshot.data();
  if (!data || data.schemaVersion !== 1 || typeof data.githubProviderId !== 'string'
    || typeof data.walletAddress !== 'string'
    || !Array.isArray(data.entitlementIds)
    || !data.entitlementIds.every((id): id is string => typeof id === 'string')
    || typeof data.amount !== 'number'
    || !['issued', 'verified', 'consumed'].includes(String(data.status))) return null;
  const expiresAt = asDate(data.expiresAt);
  const verifiedAt = data.verifiedAt === null ? null : asDate(data.verifiedAt);
  const consumedAt = data.consumedAt === null ? null : asDate(data.consumedAt);
  return expiresAt && (data.verifiedAt === null || verifiedAt)
    && (data.consumedAt === null || consumedAt)
    ? {
      id: snapshot.id,
      schemaVersion: 1,
      githubProviderId: data.githubProviderId,
      walletAddress: data.walletAddress,
      entitlementIds: [...data.entitlementIds],
      amount: data.amount,
      status: data.status as WttClaimChallengeSnapshot['status'],
      expiresAt,
      verifiedAt,
      consumedAt,
    }
    : null;
}

function parseEntitlement(snapshot: DocumentSnapshot): WttClaimEntitlementSnapshot | null {
  const data = snapshot.data();
  if (!data || typeof data.githubProviderId !== 'string' || typeof data.amount !== 'number'
    || !['unclaimed', 'claiming', 'claimed'].includes(String(data.status))
    || (data.claimId !== null && typeof data.claimId !== 'string')) return null;
  return {
    id: snapshot.id,
    githubProviderId: data.githubProviderId,
    amount: data.amount,
    status: data.status as WttClaimEntitlementSnapshot['status'],
    claimId: data.claimId as string | null,
  };
}

async function transactionEntitlements(
  firestore: Firestore,
  transaction: Transaction,
  ids: readonly string[],
): Promise<Array<WttClaimEntitlementSnapshot | null>> {
  return Promise.all(ids.map(async (id) => parseEntitlement(
    await transaction.get(firestore.collection(ENTITLEMENT_COLLECTION).doc(id)),
  )));
}

function requireClaim(snapshot: DocumentSnapshot): WttClaimRecord {
  const claim = parseWttClaimSnapshot(snapshot);
  if (!claim) throw new WttClaimError('failed-precondition', 'stored WTT claim is invalid.');
  return claim;
}

export function firestoreWttClaimStore(firestore: Firestore): WttClaimStateStore {
  const claimReference = (claimId: string) => firestore.collection(CLAIM_COLLECTION).doc(claimId);
  return {
    runReservation: (operation) => firestore.runTransaction(async (transaction) => operation({
      async loadChallenge(claimId) {
        return parseChallenge(await transaction.get(
          firestore.collection(CHALLENGE_COLLECTION).doc(claimId),
        ));
      },
      async loadClaim(claimId) {
        const snapshot = await transaction.get(claimReference(claimId));
        return snapshot.exists ? parseWttClaimSnapshot(snapshot) : null;
      },
      loadEntitlements: (ids) => transactionEntitlements(firestore, transaction, ids),
      createClaim(claimId, claim) {
        transaction.create(claimReference(claimId), claim);
      },
      lockEntitlement(entitlementId, claimId) {
        transaction.update(firestore.collection(ENTITLEMENT_COLLECTION).doc(entitlementId), {
          status: 'claiming',
          claimId,
          claimedAt: null,
          claimedWallet: null,
          claimTransaction: null,
        });
      },
      consumeChallenge(challengeId, consumedAt) {
        transaction.update(firestore.collection(CHALLENGE_COLLECTION).doc(challengeId), {
          status: 'consumed',
          consumedAt,
        });
      },
    })),

    async loadClaim(claimId) {
      const snapshot = await claimReference(claimId).get();
      return snapshot.exists ? parseWttClaimSnapshot(snapshot) : null;
    },

    acquirePreparationLease: (claimId, leaseToken, now) => firestore.runTransaction(async (transaction) => {
      const reference = claimReference(claimId);
      const claim = requireClaim(await transaction.get(reference));
      if (claim.status === 'confirmed' || claim.currentAttempt
        || (claim.preparationLease && claim.preparationLease.expiresAt.getTime() > now.getTime())) {
        return { status: 'busy' as const, claim };
      }
      const preparationLease = {
        token: leaseToken,
        expiresAt: new Date(now.getTime() + WTT_PREPARATION_LEASE_MS),
      };
      transaction.update(reference, { status: 'preparing', preparationLease, updatedAt: now });
      return {
        status: 'acquired' as const,
        claim: { ...claim, status: 'preparing' as const, preparationLease, updatedAt: now },
        attemptNumber: claim.attemptCount + 1,
      };
    }),

    persistPreparedAttempt: (claimId, leaseToken, attempt, now) => firestore.runTransaction(async (transaction) => {
      const reference = claimReference(claimId);
      const claim = requireClaim(await transaction.get(reference));
      if (claim.status !== 'preparing' || claim.currentAttempt
        || claim.preparationLease?.token !== leaseToken
        || claim.preparationLease.expiresAt.getTime() <= now.getTime()
        || attempt.number !== claim.attemptCount + 1) {
        throw new WttClaimError('aborted', 'claim preparation lease was lost. resume the claim.');
      }
      transaction.update(reference, {
        status: 'prepared',
        currentAttempt: attempt,
        transactionSignature: attempt.transactionSignature,
        attemptCount: attempt.number,
        preparationLease: null,
        updatedAt: now,
      });
      return {
        ...claim,
        status: 'prepared' as const,
        currentAttempt: attempt,
        transactionSignature: attempt.transactionSignature,
        attemptCount: attempt.number,
        preparationLease: null,
        updatedAt: now,
      };
    }),

    releasePreparationLease: (claimId, leaseToken, now) => firestore.runTransaction(async (transaction) => {
      const reference = claimReference(claimId);
      const claim = requireClaim(await transaction.get(reference));
      if (claim.status === 'preparing' && !claim.currentAttempt
        && claim.preparationLease?.token === leaseToken) {
        transaction.update(reference, {
          status: 'reserved', preparationLease: null, updatedAt: now,
        });
      }
    }),

    markAttemptSubmitted: (claimId, transactionSignature, submittedAt) => firestore.runTransaction(async (transaction) => {
      const reference = claimReference(claimId);
      const claim = requireClaim(await transaction.get(reference));
      if (!claim.currentAttempt || claim.currentAttempt.transactionSignature !== transactionSignature
        || !['prepared', 'submitted'].includes(claim.status)) {
        throw new WttClaimError('failed-precondition', 'submitted transaction does not match the current claim attempt.');
      }
      if (claim.status === 'submitted' && claim.currentAttempt.submittedAt) return claim;
      const currentAttempt = { ...claim.currentAttempt, submittedAt };
      transaction.update(reference, { status: 'submitted', currentAttempt, updatedAt: submittedAt });
      return { ...claim, status: 'submitted' as const, currentAttempt, updatedAt: submittedAt };
    }),

    retireAttempt: (claimId, transactionSignature, outcome, resolvedAt) => firestore.runTransaction(async (transaction) => {
      const reference = claimReference(claimId);
      const claim = requireClaim(await transaction.get(reference));
      if (!claim.currentAttempt || claim.currentAttempt.transactionSignature !== transactionSignature
        || !['prepared', 'submitted'].includes(claim.status)) {
        if (!claim.currentAttempt && claim.status === 'reserved') return claim;
        throw new WttClaimError('aborted', 'claim attempt changed while it was being reconciled.');
      }
      const history: WttAttemptHistoryEntry = {
        number: claim.currentAttempt.number,
        transactionSignature,
        blockhash: claim.currentAttempt.blockhash,
        lastValidBlockHeight: claim.currentAttempt.lastValidBlockHeight,
        outcome,
        preparedAt: claim.currentAttempt.preparedAt,
        submittedAt: claim.currentAttempt.submittedAt,
        resolvedAt,
      };
      const attemptHistory = [...claim.attemptHistory, history];
      transaction.update(reference, {
        status: 'reserved',
        currentAttempt: null,
        transactionSignature: null,
        preparationLease: null,
        attemptHistory,
        updatedAt: resolvedAt,
      });
      return {
        ...claim,
        status: 'reserved' as const,
        currentAttempt: null,
        transactionSignature: null,
        preparationLease: null,
        attemptHistory,
        updatedAt: resolvedAt,
      };
    }),

    runFinalization: (operation) => firestore.runTransaction(async (transaction) => operation({
      async loadClaim(claimId) {
        const snapshot = await transaction.get(claimReference(claimId));
        return snapshot.exists ? parseWttClaimSnapshot(snapshot) : null;
      },
      loadEntitlements: (ids) => transactionEntitlements(firestore, transaction, ids),
      markEntitlementClaimed(entitlementId, claimId, walletAddress, transactionSignature, claimedAt) {
        transaction.update(firestore.collection(ENTITLEMENT_COLLECTION).doc(entitlementId), {
          status: 'claimed',
          claimId,
          claimedAt,
          claimedWallet: walletAddress,
          claimTransaction: transactionSignature,
        });
      },
      markClaimConfirmed(claimId, transactionSignature, confirmedAt) {
        transaction.update(claimReference(claimId), {
          status: 'confirmed',
          transactionSignature,
          confirmedAt,
          updatedAt: confirmedAt,
          preparationLease: null,
        });
      },
    })),
  };
}
