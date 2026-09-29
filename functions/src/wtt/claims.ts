import { githubIdFromAuthToken } from '../email/retry-invitation.js';

export const WTT_CLAIM_SCHEMA_VERSION = 1 as const;
export const WTT_PREPARATION_LEASE_MS = 2 * 60 * 1000;

const CLAIM_ID_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export type WttClaimStatus = 'reserved' | 'preparing' | 'prepared' | 'submitted' | 'confirmed';
export type WttAttemptOutcome = 'expired' | 'failed';
export type WttClaimErrorCode =
  | 'unauthenticated'
  | 'permission-denied'
  | 'invalid-argument'
  | 'not-found'
  | 'failed-precondition'
  | 'aborted'
  | 'unavailable'
  | 'internal';

export class WttClaimError extends Error {
  constructor(public readonly code: WttClaimErrorCode, message: string) {
    super(message);
    this.name = 'WttClaimError';
  }
}

export interface WttClaimChallengeSnapshot {
  id: string;
  schemaVersion: 1;
  githubProviderId: string;
  walletAddress: string;
  entitlementIds: string[];
  amount: number;
  status: 'issued' | 'verified' | 'consumed';
  expiresAt: Date;
  verifiedAt: Date | null;
  consumedAt: Date | null;
}

export interface WttClaimEntitlementSnapshot {
  id: string;
  githubProviderId: string;
  amount: number;
  status: 'unclaimed' | 'claiming' | 'claimed';
  claimId: string | null;
}

export interface WttPreparedAttempt {
  number: number;
  transactionSignature: string;
  rawTransactionBase64: string;
  blockhash: string;
  lastValidBlockHeight: number;
  preparedAt: Date;
  submittedAt: Date | null;
}

export interface WttAttemptHistoryEntry {
  number: number;
  transactionSignature: string;
  blockhash: string;
  lastValidBlockHeight: number;
  outcome: WttAttemptOutcome;
  preparedAt: Date;
  submittedAt: Date | null;
  resolvedAt: Date;
}

export interface WttPreparationLease {
  token: string;
  expiresAt: Date;
}

export interface WttClaimRecord {
  schemaVersion: typeof WTT_CLAIM_SCHEMA_VERSION;
  githubProviderId: string;
  walletAddress: string;
  entitlementIds: string[];
  amount: number;
  status: WttClaimStatus;
  createdAt: Date;
  updatedAt: Date;
  confirmedAt: Date | null;
  transactionSignature: string | null;
  attemptCount: number;
  currentAttempt: WttPreparedAttempt | null;
  attemptHistory: WttAttemptHistoryEntry[];
  preparationLease: WttPreparationLease | null;
}

export interface WttClaimReservationTransaction {
  loadChallenge(claimId: string): Promise<WttClaimChallengeSnapshot | null>;
  loadClaim(claimId: string): Promise<WttClaimRecord | null>;
  loadEntitlements(entitlementIds: readonly string[]): Promise<Array<WttClaimEntitlementSnapshot | null>>;
  createClaim(claimId: string, claim: WttClaimRecord): void;
  lockEntitlement(entitlementId: string, claimId: string): void;
  consumeChallenge(challengeId: string, consumedAt: Date): void;
}

export interface WttClaimFinalizationTransaction {
  loadClaim(claimId: string): Promise<WttClaimRecord | null>;
  loadEntitlements(entitlementIds: readonly string[]): Promise<Array<WttClaimEntitlementSnapshot | null>>;
  markEntitlementClaimed(
    entitlementId: string,
    claimId: string,
    walletAddress: string,
    transactionSignature: string,
    claimedAt: Date,
  ): void;
  markClaimConfirmed(claimId: string, transactionSignature: string, confirmedAt: Date): void;
}

export interface WttClaimStateStore {
  runReservation<T>(operation: (transaction: WttClaimReservationTransaction) => Promise<T>): Promise<T>;
  loadClaim(claimId: string): Promise<WttClaimRecord | null>;
  acquirePreparationLease(
    claimId: string,
    leaseToken: string,
    now: Date,
  ): Promise<{ status: 'acquired'; claim: WttClaimRecord; attemptNumber: number } | { status: 'busy'; claim: WttClaimRecord }>;
  persistPreparedAttempt(
    claimId: string,
    leaseToken: string,
    attempt: WttPreparedAttempt,
    now: Date,
  ): Promise<WttClaimRecord>;
  releasePreparationLease(claimId: string, leaseToken: string, now: Date): Promise<void>;
  markAttemptSubmitted(
    claimId: string,
    transactionSignature: string,
    submittedAt: Date,
  ): Promise<WttClaimRecord>;
  retireAttempt(
    claimId: string,
    transactionSignature: string,
    outcome: WttAttemptOutcome,
    resolvedAt: Date,
  ): Promise<WttClaimRecord>;
  runFinalization<T>(operation: (transaction: WttClaimFinalizationTransaction) => Promise<T>): Promise<T>;
}

