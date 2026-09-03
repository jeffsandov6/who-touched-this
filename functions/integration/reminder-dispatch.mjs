import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { FirestoreDeliveryStore } from '../lib/src/email/firestore-delivery-store.js';
import { LocalMailboxEmailProvider } from '../lib/src/email/local-provider.js';
import { dispatchEligibleNotifications } from '../lib/src/email/reminder-dispatcher.js';

const projectId = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId || !process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('This reminder check must run inside the Firestore emulator.');
}
if (getApps().length === 0) initializeApp({ projectId });
const firestore = getFirestore();
const now = new Date();
const hour = 60 * 60 * 1000;
const suffix = `${Date.now()}`;
const githubUserId = `7${suffix.slice(-8)}`;

await firestore.doc(`contributors/${githubUserId}`).set({
  githubUserId,
  displayName: 'Reminder Check Contributor',
  email: 'reminder-recipient@example.test',
});

const timestamp = (milliseconds) => Timestamp.fromMillis(milliseconds);
const invitations = [{
  id: `reminder-invitation-${suffix}`,
  data: {
    githubUserId, status: 'pending', turnDurationHours: 168,
    invitedAt: timestamp(now.getTime() - 20 * hour),
    acceptBy: timestamp(now.getTime() + 4 * hour),
  },
}];
const turns = [
  { id: `reminder-72-${suffix}`, data: {
    githubUserId, status: 'active', targetContributionNumber: 1,
    startedAt: timestamp(now.getTime() - 100 * hour), dueAt: timestamp(now.getTime() + 70 * hour),
  } },
  { id: `reminder-24-${suffix}`, data: {
    githubUserId, status: 'active', targetContributionNumber: 1,
    startedAt: timestamp(now.getTime() - 100 * hour), dueAt: timestamp(now.getTime() + 20 * hour),
  } },
  { id: `reminder-past-${suffix}`, data: {
    githubUserId, status: 'active', targetContributionNumber: 1,
    startedAt: timestamp(now.getTime() - 100 * hour), dueAt: timestamp(now.getTime() - hour),
  } },
];

const dependencies = {
  appOrigin: 'http://localhost:4321',
  deliveryStore: new FirestoreDeliveryStore(firestore),
  emailProvider: new LocalMailboxEmailProvider(firestore),
  async loadContributor(id) {
    const snapshot = await firestore.doc(`contributors/${id}`).get();
    return snapshot.exists ? snapshot.data() : null;
  },
};
const input = { now, invitations, turns, claimToken: randomUUID };
await dispatchEligibleNotifications(input, dependencies);
await dispatchEligibleNotifications(input, dependencies);

const expectedDeliveryIds = [
  `invitation_reminder_${invitations[0].id}`,
  `turn_72h_reminder_${turns[0].id}`,
  `turn_24h_reminder_${turns[1].id}`,
  `turn_deadline_passed_${turns[2].id}`,
];
for (const deliveryId of expectedDeliveryIds) {
  assert.equal((await firestore.doc(`emailDeliveries/${deliveryId}`).get()).data()?.status, 'sent');
  assert.equal((await firestore.doc(`devEmailSink/${deliveryId}`).get()).exists, true);
}
assert.equal((await firestore.collection('devEmailSink').get()).docs
  .filter((document) => expectedDeliveryIds.includes(document.id)).length, 4);
console.log('Reminder dispatcher produced four idempotent local messages without lifecycle writes.');
