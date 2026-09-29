import { randomBytes } from 'node:crypto';
import {
  WttClaimError,
  finalizeWttClaim,
  reserveWttClaim,
  type ConfirmedWttClaim,
  type WttClaimRecord,
  type WttClaimStateStore,
  type WttPreparedAttempt,
} from './claims.js';
import type { WttChainAttemptStatus, WttSolanaGateway } from './solana-claims.js';

export interface WttClaimServiceDependencies {
  store: WttClaimStateStore;
  solana: WttSolanaGateway;
  now(): Date;
  randomBytes(size: number): Uint8Array;
}

export type WttClaimExecutionResult = ConfirmedWttClaim | {
  claimId: string;
  status: 'processing';
  amount: number;
  walletAddress: string;
  transactionSignature: string | null;
};

function processing(claimId: string, claim: WttClaimRecord): WttClaimExecutionResult {
  return {
    claimId,
    status: 'processing',
    amount: claim.amount,
    walletAddress: claim.walletAddress,
    transactionSignature: claim.currentAttempt?.transactionSignature ?? claim.transactionSignature,
  };
}

function randomToken(bytes: Uint8Array): string {
  if (bytes.length !== 32) throw new Error('claim random source returned the wrong byte length.');
  return Buffer.from(bytes).toString('base64url');
}

async function chainStatus(
  solana: WttSolanaGateway,
  transactionSignature: string,
): Promise<WttChainAttemptStatus> {
  try {
    return await solana.getAttemptStatus(transactionSignature);
  } catch (error) {
    if (error instanceof WttClaimError) throw error;
    throw new WttClaimError('unavailable', 'Solana transaction status is temporarily unavailable. resume the claim later.');
  }
}

async function blockhashValid(solana: WttSolanaGateway, blockhash: string): Promise<boolean> {
  try {
    return await solana.isBlockhashValid(blockhash);
  } catch {
    throw new WttClaimError('unavailable', 'Solana blockhash status is temporarily unavailable. resume the claim later.');
  }
}

async function finalize(
  claimId: string,
  signature: string,
  dependencies: WttClaimServiceDependencies,
): Promise<ConfirmedWttClaim> {
  return finalizeWttClaim(claimId, signature, dependencies.now(), dependencies.store);
}

async function reconcileAttempt(
  claimId: string,
  claim: WttClaimRecord,
  attempt: WttPreparedAttempt,
  dependencies: WttClaimServiceDependencies,
): Promise<WttClaimExecutionResult | { retired: true; claim: WttClaimRecord }> {
  const status = await chainStatus(dependencies.solana, attempt.transactionSignature);
  if (status === 'confirmed') return finalize(claimId, attempt.transactionSignature, dependencies);
  if (status === 'failed') {
    return {
      retired: true,
      claim: await dependencies.store.retireAttempt(
        claimId, attempt.transactionSignature, 'failed', dependencies.now(),
      ),
    };
  }
  if (status === 'pending') {
    // Re-submission is byte-for-byte identical and therefore has the same
    // signature; it can improve landing without creating a second mint.
    try {
      await dependencies.solana.submitPreparedAttempt(attempt);
    } catch {
      // The chain already reported this signature as pending. Preserve the
      // attempt and let a later invocation reconcile it again.
    }
    const submitted = claim.status === 'prepared'
      ? await dependencies.store.markAttemptSubmitted(
        claimId, attempt.transactionSignature, dependencies.now(),
      )
      : claim;
    return processing(claimId, submitted);
  }
  if (!await blockhashValid(dependencies.solana, attempt.blockhash)) {
    return {
      retired: true,
      claim: await dependencies.store.retireAttempt(
        claimId, attempt.transactionSignature, 'expired', dependencies.now(),
      ),
    };
  }
  try {
    await dependencies.solana.submitPreparedAttempt(attempt);
  } catch (error) {
    if (error instanceof WttClaimError) throw error;
    throw new WttClaimError('unavailable', 'the prepared Solana transaction could not be submitted. resume the claim later.');
  }
  const submitted = await dependencies.store.markAttemptSubmitted(
    claimId, attempt.transactionSignature, dependencies.now(),
  );
  const afterSubmit = await chainStatus(dependencies.solana, attempt.transactionSignature);
  if (afterSubmit === 'confirmed') return finalize(claimId, attempt.transactionSignature, dependencies);
  if (afterSubmit === 'failed') {
    const retired = await dependencies.store.retireAttempt(
      claimId, attempt.transactionSignature, 'failed', dependencies.now(),
    );
    return { retired: true, claim: retired };
  }
  return processing(claimId, submitted);
}

export async function executeWttClaim(
  authToken: Record<string, unknown> | null,
  input: unknown,
  dependencies: WttClaimServiceDependencies,
): Promise<WttClaimExecutionResult> {
  const reservation = await reserveWttClaim(
    authToken, input, dependencies.now(), dependencies.store,
  );
  let claim = reservation.claim;
  if (claim.status === 'confirmed' && claim.transactionSignature) {
    return finalize(reservation.claimId, claim.transactionSignature, dependencies);
  }

  if (claim.currentAttempt) {
    const result = await reconcileAttempt(
      reservation.claimId, claim, claim.currentAttempt, dependencies,
    );
    if (!('retired' in result)) return result;
    claim = result.claim;
  }

  const leaseToken = randomToken(dependencies.randomBytes(32));
  const lease = await dependencies.store.acquirePreparationLease(
    reservation.claimId, leaseToken, dependencies.now(),
  );
  if (lease.status === 'busy') return processing(reservation.claimId, lease.claim);
  claim = lease.claim;
  try {
    const attempt = await dependencies.solana.prepareAttempt(
      claim, lease.attemptNumber, dependencies.now(),
    );
    claim = await dependencies.store.persistPreparedAttempt(
      reservation.claimId, leaseToken, attempt, dependencies.now(),
    );
  } catch (error) {
    await dependencies.store.releasePreparationLease(
      reservation.claimId, leaseToken, dependencies.now(),
    );
    throw error;
  }
  if (!claim.currentAttempt) {
    throw new WttClaimError('internal', 'prepared WTT claim has no transaction attempt.');
  }
  const result = await reconcileAttempt(
    reservation.claimId, claim, claim.currentAttempt, dependencies,
  );
  if ('retired' in result) {
    // A newly prepared attempt that immediately fails is left reserved for an
    // explicit later retry. One invocation never creates an unbounded chain.
    return processing(reservation.claimId, result.claim);
  }
  return result;
}

export function defaultWttClaimRandomBytes(size: number): Uint8Array {
  return randomBytes(size);
}