export interface ReservedWttClaim {
  claimId: string;
  claim: WttClaimRecord;
  created: boolean;
}

export interface ConfirmedWttClaim {
  claimId: string;
  status: 'confirmed';
  amount: number;
  walletAddress: string;
  transactionSignature: string;
  confirmedAt: string;
}

function requireGitHubProviderId(authToken: Record<string, unknown> | null): string {
  if (!authToken) throw new WttClaimError('unauthenticated', 'authentication is required.');
  const id = githubIdFromAuthToken(authToken);
  if (!id || !/^[0-9]+$/.test(id)) {
    throw new WttClaimError('permission-denied', 'a GitHub-authenticated account is required.');
  }
  return id;
}

function parseClaimInput(input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new WttClaimError('invalid-argument', 'request data is invalid.');
  }
  const record = input as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.challengeId !== 'string'
    || !CLAIM_ID_PATTERN.test(record.challengeId)) {
    throw new WttClaimError('invalid-argument', 'challenge identifier is invalid.');
  }
  return record.challengeId;
}

function validateChallenge(challenge: WttClaimChallengeSnapshot, claimId: string): void {
  if (challenge.id !== claimId
    || challenge.schemaVersion !== 1
    || !/^[0-9]+$/.test(challenge.githubProviderId)
    || typeof challenge.walletAddress !== 'string'
    || challenge.entitlementIds.length === 0
    || challenge.entitlementIds.length > 100
    || new Set(challenge.entitlementIds).size !== challenge.entitlementIds.length
    || !Number.isSafeInteger(challenge.amount)
    || challenge.amount < 1
    || !Number.isFinite(challenge.expiresAt.getTime())
    || !challenge.verifiedAt
    || !Number.isFinite(challenge.verifiedAt.getTime())
    || (challenge.status === 'verified' && challenge.consumedAt !== null)
    || (challenge.status === 'consumed' && !challenge.consumedAt)) {
    throw new WttClaimError('failed-precondition', 'the verified wallet challenge is invalid.');
  }
}

function validateMatchingClaim(
  claim: WttClaimRecord,
  challenge: WttClaimChallengeSnapshot,
): void {
  if (claim.schemaVersion !== WTT_CLAIM_SCHEMA_VERSION
    || claim.githubProviderId !== challenge.githubProviderId
    || claim.walletAddress !== challenge.walletAddress
    || claim.amount !== challenge.amount
    || claim.entitlementIds.length !== challenge.entitlementIds.length
    || claim.entitlementIds.some((id, index) => id !== challenge.entitlementIds[index])) {
    throw new WttClaimError('failed-precondition', 'the existing claim does not match this challenge.');
  }
}

function validateReservationEntitlements(
  entitlements: readonly (WttClaimEntitlementSnapshot | null)[],
  challenge: WttClaimChallengeSnapshot,
  existingClaim: WttClaimRecord | null,
): { amount: number; idsToLock: string[] } {
  if (entitlements.length !== challenge.entitlementIds.length) {
    throw new WttClaimError('failed-precondition', 'the selected WTT records could not be verified.');
  }
  let amount = 0;
  const idsToLock: string[] = [];
  for (let index = 0; index < challenge.entitlementIds.length; index += 1) {
    const expectedId = challenge.entitlementIds[index];
    const entitlement = entitlements[index];
    if (!entitlement || entitlement.id !== expectedId) {
      throw new WttClaimError('not-found', 'a selected WTT entitlement does not exist.');
    }
    if (entitlement.githubProviderId !== challenge.githubProviderId) {
      throw new WttClaimError('permission-denied', 'a selected WTT entitlement belongs to another GitHub account.');
    }
    if (!Number.isSafeInteger(entitlement.amount) || entitlement.amount < 1
      || !Number.isSafeInteger(amount + entitlement.amount)) {
      throw new WttClaimError('failed-precondition', 'a selected WTT entitlement has an invalid amount.');
    }
    amount += entitlement.amount;
    if (entitlement.status === 'unclaimed' && entitlement.claimId === null) {
      if (existingClaim?.status === 'confirmed') {
        throw new WttClaimError('failed-precondition', 'a confirmed claim has an unlocked entitlement.');
      }
      idsToLock.push(entitlement.id);
      continue;
    }
    if (entitlement.status === 'claiming' && entitlement.claimId === challenge.id) continue;
    if (entitlement.status === 'claimed' && entitlement.claimId === challenge.id
      && existingClaim?.status === 'confirmed') continue;
    if (entitlement.status === 'claiming') {
      throw new WttClaimError('failed-precondition', 'a selected WTT entitlement is locked by another claim.');
    }
    throw new WttClaimError('failed-precondition', 'a selected WTT entitlement has already been claimed.');
  }
  if (amount !== challenge.amount) {
    throw new WttClaimError('failed-precondition', 'the authoritative WTT amount does not match its entitlements.');
  }
  return { amount, idsToLock };
}

