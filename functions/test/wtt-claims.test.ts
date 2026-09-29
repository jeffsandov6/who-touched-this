import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WttClaimError,
  finalizeWttClaim,
  reserveWttClaim,
  type WttClaimChallengeSnapshot,
  type WttClaimEntitlementSnapshot,
  type WttClaimFinalizationTransaction,
  type WttClaimRecord,
  type WttClaimReservationTransaction,
  type WttClaimStateStore,
} from '../src/wtt/claims.js';

const CLAIM_ID = 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789';
const OWNER = '12345678';
const OTHER = '87654321';
const NOW = new Date('2026-09-28T18:00:00.000Z');

function auth(id = OWNER): Record<string, unknown> {
  return { firebase: { identities: { 'github.com': [id] } } };
}

function challenge(overrides: Partial<WttClaimChallengeSnapshot> = {}): WttClaimChallengeSnapshot {
  return {
    id: CLAIM_ID,
    schemaVersion: 1,
    githubProviderId: OWNER,
    walletAddress: '11111111111111111111111111111111',
    entitlementIds: ['contribution:12', 'contribution:47'],
    amount: 2,
    status: 'verified',
    expiresAt: new Date(NOW.getTime() + 60_000),
    verifiedAt: NOW,
    consumedAt: null,
    ...overrides,
  };
}

function entitlement(id: string, overrides: Partial<WttClaimEntitlementSnapshot> = {}): WttClaimEntitlementSnapshot {
  return { id, githubProviderId: OWNER, amount: 1, status: 'unclaimed', claimId: null, ...overrides };
}

function claimRecord(overrides: Partial<WttClaimRecord> = {}): WttClaimRecord {
  return {
    schemaVersion: 1,
    githubProviderId: OWNER,
    walletAddress: '11111111111111111111111111111111',
    entitlementIds: ['contribution:12', 'contribution:47'],
    amount: 2,
    status: 'reserved',
    createdAt: NOW,
    updatedAt: NOW,
    confirmedAt: null,
    transactionSignature: null,
    attemptCount: 0,
    currentAttempt: null,
    attemptHistory: [],
    preparationLease: null,
    ...overrides,
  };
}

class ReservationStore implements WttClaimStateStore {
  challenge = challenge();
  claim: WttClaimRecord | null = null;
  entitlements = new Map([
    ['contribution:12', entitlement('contribution:12')],
    ['contribution:47', entitlement('contribution:47')],
  ]);
  finalizedEntitlements = new Map<string, { wallet: string; signature: string; at: Date }>();

  async runReservation<T>(operation: (transaction: WttClaimReservationTransaction) => Promise<T>): Promise<T> {
    let created: WttClaimRecord | null = null;
    const locks: string[] = [];
    let consumedAt: Date | null = null;
    const result = await operation({
      loadChallenge: async (id) => id === this.challenge.id ? this.challenge : null,
      loadClaim: async () => this.claim,
      loadEntitlements: async (ids) => ids.map((id) => this.entitlements.get(id) ?? null),
      createClaim: (_id, value) => { created = value; },
      lockEntitlement: (id) => { locks.push(id); },
      consumeChallenge: (_id, at) => { consumedAt = at; },
    });
    if (created) this.claim = created;
    for (const id of locks) this.entitlements.set(id, {
      ...this.entitlements.get(id)!, status: 'claiming', claimId: CLAIM_ID,
    });
    if (consumedAt) this.challenge = { ...this.challenge, status: 'consumed', consumedAt };
    return result;
  }

