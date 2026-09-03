import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  collection,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';

const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
const projectId = `wtt-email-rules-${process.pid}`;
const admin = { uid: 'firebase-admin', id: '9001' };
const contributor = { uid: 'firebase-contributor', id: '1001' };
let environment;

function claims(id) {
  return { firebase: { identities: { 'github.com': [id] }, sign_in_provider: 'github.com' } };
}

function firestoreFor(identity) {
  return environment.authenticatedContext(identity.uid, claims(identity.id)).firestore();
}

before(async () => {
  environment = await initializeTestEnvironment({ projectId, firestore: { rules } });
});
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await Promise.all([
      setDoc(doc(firestore, `admins/${admin.id}`), {
        githubUserId: admin.id, role: 'owner', active: true,
      }),
      setDoc(doc(firestore, 'emailDeliveries/invitation_abc'), {
        type: 'invitation', invitationId: 'abc', githubUserId: contributor.id,
        status: 'sent', attemptCount: 1, attemptedAt: Timestamp.now(),
        sentAt: Timestamp.now(), providerMessageId: 'provider-1',
        createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      }),
      setDoc(doc(firestore, 'devEmailSink/invitation_abc'), {
        to: 'private@example.test', subject: 'private body',
      }),
      setDoc(doc(firestore, 'githubWebhookDeliveries/delivery-abc'), {
        event: 'pull_request', action: 'opened', repository: 'owner/repository',
        status: 'processed', resultCode: 'submitted',
        receivedAt: Timestamp.now(), processedAt: Timestamp.now(),
      }),
    ]);
  });
});
after(async () => environment?.cleanup());

test('email delivery state is private except for an active admin get', async () => {
  const path = 'emailDeliveries/invitation_abc';
  await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), path)));
  await assertFails(getDoc(doc(firestoreFor(contributor), path)));
  await assertSucceeds(getDoc(doc(firestoreFor(admin), path)));
  await assertFails(getDocs(collection(firestoreFor(admin), 'emailDeliveries')));
});

test('no browser identity can create, update, or delete delivery records', async () => {
  for (const firestore of [firestoreFor(contributor), firestoreFor(admin)]) {
    await assertFails(setDoc(doc(firestore, 'emailDeliveries/arbitrary'), {
      status: 'sent',
    }));
    await assertFails(updateDoc(doc(firestore, 'emailDeliveries/invitation_abc'), {
      status: 'failed',
    }));
    await assertFails(deleteDoc(doc(firestore, 'emailDeliveries/invitation_abc')));
  }
});

test('the local mailbox is inaccessible to browsers, including admins', async () => {
  for (const firestore of [
    environment.unauthenticatedContext().firestore(),
    firestoreFor(contributor),
    firestoreFor(admin),
  ]) {
    await assertFails(getDoc(doc(firestore, 'devEmailSink/invitation_abc')));
  }
});

test('GitHub webhook delivery diagnostics are inaccessible to every browser role', async () => {
  for (const firestore of [
    environment.unauthenticatedContext().firestore(),
    firestoreFor(contributor),
    firestoreFor(admin),
  ]) {
    const reference = doc(firestore, 'githubWebhookDeliveries/delivery-abc');
    await assertFails(getDoc(reference));
    await assertFails(setDoc(doc(firestore, 'githubWebhookDeliveries/arbitrary'), { status: 'processed' }));
    await assertFails(updateDoc(reference, { resultCode: 'changed' }));
    await assertFails(deleteDoc(reference));
  }
});
