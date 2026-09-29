import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore';

const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
const projectId = `wtt-entitlement-rules-${process.pid}`;
const owner = { uid: 'firebase-owner', id: '1001' };
const other = { uid: 'firebase-other', id: '2002' };
const admin = { uid: 'firebase-admin', id: '9001' };
let environment;

function claims(identity) {
  return { firebase: { identities: { 'github.com': [identity.id] }, sign_in_provider: 'github.com' } };
}

function firestoreFor(identity) {
  return environment.authenticatedContext(identity.uid, claims(identity)).firestore();
}

function record(sourceId = '7', githubProviderId = owner.id, overrides = {}) {
  return {
    sourceType: 'contribution', sourceId, githubProviderId,
    contributorId: githubProviderId, amount: 1, status: 'unclaimed', claimId: null,
    earnedAt: Timestamp.now(), claimedAt: null, ...overrides,
  };
}

before(async () => {
  environment = await initializeTestEnvironment({ projectId, firestore: { rules } });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    await Promise.all([
      setDoc(doc(context.firestore(), 'wttEntitlements/contribution:7'), record()),
      setDoc(doc(context.firestore(), 'wttEntitlements/contribution:8'), record('8')),
      setDoc(doc(context.firestore(), 'wttEntitlements/contribution:9'), record('9', other.id)),
      setDoc(doc(context.firestore(), 'wttEntitlements/contribution:10'), record('10', owner.id, {
        status: 'claimed', claimId: 'claim-1', claimedAt: Timestamp.now(),
        claimedWallet: 'wallet-address', claimTransaction: 'transaction-signature',
      })),
      setDoc(doc(context.firestore(), 'wttEntitlements/contribution:11'), record('11', owner.id, {
        status: 'claiming', claimId: 'claim-in-progress', claimedAt: null,
      })),
      setDoc(doc(context.firestore(), `admins/${admin.id}`), {
        githubUserId: admin.id, role: 'owner', active: true,
      }),
      setDoc(doc(context.firestore(), 'wttClaimChallenges/server-created-challenge'), {
        githubProviderId: owner.id, status: 'issued', nonce: 'private',
      }),
      setDoc(doc(context.firestore(), 'wttClaims/server-created-claim'), {
        githubProviderId: owner.id, status: 'reserved', amount: 1,
      }),
    ]);
  });
});

after(async () => environment?.cleanup());

test('an authenticated GitHub identity can read only its own entitlements', async () => {
  await assertSucceeds(getDoc(doc(firestoreFor(owner), 'wttEntitlements/contribution:7')));
  await assertFails(getDoc(doc(firestoreFor(other), 'wttEntitlements/contribution:7')));
  await assertFails(getDoc(doc(firestoreFor(owner), 'wttEntitlements/contribution:9')));
  await assertFails(getDoc(doc(firestoreFor(admin), 'wttEntitlements/contribution:7')));
  await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), 'wttEntitlements/contribution:7')));
  const own = await assertSucceeds(getDocs(query(
    collection(firestoreFor(owner), 'wttEntitlements'),
    where('githubProviderId', '==', owner.id),
  )));
  if (own.size !== 4) throw new Error('Owner query did not return all entitlement lifecycle states.');
  await assertFails(getDocs(collection(firestoreFor(owner), 'wttEntitlements')));
});

test('a claiming entitlement remains owner-readable but cannot be changed by the browser', async () => {
  const reference = doc(firestoreFor(owner), 'wttEntitlements/contribution:11');
  await assertSucceeds(getDoc(reference));
  await assertFails(updateDoc(reference, { status: 'claimed', claimedAt: Timestamp.now() }));
});

test('no browser identity, including the owner and an active admin, can forge or mutate an entitlement', async () => {
  for (const firestore of [firestoreFor(owner), firestoreFor(other), firestoreFor(admin)]) {
    await assertFails(setDoc(doc(firestore, 'wttEntitlements/contribution:11'), record('11')));
    await assertFails(updateDoc(doc(firestore, 'wttEntitlements/contribution:7'), {
      status: 'claimed', claimId: 'forged-claim', claimedAt: Timestamp.now(),
    }));
    await assertFails(deleteDoc(doc(firestore, 'wttEntitlements/contribution:7')));
  }
});

test('wallet claim challenges are server-only for every browser identity', async () => {
  for (const firestore of [
    environment.unauthenticatedContext().firestore(),
    firestoreFor(owner),
    firestoreFor(other),
    firestoreFor(admin),
  ]) {
    const reference = doc(firestore, 'wttClaimChallenges/server-created-challenge');
    await assertFails(getDoc(reference));
    await assertFails(setDoc(doc(firestore, 'wttClaimChallenges/forged-challenge'), {
      githubProviderId: owner.id, status: 'verified',
    }));
    await assertFails(updateDoc(reference, { status: 'verified' }));
    await assertFails(deleteDoc(reference));
    await assertFails(getDocs(collection(firestore, 'wttClaimChallenges')));
  }
});

test('WTT claims are server-only for every browser identity', async () => {
  for (const firestore of [
    environment.unauthenticatedContext().firestore(),
    firestoreFor(owner),
    firestoreFor(other),
    firestoreFor(admin),
  ]) {
    const reference = doc(firestore, 'wttClaims/server-created-claim');
    await assertFails(getDoc(reference));
    await assertFails(getDocs(collection(firestore, 'wttClaims')));
    await assertFails(setDoc(doc(firestore, 'wttClaims/forged-claim'), {
      githubProviderId: owner.id, status: 'confirmed', amount: 999,
    }));
    await assertFails(updateDoc(reference, { status: 'confirmed' }));
    await assertFails(deleteDoc(reference));
  }
});
