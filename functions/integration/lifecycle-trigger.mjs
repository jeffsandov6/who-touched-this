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
const githubUserId = `6${suffix.slice(-8)}`;
const turnId = `lifecycle-email-${suffix}`;
const now = Timestamp.now();

await firestore.doc(`contributors/${githubUserId}`).set({
  githubUserId,
  displayName: 'Lifecycle Email Contributor',
  email: 'lifecycle-recipient@example.test',
});
await firestore.doc(`turns/${turnId}`).set({
  githubUserId, season: 1, status: 'active', targetContributionNumber: 1,
  startedAt: now, dueAt: Timestamp.fromMillis(Date.now() + 168 * 60 * 60 * 1000),
  createdAt: now, updatedAt: now,
});

async function waitForSent(deliveryId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [delivery, mailbox] = await Promise.all([
      firestore.doc(`emailDeliveries/${deliveryId}`).get(),
      firestore.doc(`devEmailSink/${deliveryId}`).get(),
    ]);
    if (delivery.data()?.status === 'sent' && mailbox.exists) return mailbox.data();
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${deliveryId}.`);
}

const started = await waitForSent(`turn_started_${turnId}`);
assert.equal(started.to, 'lifecycle-recipient@example.test');
assert.match(started.subject, /turn has started/);

const batch = firestore.batch();
batch.set(firestore.doc('contributions/1'), {
  number: 1, season: 1, displayName: 'Lifecycle Email Contributor', githubUsername: 'lifecycle-check',
  summary: 'Added an emulator lifecycle check.', prNumber: 27,
  prUrl: 'https://github.com/example/repo/pull/27', mergedAt: now, createdAt: now,
});
batch.update(firestore.doc(`turns/${turnId}`), {
  status: 'merged', mergedAt: now, endedAt: now,
  prNumber: 27, prUrl: 'https://github.com/example/repo/pull/27', updatedAt: now,
});
await batch.commit();

const completed = await waitForSent('contribution_completed_1');
assert.equal(completed.to, 'lifecycle-recipient@example.test');
assert.match(completed.subject, /Contribution #001/);
assert.match(completed.text, /\/history/);
assert.equal((await firestore.doc(`turns/${turnId}`).get()).data()?.status, 'merged');
console.log('Turn-started and completion triggers delivered once without changing lifecycle state.');
