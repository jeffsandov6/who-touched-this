import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import {
  executeWttClaim,
  type WttClaimServiceDependencies,
} from '../src/wtt/claim-service.js';
import {
  type WttAttemptOutcome,
  type WttClaimChallengeSnapshot,
  type WttClaimEntitlementSnapshot,
  type WttClaimFinalizationTransaction,
  type WttClaimRecord,
  type WttClaimReservationTransaction,
  type WttClaimStateStore,
  type WttPreparedAttempt,
} from '../src/wtt/claims.js';
import type { WttChainAttemptStatus, WttSolanaGateway } from '../src/wtt/solana-claims.js';

const CLAIM_ID = 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789';
const NOW = new Date('2026-09-28T18:00:00.000Z');
const AUTH = { firebase: { identities: { 'github.com': ['12345678'] } } };

function attempt(number = 1): WttPreparedAttempt {
  return {
    number,
    transactionSignature: `signature-${number}`,
    rawTransactionBase64: Buffer.from(`raw-${number}`).toString('base64'),
    blockhash: `blockhash-${number}`,
    lastValidBlockHeight: 100 + number,
    preparedAt: NOW,
    submittedAt: null,
  };
}

class MemoryStore implements WttClaimStateStore {
  challenge: WttClaimChallengeSnapshot = {
    id: CLAIM_ID,
    schemaVersion: 1,
    githubProviderId: '12345678',
    walletAddress: '11111111111111111111111111111111',
    entitlementIds: ['contribution:12'],
    amount: 1,
    status: 'verified',
    expiresAt: new Date(NOW.getTime() + 60_000),
    verifiedAt: NOW,
    consumedAt: null,
  };
  entitlements = new Map<string, WttClaimEntitlementSnapshot>([[
    'contribution:12',
    { id: 'contribution:12', githubProviderId: '12345678', amount: 1, status: 'unclaimed', claimId: null },
  ]]);
  claim: WttClaimRecord | null = null;
  log: string[] = [];
  failFinalization = 0;

  async runReservation<T>(operation: (transaction: WttClaimReservationTransaction) => Promise<T>): Promise<T> {
    let created: WttClaimRecord | null = null;
    const locks: string[] = [];
    let consumeAt: Date | null = null;
    const result = await operation({
      loadChallenge: async () => this.challenge,
      loadClaim: async () => this.claim,
      loadEntitlements: async (ids) => ids.map((id) => this.entitlements.get(id) ?? null),
      createClaim: (_id, value) => { created = value; },
      lockEntitlement: (id) => { locks.push(id); },
      consumeChallenge: (_id, value) => { consumeAt = value; },
    });
    if (created) this.claim = created;
    for (const id of locks) this.entitlements.set(id, {
      ...this.entitlements.get(id)!, status: 'claiming', claimId: CLAIM_ID,
    });
    if (consumeAt) this.challenge = { ...this.challenge, status: 'consumed', consumedAt: consumeAt };
    return result;
  }

  async loadClaim() { return this.claim; }

  async acquirePreparationLease(_id: string, token: string, now: Date) {
    if (!this.claim) throw new Error('missing claim');
    if (this.claim.currentAttempt || (this.claim.preparationLease
      && this.claim.preparationLease.expiresAt.getTime() > now.getTime())) {
      return { status: 'busy' as const, claim: this.claim };
    }
    const preparationLease = { token, expiresAt: new Date(now.getTime() + 120_000) };
    this.claim = { ...this.claim, status: 'preparing', preparationLease, updatedAt: now };
    return { status: 'acquired' as const, claim: this.claim, attemptNumber: this.claim.attemptCount + 1 };
  }

  async persistPreparedAttempt(_id: string, token: string, value: WttPreparedAttempt, now: Date) {
    if (!this.claim || this.claim.preparationLease?.token !== token) throw new Error('lease lost');
    this.log.push(`persist:${value.rawTransactionBase64}`);
    this.claim = {
      ...this.claim, status: 'prepared', currentAttempt: value,
      transactionSignature: value.transactionSignature, attemptCount: value.number,
      preparationLease: null, updatedAt: now,
    };
    return this.claim;
  }

  async releasePreparationLease(_id: string, token: string, now: Date) {
    if (this.claim?.preparationLease?.token === token) {
      this.claim = { ...this.claim, status: 'reserved', preparationLease: null, updatedAt: now };
    }
  }

  async markAttemptSubmitted(_id: string, signature: string, submittedAt: Date) {
    if (!this.claim?.currentAttempt || this.claim.currentAttempt.transactionSignature !== signature) {
      throw new Error('attempt mismatch');
    }
    this.claim = {
      ...this.claim, status: 'submitted', updatedAt: submittedAt,
      currentAttempt: { ...this.claim.currentAttempt, submittedAt },
    };
    return this.claim;
  }

