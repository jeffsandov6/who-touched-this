import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
import {
  WTT_CLAIM_CHALLENGE_TTL_MS,
  WTT_MINT_ADDRESS,
  WttChallengeError,
  issueWttClaimChallenge,
  verifyWttClaimChallenge,
  type WttChallengeDependencies,
  type WttChallengeEntitlement,
  type WttChallengeTransaction,
  type WttClaimChallengeRecord,
} from '../src/wtt/challenges.js';

const AUTH_ID = '12345678';
const OTHER_ID = '87654321';
const START = new Date('2026-09-28T18:00:00.000Z');

function authToken(id = AUTH_ID): Record<string, unknown> {
  return { firebase: { identities: { 'github.com': [id] } } };
}

function keypair() {
  const keys = ed25519.keygen();
  return { ...keys, address: bs58.encode(keys.publicKey) };
}

function entitlement(id: string, owner = AUTH_ID, amount = 1): WttChallengeEntitlement {
  return { id, githubProviderId: owner, amount, status: 'unclaimed' };
}

class FakeDependencies implements WttChallengeDependencies {
  appOrigin = 'https://whotouchedthis.website';
  currentTime = new Date(START);
  entitlements = new Map<string, WttChallengeEntitlement>();
  challenges = new Map<string, WttClaimChallengeRecord>();

  now = () => new Date(this.currentTime);
  randomBytes = (size: number) => randomBytes(size);

  async loadEntitlements(ids: readonly string[]) {
    return ids.map((id) => this.entitlements.get(id) ?? null);
  }

  async createChallenge(id: string, record: WttClaimChallengeRecord) {
    if (this.challenges.has(id)) throw new Error('collision');
    this.challenges.set(id, record);
  }

  async runTransaction<T>(operation: (transaction: WttChallengeTransaction) => Promise<T>): Promise<T> {
    const updates: Array<{ id: string; verifiedAt: Date }> = [];
    const result = await operation({
      loadChallenge: async (id) => this.challenges.get(id) ?? null,
      loadEntitlements: async (ids) => ids.map((id) => this.entitlements.get(id) ?? null),
      markVerified(id, verifiedAt) {
        updates.push({ id, verifiedAt });
      },
    });
    for (const update of updates) {
      const challenge = this.challenges.get(update.id);
      if (!challenge) throw new Error('missing challenge');
      this.challenges.set(update.id, { ...challenge, status: 'verified', verifiedAt: update.verifiedAt });
    }
    return result;
  }
}

async function expectCode(operation: Promise<unknown>, code: WttChallengeError['code']) {
  await assert.rejects(operation, (error) => error instanceof WttChallengeError && error.code === code);
}

function canonicalSignature(secretKey: Uint8Array, message: string): string {
  return Buffer.from(ed25519.sign(new TextEncoder().encode(message), secretKey)).toString('base64');
}

async function issue(
  dependencies: FakeDependencies,
  walletAddress: string,
  ids = ['contribution:12'],
) {
  return issueWttClaimChallenge(authToken(), { walletAddress, entitlementIds: ids }, dependencies);
}

test('issuance requires GitHub auth and validates wallet and entitlement list input', async () => {
  const dependencies = new FakeDependencies();
  const wallet = keypair();
  dependencies.entitlements.set('contribution:12', entitlement('contribution:12'));
  await expectCode(issueWttClaimChallenge(null, {
    walletAddress: wallet.address, entitlementIds: ['contribution:12'],
  }, dependencies), 'unauthenticated');
  await expectCode(issue(dependencies, 'not-a-solana-address'), 'invalid-argument');
  await expectCode(issue(dependencies, wallet.address, []), 'invalid-argument');
  await expectCode(issue(dependencies, wallet.address, ['contribution:12', 'contribution:12']), 'invalid-argument');
  await expectCode(issueWttClaimChallenge(authToken(), {
    walletAddress: wallet.address, entitlementIds: ['contribution:12'], amount: 999,
  }, dependencies), 'invalid-argument');
});

test('issuance rejects missing, foreign, and claimed entitlements', async () => {
  const dependencies = new FakeDependencies();
  const wallet = keypair();
  await expectCode(issue(dependencies, wallet.address, ['contribution:404']), 'not-found');
  dependencies.entitlements.set('contribution:12', entitlement('contribution:12', OTHER_ID));
  await expectCode(issue(dependencies, wallet.address), 'permission-denied');
  dependencies.entitlements.set('contribution:12', {
    ...entitlement('contribution:12'), status: 'claimed',
  });
  await expectCode(issue(dependencies, wallet.address), 'failed-precondition');
});

test('issuance supports multiple entitlements, calculates amount, expiration, and stable message server-side', async () => {
  const dependencies = new FakeDependencies();
  const wallet = keypair();
  dependencies.entitlements.set('contribution:12', entitlement('contribution:12'));
  dependencies.entitlements.set('contribution:47', entitlement('contribution:47', AUTH_ID, 2));
  const result = await issue(dependencies, wallet.address, ['contribution:47', 'contribution:12']);
  const record = dependencies.challenges.get(result.challengeId)!;
  assert.equal(result.amount, 3);
  assert.deepEqual(record.entitlementIds, ['contribution:12', 'contribution:47']);
  assert.equal(record.expiresAt.getTime() - record.issuedAt.getTime(), WTT_CLAIM_CHALLENGE_TTL_MS);
  assert.equal(record.status, 'issued');
  assert.equal(record.verifiedAt, null);
  assert.equal(record.consumedAt, null);
  assert.match(record.message, /^Who Touched This\nWTT claim verification\n/);
  assert.ok(record.message.includes('This is not a transaction.'));
  assert.ok(record.message.includes(`WTT mint: ${WTT_MINT_ADDRESS}`));
  assert.ok(record.message.includes('Amount: 3 WTT'));
});