  async runFinalization<T>(operation: (transaction: WttClaimFinalizationTransaction) => Promise<T>): Promise<T> {
    const claimed: Array<{ id: string; wallet: string; signature: string; at: Date }> = [];
    const confirmations: Array<{ signature: string; at: Date }> = [];
    const result = await operation({
      loadClaim: async () => this.claim,
      loadEntitlements: async (ids) => ids.map((id) => this.entitlements.get(id) ?? null),
      markEntitlementClaimed(id, _claimId, wallet, signature, at) {
        claimed.push({ id, wallet, signature, at });
      },
      markClaimConfirmed: (_id, signature, at) => { confirmations.push({ signature, at }); },
    });
    for (const update of claimed) {
      this.entitlements.set(update.id, {
        ...this.entitlements.get(update.id)!, status: 'claimed', claimId: CLAIM_ID,
      });
      this.finalizedEntitlements.set(update.id, {
        wallet: update.wallet, signature: update.signature, at: update.at,
      });
    }
    const confirmed = confirmations[0];
    if (confirmed && this.claim) this.claim = {
      ...this.claim,
      status: 'confirmed',
      transactionSignature: confirmed.signature,
      confirmedAt: confirmed.at,
      updatedAt: confirmed.at,
    };
    return result;
  }

  async loadClaim() { return this.claim; }
  async acquirePreparationLease(): Promise<never> { throw new Error('unused'); }
  async persistPreparedAttempt(): Promise<never> { throw new Error('unused'); }
  async releasePreparationLease(): Promise<void> { throw new Error('unused'); }
  async markAttemptSubmitted(): Promise<never> { throw new Error('unused'); }
  async retireAttempt(): Promise<never> { throw new Error('unused'); }
}

async function expectCode(operation: Promise<unknown>, code: WttClaimError['code']) {
  await assert.rejects(operation, (error) => error instanceof WttClaimError && error.code === code);
}

test('claim reservation rejects unauthenticated, unverified, and expired starts', async () => {
  const store = new ReservationStore();
  await expectCode(reserveWttClaim(null, { challengeId: CLAIM_ID }, NOW, store), 'unauthenticated');
  store.challenge = challenge({ status: 'issued' });
  await expectCode(reserveWttClaim(auth(), { challengeId: CLAIM_ID }, NOW, store), 'failed-precondition');
  store.challenge = challenge({ expiresAt: NOW });
  await expectCode(reserveWttClaim(auth(), { challengeId: CLAIM_ID }, NOW, store), 'failed-precondition');
});

test('consumed challenge resumes its matching claim even after challenge expiration', async () => {
  const store = new ReservationStore();
  store.challenge = challenge({ status: 'consumed', expiresAt: new Date(0), consumedAt: NOW });
  store.claim = claimRecord();
  for (const [id, value] of store.entitlements) {
    store.entitlements.set(id, { ...value, status: 'claiming', claimId: CLAIM_ID });
  }
  const result = await reserveWttClaim(auth(), { challengeId: CLAIM_ID }, NOW, store);
  assert.equal(result.claimId, CLAIM_ID);
  assert.equal(result.claim, store.claim);
});

test('reservation rejects foreign challenge and foreign entitlement identities', async () => {
  const store = new ReservationStore();
  await expectCode(reserveWttClaim(auth(OTHER), { challengeId: CLAIM_ID }, NOW, store), 'permission-denied');
  store.entitlements.set('contribution:47', entitlement('contribution:47', { githubProviderId: OTHER }));
  await expectCode(reserveWttClaim(auth(), { challengeId: CLAIM_ID }, NOW, store), 'permission-denied');
  assert.equal(store.claim, null);
  assert.equal(store.challenge.status, 'verified');
});

test('claimed and overlapping claiming entitlements reject atomically', async () => {
  const claimedStore = new ReservationStore();
  claimedStore.entitlements.set('contribution:47', entitlement('contribution:47', {
    status: 'claimed', claimId: 'old-claim',
  }));
  await expectCode(reserveWttClaim(auth(), { challengeId: CLAIM_ID }, NOW, claimedStore), 'failed-precondition');
  assert.equal(claimedStore.entitlements.get('contribution:12')!.status, 'unclaimed');
  assert.equal(claimedStore.challenge.status, 'verified');

  const overlapStore = new ReservationStore();
  overlapStore.entitlements.set('contribution:47', entitlement('contribution:47', {
    status: 'claiming', claimId: 'another-claim',
  }));
  await expectCode(reserveWttClaim(auth(), { challengeId: CLAIM_ID }, NOW, overlapStore), 'failed-precondition');
  assert.equal(overlapStore.entitlements.get('contribution:12')!.status, 'unclaimed');
});