  async retireAttempt(_id: string, signature: string, outcome: WttAttemptOutcome, resolvedAt: Date) {
    if (!this.claim?.currentAttempt || this.claim.currentAttempt.transactionSignature !== signature) {
      throw new Error('attempt mismatch');
    }
    const current = this.claim.currentAttempt;
    this.claim = {
      ...this.claim,
      status: 'reserved',
      currentAttempt: null,
      transactionSignature: null,
      preparationLease: null,
      updatedAt: resolvedAt,
      attemptHistory: [...this.claim.attemptHistory, {
        number: current.number,
        transactionSignature: signature,
        blockhash: current.blockhash,
        lastValidBlockHeight: current.lastValidBlockHeight,
        outcome,
        preparedAt: current.preparedAt,
        submittedAt: current.submittedAt,
        resolvedAt,
      }],
    };
    return this.claim;
  }

  async runFinalization<T>(operation: (transaction: WttClaimFinalizationTransaction) => Promise<T>): Promise<T> {
    if (this.failFinalization > 0) {
      this.failFinalization -= 1;
      throw new Error('firestore unavailable after chain success');
    }
    const updates: Array<{ id: string; signature: string }> = [];
    const confirmations: Array<{ signature: string; at: Date }> = [];
    const result = await operation({
      loadClaim: async () => this.claim,
      loadEntitlements: async (ids) => ids.map((id) => this.entitlements.get(id) ?? null),
      markEntitlementClaimed: (id, _claimId, _wallet, signature) => {
        updates.push({ id, signature });
      },
      markClaimConfirmed: (_id, signature, at) => { confirmations.push({ signature, at }); },
    });
    for (const update of updates) this.entitlements.set(update.id, {
      ...this.entitlements.get(update.id)!, status: 'claimed', claimId: CLAIM_ID,
    });
    const confirmation = confirmations[0];
    if (confirmation && this.claim) this.claim = {
      ...this.claim, status: 'confirmed', transactionSignature: confirmation.signature,
      confirmedAt: confirmation.at, updatedAt: confirmation.at,
    };
    return result;
  }
}

class FakeSolana implements WttSolanaGateway {
  prepareCount = 0;
  submittedRaw: string[] = [];
  statuses = new Map<string, WttChainAttemptStatus[]>();
  attemptExpired = false;
  failSubmit = 0;
  log: string[];

  constructor(log: string[]) { this.log = log; }

  async prepareAttempt(_claim: WttClaimRecord, number: number) {
    this.prepareCount += 1;
    const value = attempt(number);
    if (!this.statuses.has(value.transactionSignature)) {
      this.statuses.set(value.transactionSignature, ['not_found', 'pending']);
    }
    return value;
  }

  async getAttemptStatus(signature: string) {
    const values = this.statuses.get(signature) ?? ['not_found'];
    return values.length > 1 ? values.shift()! : values[0]!;
  }

  async isAttemptExpired() { return this.attemptExpired; }

  async submitPreparedAttempt(value: WttPreparedAttempt) {
    this.log.push(`broadcast:${value.rawTransactionBase64}`);
    this.submittedRaw.push(value.rawTransactionBase64);
    if (this.failSubmit > 0) {
      this.failSubmit -= 1;
      throw new Error('connection lost after possible broadcast');
    }
  }
}

function dependencies(store = new MemoryStore(), solana = new FakeSolana(store.log)): WttClaimServiceDependencies {
  return { store, solana, now: () => new Date(NOW), randomBytes };
}

function installAttempt(store: MemoryStore, value = attempt(), status: WttClaimRecord['status'] = 'prepared') {
  store.challenge = { ...store.challenge, status: 'consumed', consumedAt: NOW };
  store.entitlements.set('contribution:12', {
    ...store.entitlements.get('contribution:12')!, status: 'claiming', claimId: CLAIM_ID,
  });
  store.claim = {
    schemaVersion: 1,
    githubProviderId: '12345678',
    walletAddress: store.challenge.walletAddress,
    entitlementIds: ['contribution:12'],
    amount: 1,
    status,
    createdAt: NOW,
    updatedAt: NOW,
    confirmedAt: null,
    transactionSignature: value.transactionSignature,
    attemptCount: value.number,
    currentAttempt: value,
    attemptHistory: [],
    preparationLease: null,
  };
}

test('signed transaction is persisted before broadcast', async () => {
  const store = new MemoryStore();
  const solana = new FakeSolana(store.log);
  await executeWttClaim(AUTH, { challengeId: CLAIM_ID }, dependencies(store, solana));
  assert.deepEqual(store.log.slice(0, 2), [
    `persist:${attempt().rawTransactionBase64}`,
    `broadcast:${attempt().rawTransactionBase64}`,
  ]);
});