export async function reserveWttClaim(
  authToken: Record<string, unknown> | null,
  input: unknown,
  now: Date,
  store: WttClaimStateStore,
): Promise<ReservedWttClaim> {
  const githubProviderId = requireGitHubProviderId(authToken);
  const claimId = parseClaimInput(input);
  if (!Number.isFinite(now.getTime())) throw new Error('claim clock returned an invalid date.');
  return store.runReservation(async (transaction) => {
    const challenge = await transaction.loadChallenge(claimId);
    if (!challenge) throw new WttClaimError('not-found', 'wallet challenge was not found.');
    validateChallenge(challenge, claimId);
    if (challenge.githubProviderId !== githubProviderId) {
      throw new WttClaimError('permission-denied', 'wallet challenge belongs to another GitHub account.');
    }
    const existingClaim = await transaction.loadClaim(claimId);
    if (challenge.status === 'issued') {
      throw new WttClaimError('failed-precondition', 'wallet challenge has not been verified.');
    }
    if (challenge.status === 'verified') {
      if (existingClaim) {
        throw new WttClaimError('failed-precondition', 'claim exists before its challenge was consumed.');
      }
      if (now.getTime() >= challenge.expiresAt.getTime()) {
        throw new WttClaimError('failed-precondition', 'wallet challenge has expired. verify the wallet again.');
      }
    } else if (!existingClaim) {
      throw new WttClaimError('failed-precondition', 'consumed wallet challenge has no matching claim.');
    }
    if (existingClaim) validateMatchingClaim(existingClaim, challenge);
    const entitlements = await transaction.loadEntitlements(challenge.entitlementIds);
    const { idsToLock } = validateReservationEntitlements(entitlements, challenge, existingClaim);
    const claim = existingClaim ?? {
      schemaVersion: WTT_CLAIM_SCHEMA_VERSION,
      githubProviderId,
      walletAddress: challenge.walletAddress,
      entitlementIds: [...challenge.entitlementIds],
      amount: challenge.amount,
      status: 'reserved' as const,
      createdAt: now,
      updatedAt: now,
      confirmedAt: null,
      transactionSignature: null,
      attemptCount: 0,
      currentAttempt: null,
      attemptHistory: [],
      preparationLease: null,
    };
    if (!existingClaim) transaction.createClaim(claimId, claim);
    for (const entitlementId of idsToLock) transaction.lockEntitlement(entitlementId, claimId);
    if (challenge.status === 'verified') transaction.consumeChallenge(claimId, now);
    return { claimId, claim, created: !existingClaim };
  });
}

export async function finalizeWttClaim(
  claimId: string,
  transactionSignature: string,
  now: Date,
  store: WttClaimStateStore,
): Promise<ConfirmedWttClaim> {
  return store.runFinalization(async (transaction) => {
    const claim = await transaction.loadClaim(claimId);
    if (!claim) throw new WttClaimError('not-found', 'WTT claim was not found.');
    if (claim.status === 'confirmed') {
      if (claim.transactionSignature !== transactionSignature || !claim.confirmedAt) {
        throw new WttClaimError('failed-precondition', 'confirmed claim state is inconsistent.');
      }
      return {
        claimId,
        status: 'confirmed' as const,
        amount: claim.amount,
        walletAddress: claim.walletAddress,
        transactionSignature,
        confirmedAt: claim.confirmedAt.toISOString(),
      };
    }
    if (!claim.currentAttempt || claim.currentAttempt.transactionSignature !== transactionSignature) {
      throw new WttClaimError('failed-precondition', 'confirmed transaction is not the claim current attempt.');
    }
    const entitlements = await transaction.loadEntitlements(claim.entitlementIds);
    for (let index = 0; index < claim.entitlementIds.length; index += 1) {
      const entitlement = entitlements[index];
      const expectedId = claim.entitlementIds[index];
      if (!entitlement || entitlement.id !== expectedId
        || entitlement.githubProviderId !== claim.githubProviderId
        || entitlement.status !== 'claiming'
        || entitlement.claimId !== claimId) {
        throw new WttClaimError('failed-precondition', 'a WTT entitlement is not locked by this claim.');
      }
    }
    for (const entitlementId of claim.entitlementIds) {
      transaction.markEntitlementClaimed(
        entitlementId, claimId, claim.walletAddress, transactionSignature, now,
      );
    }
    transaction.markClaimConfirmed(claimId, transactionSignature, now);
    return {
      claimId,
      status: 'confirmed' as const,
      amount: claim.amount,
      walletAddress: claim.walletAddress,
      transactionSignature,
      confirmedAt: now.toISOString(),
    };
  });
}
