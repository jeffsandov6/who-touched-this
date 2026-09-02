import assert from 'node:assert/strict';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const projectId = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId || !process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('This integration check must run inside Firebase emulators:exec.');
}
if (getApps().length === 0) initializeApp({ projectId });
const firestore = getFirestore();
const suffix = `${Date.now()}`;
const githubUserId = `8${suffix.slice(-8)}`;
const invitationId = `email-check-${suffix}`;
const deliveryId = `invitation_${invitationId}`;
const now = Timestamp.now();

await firestore.doc(`contributors/${githubUserId}`).set({
  firebaseUid: `test-${suffix}`,
  githubUserId,
  githubUsername: `email-check-${suffix.slice(-6)}`,
  displayName: 'Email Check Contributor',
  email: 'local-recipient@example.test',
  createdAt: now,
  updatedAt: now,
});
await firestore.doc(`invitations/${invitationId}`).set({
  githubUserId,
  season: 1,
  status: 'pending',
  invitedAt: now,
  acceptBy: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
  turnDurationHours: 168,
  createdAt: now,
  updatedAt: now,
});

let delivery;
let mailbox;
for (let attempt = 0; attempt < 50; attempt += 1) {
  [delivery, mailbox] = await Promise.all([
    firestore.doc(`emailDeliveries/${deliveryId}`).get(),
    firestore.doc(`devEmailSink/${deliveryId}`).get(),
  ]);
  if (delivery.data()?.status === 'sent' && mailbox.exists) break;
  await new Promise((resolve) => setTimeout(resolve, 200));
}

assert.equal(delivery?.data()?.status, 'sent');
assert.equal(mailbox?.data()?.to, 'local-recipient@example.test');
assert.equal(mailbox?.data()?.subject, 'Your turn on Who Touched This');
assert.match(mailbox?.data()?.text ?? '', /localhost:4321\/join/);
assert.match(mailbox?.data()?.text ?? '', /7 days/);
assert.doesNotMatch(mailbox?.data()?.text ?? '', new RegExp(githubUserId));
assert.equal((await firestore.doc(`invitations/${invitationId}`).get()).data()?.status, 'pending');
assert.equal((await firestore.collection('turns').get()).empty, true);

console.log('Invitation trigger delivered exactly one local mailbox message.');