test('multiple entitlements, authoritative amount, claim creation, locks, and challenge consumption are atomic', async () => {
  const store = new ReservationStore();
  const result = await reserveWttClaim(auth(), { challengeId: CLAIM_ID }, NOW, store);
  assert.equal(result.claim.amount, 2);
  assert.equal(store.claim?.amount, 2);
  assert.equal(store.claim?.status, 'reserved');
  assert.equal(store.challenge.status, 'consumed');
  assert.ok([...store.entitlements.values()].every((value) =>
    value.status === 'claiming' && value.claimId === CLAIM_ID));

  const duplicate = await reserveWttClaim(auth(), { challengeId: CLAIM_ID }, NOW, store);
  assert.equal(duplicate.claimId, result.claimId);
  assert.equal(store.claim?.attemptCount, 0);
});

test('client cannot influence authoritative amount and mismatched challenge amount fails', async () => {
  const store = new ReservationStore();
  await expectCode(reserveWttClaim(auth(), { challengeId: CLAIM_ID, amount: 999 }, NOW, store), 'invalid-argument');
  store.challenge = challenge({ amount: 999 });
  await expectCode(reserveWttClaim(auth(), { challengeId: CLAIM_ID }, NOW, store), 'failed-precondition');
});

test('finalization atomically claims every locked entitlement and is idempotent', async () => {
  const store = new ReservationStore();
  store.challenge = challenge({ status: 'consumed', consumedAt: NOW });
  const signature = 'confirmed-signature';
  store.claim = claimRecord({
    status: 'submitted',
    attemptCount: 1,
    transactionSignature: signature,
    currentAttempt: {
      number: 1, transactionSignature: signature, rawTransactionBase64: 'AA==',
      blockhash: 'blockhash', lastValidBlockHeight: 42, preparedAt: NOW, submittedAt: NOW,
    },
  });
  for (const [id, value] of store.entitlements) {
    store.entitlements.set(id, { ...value, status: 'claiming', claimId: CLAIM_ID });
  }
  const first = await finalizeWttClaim(CLAIM_ID, signature, NOW, store);
  assert.equal(first.status, 'confirmed');
  assert.equal(store.claim?.status, 'confirmed');
  assert.equal(store.claim?.transactionSignature, signature);
  assert.ok([...store.entitlements.values()].every((value) => value.status === 'claimed'));
  assert.deepEqual(store.finalizedEntitlements.get('contribution:12'), {
    wallet: store.challenge.walletAddress, signature, at: NOW,
  });
  assert.deepEqual(store.finalizedEntitlements.get('contribution:47'), {
    wallet: store.challenge.walletAddress, signature, at: NOW,
  });
  assert.deepEqual(await finalizeWttClaim(CLAIM_ID, signature, NOW, store), first);
});

test('finalization fails atomically when any entitlement is not locked by this claim', async () => {
  const store = new ReservationStore();
  const signature = 'confirmed-signature';
  store.claim = claimRecord({
    status: 'submitted', transactionSignature: signature,
    currentAttempt: {
      number: 1, transactionSignature: signature, rawTransactionBase64: 'AA==',
      blockhash: 'blockhash', lastValidBlockHeight: 42, preparedAt: NOW, submittedAt: NOW,
    },
  });
  store.entitlements.set('contribution:12', entitlement('contribution:12', {
    status: 'claiming', claimId: CLAIM_ID,
  }));
  await expectCode(finalizeWttClaim(CLAIM_ID, signature, NOW, store), 'failed-precondition');
  assert.notEqual(store.claim?.status, 'confirmed');
  assert.notEqual(store.entitlements.get('contribution:12')?.status, 'claimed');
});