test('crash after preparation or possible broadcast resumes the exact same signed attempt', async () => {
  const store = new MemoryStore();
  const solana = new FakeSolana(store.log);
  solana.failSubmit = 1;
  await assert.rejects(
    executeWttClaim(AUTH, { challengeId: CLAIM_ID }, dependencies(store, solana)),
    /submitted|resume|connection/i,
  );
  assert.equal(store.claim?.status, 'prepared');
  const raw = store.claim?.currentAttempt?.rawTransactionBase64;
  solana.statuses.set('signature-1', ['not_found', 'pending']);
  const resumed = await executeWttClaim(AUTH, { challengeId: CLAIM_ID }, dependencies(store, solana));
  assert.equal(resumed.status, 'processing');
  assert.equal(solana.prepareCount, 1);
  assert.deepEqual(solana.submittedRaw, [raw, raw]);
});

test('confirmed prior signature finalizes Firestore without preparing or minting again', async () => {
  const store = new MemoryStore();
  installAttempt(store);
  const solana = new FakeSolana(store.log);
  solana.statuses.set('signature-1', ['confirmed']);
  const result = await executeWttClaim(AUTH, { challengeId: CLAIM_ID }, dependencies(store, solana));
  assert.equal(result.status, 'confirmed');
  assert.equal(store.claim?.status, 'confirmed');
  assert.equal(solana.prepareCount, 0);
  assert.equal(solana.submittedRaw.length, 0);
});

test('pending or absent-valid prior signatures never create a replacement transaction', async () => {
  for (const statuses of [['pending'], ['not_found', 'pending']] as WttChainAttemptStatus[][]) {
    const store = new MemoryStore();
    installAttempt(store);
    const solana = new FakeSolana(store.log);
    solana.statuses.set('signature-1', statuses);
    const result = await executeWttClaim(AUTH, { challengeId: CLAIM_ID }, dependencies(store, solana));
    assert.equal(result.status, 'processing');
    assert.equal(solana.prepareCount, 0);
    assert.deepEqual(solana.submittedRaw, [attempt().rawTransactionBase64]);
    assert.equal(store.claim?.transactionSignature, 'signature-1');
  }
});

test('absent expired or explicitly failed attempt is retired before one fresh state inspection', async () => {
  for (const priorStatus of ['not_found', 'failed'] as const) {
    const store = new MemoryStore();
    installAttempt(store);
    const solana = new FakeSolana(store.log);
    solana.statuses.set('signature-1', [priorStatus]);
    solana.attemptExpired = priorStatus === 'not_found';
    solana.statuses.set('signature-2', ['not_found', 'pending']);
    const result = await executeWttClaim(AUTH, { challengeId: CLAIM_ID }, dependencies(store, solana));
    assert.equal(result.status, 'processing');
    assert.equal(solana.prepareCount, 1);
    assert.equal(store.claim?.attemptCount, 2);
    assert.equal(store.claim?.attemptHistory[0]?.outcome,
      priorStatus === 'failed' ? 'failed' : 'expired');
  }
});

test('Firestore finalization failure after chain success retries finalization only', async () => {
  const store = new MemoryStore();
  installAttempt(store);
  store.failFinalization = 1;
  const solana = new FakeSolana(store.log);
  solana.statuses.set('signature-1', ['confirmed']);
  await assert.rejects(executeWttClaim(
    AUTH, { challengeId: CLAIM_ID }, dependencies(store, solana),
  ), /firestore unavailable/);
  const result = await executeWttClaim(AUTH, { challengeId: CLAIM_ID }, dependencies(store, solana));
  assert.equal(result.status, 'confirmed');
  assert.equal(solana.prepareCount, 0);
  assert.equal(solana.submittedRaw.length, 0);
});

test('simultaneous calls preserve one logical claim and one prepared attempt', async () => {
  const store = new MemoryStore();
  const solana = new FakeSolana(store.log);
  const deps = dependencies(store, solana);
  const [first, second] = await Promise.all([
    executeWttClaim(AUTH, { challengeId: CLAIM_ID }, deps),
    executeWttClaim(AUTH, { challengeId: CLAIM_ID }, deps),
  ]);
  assert.equal(first.claimId, CLAIM_ID);
  assert.equal(second.claimId, CLAIM_ID);
  assert.equal(solana.prepareCount, 1);
  assert.equal(store.claim?.attemptCount, 1);
  assert.equal(store.entitlements.get('contribution:12')?.claimId, CLAIM_ID);
});

test('structured lifecycle events omit signed transaction bytes and private identity data', async () => {
  const store = new MemoryStore();
  const solana = new FakeSolana(store.log);
  const events: unknown[] = [];
  await executeWttClaim(AUTH, { challengeId: CLAIM_ID }, {
    ...dependencies(store, solana), observe: (event) => events.push(event),
  });
  assert.ok(events.some((value) => (value as { event: string }).event === 'claim_reserved'));
  assert.ok(events.some((value) => (value as { event: string }).event === 'attempt_prepared'));
  const serialized = JSON.stringify(events);
  assert.doesNotMatch(serialized, /rawTransactionBase64|firebase|githubProviderId|walletAddress/);
});