test('challenge IDs and nonces use independent nondeterministic values', async () => {
  const dependencies = new FakeDependencies();
  const wallet = keypair();
  dependencies.entitlements.set('contribution:12', entitlement('contribution:12'));
  const first = await issue(dependencies, wallet.address);
  const second = await issue(dependencies, wallet.address);
  assert.notEqual(first.challengeId, second.challengeId);
  assert.notEqual(dependencies.challenges.get(first.challengeId)!.nonce,
    dependencies.challenges.get(second.challengeId)!.nonce);
  assert.notEqual(first.challengeId, dependencies.challenges.get(first.challengeId)!.nonce);
});

test('valid Ed25519 signature verifies the stored UTF-8 message without claiming entitlements', async () => {
  const dependencies = new FakeDependencies();
  const wallet = keypair();
  dependencies.entitlements.set('contribution:12', entitlement('contribution:12'));
  const challenge = await issue(dependencies, wallet.address);
  const result = await verifyWttClaimChallenge(authToken(), {
    challengeId: challenge.challengeId,
    signature: canonicalSignature(wallet.secretKey, challenge.message),
  }, dependencies);
  assert.equal(result.status, 'verified');
  assert.equal(result.walletAddress, wallet.address);
  assert.equal(dependencies.challenges.get(challenge.challengeId)!.status, 'verified');
  assert.equal(dependencies.entitlements.get('contribution:12')!.status, 'unclaimed');
});

test('signature verification requires authenticated GitHub identity', async () => {
  const dependencies = new FakeDependencies();
  const wallet = keypair();
  dependencies.entitlements.set('contribution:12', entitlement('contribution:12'));
  const challenge = await issue(dependencies, wallet.address);
  await expectCode(verifyWttClaimChallenge(null, {
    challengeId: challenge.challengeId,
    signature: canonicalSignature(wallet.secretKey, challenge.message),
  }, dependencies), 'unauthenticated');
});

test('wrong-wallet, modified-message, and malformed signatures fail', async () => {
  const dependencies = new FakeDependencies();
  const wallet = keypair();
  const wrongWallet = keypair();
  dependencies.entitlements.set('contribution:12', entitlement('contribution:12'));
  const challenge = await issue(dependencies, wallet.address);
  await expectCode(verifyWttClaimChallenge(authToken(), {
    challengeId: challenge.challengeId,
    signature: canonicalSignature(wrongWallet.secretKey, challenge.message),
  }, dependencies), 'permission-denied');
  await expectCode(verifyWttClaimChallenge(authToken(), {
    challengeId: challenge.challengeId,
    signature: canonicalSignature(wallet.secretKey, `${challenge.message}\nmodified`),
  }, dependencies), 'permission-denied');
  await expectCode(verifyWttClaimChallenge(authToken(), {
    challengeId: challenge.challengeId, signature: 'not-base64',
  }, dependencies), 'invalid-argument');
});

test('expired, foreign-owned, and consumed challenges fail', async () => {
  const dependencies = new FakeDependencies();
  const wallet = keypair();
  dependencies.entitlements.set('contribution:12', entitlement('contribution:12'));
  const expired = await issue(dependencies, wallet.address);
  dependencies.currentTime = new Date(START.getTime() + WTT_CLAIM_CHALLENGE_TTL_MS);
  await expectCode(verifyWttClaimChallenge(authToken(), {
    challengeId: expired.challengeId,
    signature: canonicalSignature(wallet.secretKey, expired.message),
  }, dependencies), 'failed-precondition');

  dependencies.currentTime = new Date(START);
  const foreign = await issue(dependencies, wallet.address);
  await expectCode(verifyWttClaimChallenge(authToken(OTHER_ID), {
    challengeId: foreign.challengeId,
    signature: canonicalSignature(wallet.secretKey, foreign.message),
  }, dependencies), 'permission-denied');

  const record = dependencies.challenges.get(foreign.challengeId)!;
  dependencies.challenges.set(foreign.challengeId, { ...record, status: 'consumed' });
  await expectCode(verifyWttClaimChallenge(authToken(), {
    challengeId: foreign.challengeId,
    signature: canonicalSignature(wallet.secretKey, foreign.message),
  }, dependencies), 'failed-precondition');
});

test('verification transaction rejects an entitlement claimed after issuance', async () => {
  const dependencies = new FakeDependencies();
  const wallet = keypair();
  dependencies.entitlements.set('contribution:12', entitlement('contribution:12'));
  const challenge = await issue(dependencies, wallet.address);
  dependencies.entitlements.set('contribution:12', {
    ...entitlement('contribution:12'), status: 'claimed',
  });
  await expectCode(verifyWttClaimChallenge(authToken(), {
    challengeId: challenge.challengeId,
    signature: canonicalSignature(wallet.secretKey, challenge.message),
  }, dependencies), 'failed-precondition');
  assert.equal(dependencies.challenges.get(challenge.challengeId)!.status, 'issued');
});

test('repeated verification safely returns the existing verified state', async () => {
  const dependencies = new FakeDependencies();
  const wallet = keypair();
  dependencies.entitlements.set('contribution:12', entitlement('contribution:12'));
  const challenge = await issue(dependencies, wallet.address);
  const input = {
    challengeId: challenge.challengeId,
    signature: canonicalSignature(wallet.secretKey, challenge.message),
  };
  const first = await verifyWttClaimChallenge(authToken(), input, dependencies);
  dependencies.currentTime = new Date(START.getTime() + WTT_CLAIM_CHALLENGE_TTL_MS * 2);
  const repeated = await verifyWttClaimChallenge(authToken(), input, dependencies);
  assert.deepEqual(repeated, first);
});
