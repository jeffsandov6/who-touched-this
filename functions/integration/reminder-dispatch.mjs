import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { FirestoreDeliveryStore } from '../lib/src/email/firestore-delivery-store.js';
import { LocalMailboxEmailProvider } from '../lib/src/email/local-provider.js';
import { dispatchEligibleNotifications } from '../lib/src/email/reminder-dispatcher.js';
import { submitCurrentTurnFromWebhook } from '../lib/src/github/submission.js';

const projectId = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId || !process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('This reminder check must run inside the Firestore emulator.');
}
if (getApps().length === 0) initializeApp({ projectId });
const firestore = getFirestore();
const baseTime = new Date('2030-01-10T12:00:00.000Z');
const hour = 60 * 60 * 1000;
const suffix = `${Date.now()}`;
const githubUserId = `7${suffix.slice(-8)}`;
const timestamp = (milliseconds) => Timestamp.fromMillis(milliseconds);

await firestore.doc(`contributors/${githubUserId}`).set({
  githubUserId,
  displayName: 'Reminder Check Contributor',
  email: 'reminder-recipient@example.test',
});

const dependencies = (emailProvider = new LocalMailboxEmailProvider(firestore)) => ({
  appOrigin: 'http://localhost:4321',
  deliveryStore: new FirestoreDeliveryStore(firestore),
  emailProvider,
  async loadContributor(id) {
    const snapshot = await firestore.doc(`contributors/${id}`).get();
    return snapshot.exists ? snapshot.data() : null;
  },
});

async function sweep(id, data, now, emailProvider) {
  const errors = [];
  await dispatchEligibleNotifications({
    now, invitations: [], turns: [{ id, data }], claimToken: randomUUID,
    onError: (_sourceId, error) => errors.push(error),
  }, dependencies(emailProvider));
  return errors;
}

async function sweepInvitation(id, data, now) {
  await dispatchEligibleNotifications({
    now, invitations: [{ id, data }], turns: [], claimToken: randomUUID,
  }, dependencies());
}

async function delivery(id) {
  return (await firestore.doc(`emailDeliveries/${id}`).get()).data();
}

async function mailbox(id) {
  return (await firestore.doc(`devEmailSink/${id}`).get()).data();
}

function longTurn(status = 'active') {
  const dueAt = baseTime.getTime() + 72 * hour;
  return {
    githubUserId, status, targetContributionNumber: 1,
    startedAt: timestamp(dueAt - 168 * hour), dueAt: timestamp(dueAt),
  };
}

async function operationalState(turnId) {
  const [turn, admin, publicSite, queue, participation, contributions, history] = await Promise.all([
    firestore.doc(`turns/${turnId}`).get(),
    firestore.doc('site/admin').get(),
    firestore.doc('site/public').get(),
    firestore.doc(`queue/1_${githubUserId}`).get(),
    firestore.doc(`participation/1_${githubUserId}`).get(),
    firestore.collection('contributions').get(),
    firestore.collection('historyEvents').get(),
  ]);
  return {
    turn: turn.data(), admin: admin.data(), publicSite: publicSite.data(),
    queue: queue.data(), participation: participation.data(),
    contributions: contributions.size, history: history.size,
  };
}

// Scenarios A-C: the same long active turn progresses through all three disjoint windows.
const progressingId = `reminder-progressing-${suffix}`;
const progressing = longTurn();
const siteNow = timestamp(baseTime.getTime());
const progressingRecord = {
  ...progressing, season: 1, createdAt: siteNow, updatedAt: siteNow,
};
await Promise.all([
  firestore.doc(`turns/${progressingId}`).set(progressingRecord),
  firestore.doc('site/admin').set({ activeTurnId: progressingId, pendingInvitationId: null, updatedAt: siteNow }),
  firestore.doc('site/public').set({
    currentVersion: 0, totalContributions: 0, turnStatus: 'active',
    currentContributor: { displayName: 'Reminder Check Contributor', githubUsername: 'reminder-check' },
    targetContributionNumber: 1, dueAt: progressing.dueAt, updatedAt: siteNow,
  }),
  firestore.doc(`queue/1_${githubUserId}`).set({
    githubUserId, season: 1, status: 'active', joinedAt: siteNow, updatedAt: siteNow,
  }),
  firestore.doc(`participation/1_${githubUserId}`).set({
    githubUserId, season: 1, status: 'active', createdAt: siteNow, updatedAt: siteNow,
  }),
]);
const beforeReminders = await operationalState(progressingId);

// Preserve invitation-reminder integration coverage alongside the turn scenarios.
const invitationId = `reminder-invitation-${suffix}`;
const invitation = {
  githubUserId, status: 'pending', turnDurationHours: 168,
  invitedAt: timestamp(baseTime.getTime() - 20 * hour),
  acceptBy: timestamp(baseTime.getTime() + 4 * hour),
};
await firestore.doc(`invitations/${invitationId}`).set(invitation);
const beforeInvitationSweep = {
  operational: await operationalState(progressingId),
  invitation: (await firestore.doc(`invitations/${invitationId}`).get()).data(),
};
await sweepInvitation(invitationId, invitation, baseTime);
await sweepInvitation(invitationId, invitation, baseTime);
const invitationDeliveryId = `invitation_reminder_${invitationId}`;
assert.equal((await delivery(invitationDeliveryId))?.status, 'sent');
assert.equal((await delivery(invitationDeliveryId))?.attemptCount, 1);
assert.ok(await mailbox(invitationDeliveryId));
assert.deepEqual({
  operational: await operationalState(progressingId),
  invitation: (await firestore.doc(`invitations/${invitationId}`).get()).data(),
}, beforeInvitationSweep);

for (const at of [baseTime, baseTime]) await sweep(progressingId, progressing, at);
assert.equal((await delivery(`turn_72h_reminder_${progressingId}`))?.attemptCount, 1);
assert.ok(await mailbox(`turn_72h_reminder_${progressingId}`));

const twentyFourHoursLater = new Date(baseTime.getTime() + 48 * hour);
for (const at of [twentyFourHoursLater, twentyFourHoursLater]) {
  await sweep(progressingId, progressing, at);
}
assert.equal((await delivery(`turn_24h_reminder_${progressingId}`))?.attemptCount, 1);
assert.equal((await delivery(`turn_72h_reminder_${progressingId}`))?.status, 'sent');

const deadline = new Date(baseTime.getTime() + 72 * hour);
for (const at of [deadline, deadline]) await sweep(progressingId, progressing, at);
const deadlineId = `turn_deadline_passed_${progressingId}`;
assert.equal((await delivery(deadlineId))?.attemptCount, 1);
assert.match((await mailbox(deadlineId))?.text, /remains technically open/);
assert.deepEqual(await operationalState(progressingId), beforeReminders);

// An overdue active turn can still be submitted normally after the deadline notice.
assert.equal(await submitCurrentTurnFromWebhook(firestore, {
  deliveryId: randomUUID(), event: 'pull_request', action: 'opened',
  repository: 'jeffsandov6/who-touched-this',
}, {
  action: 'opened', repository: 'jeffsandov6/who-touched-this',
  authorGitHubUserId: githubUserId, prNumber: 321,
  prUrl: 'https://github.com/jeffsandov6/who-touched-this/pull/321',
}), 'submitted');
assert.equal((await firestore.doc(`turns/${progressingId}`).get()).data()?.status, 'submitted');

// Scenario D: once submitted, later active-turn windows create no additional notices.
const stoppedId = `reminder-stopped-${suffix}`;
const stopped = longTurn();
await sweep(stoppedId, stopped, new Date(baseTime.getTime() + 2 * hour));
const submitted = { ...stopped, status: 'submitted' };
await sweep(stoppedId, submitted, twentyFourHoursLater);
await sweep(stoppedId, submitted, deadline);
assert.equal((await delivery(`turn_72h_reminder_${stoppedId}`))?.status, 'sent');
assert.equal(await delivery(`turn_24h_reminder_${stoppedId}`), undefined);
assert.equal(await delivery(`turn_deadline_passed_${stoppedId}`), undefined);

// Scenario E: provider failure leaves the turn unchanged and retries the same stable identity.
const retryId = `reminder-retry-${suffix}`;
const retryTurn = longTurn();
await firestore.doc(`turns/${retryId}`).set(retryTurn);
const failingProvider = {
  async sendEmail() {
    const error = new Error('Synthetic local provider failure.');
    error.name = 'SyntheticProviderFailure';
    throw error;
  },
};
assert.equal((await sweep(retryId, retryTurn, baseTime, failingProvider)).length, 1);
const retryDeliveryId = `turn_72h_reminder_${retryId}`;
assert.equal((await delivery(retryDeliveryId))?.status, 'failed');
assert.deepEqual((await firestore.doc(`turns/${retryId}`).get()).data(), retryTurn);
await sweep(retryId, retryTurn, baseTime);
await sweep(retryId, retryTurn, baseTime);
assert.equal((await delivery(retryDeliveryId))?.attemptCount, 2);
assert.equal((await delivery(retryDeliveryId))?.status, 'sent');
assert.equal((await mailbox(retryDeliveryId))?.idempotencyKey, retryDeliveryId);

// Scenario F: short turns skip inapplicable reminders but may receive the overdue notice.
const short48Id = `reminder-short-48-${suffix}`;
const short48 = {
  githubUserId, status: 'active', targetContributionNumber: 2,
  startedAt: timestamp(baseTime.getTime() - 8 * hour),
  dueAt: timestamp(baseTime.getTime() + 40 * hour),
};
const short12Id = `reminder-short-12-${suffix}`;
const short12DueAt = baseTime.getTime() + 10 * hour;
const short12 = {
  githubUserId, status: 'active', targetContributionNumber: 3,
  startedAt: timestamp(short12DueAt - 12 * hour), dueAt: timestamp(short12DueAt),
};
await sweep(short48Id, short48, baseTime);
await sweep(short12Id, short12, baseTime);
await sweep(short12Id, short12, new Date(short12DueAt));
assert.equal(await delivery(`turn_72h_reminder_${short48Id}`), undefined);
assert.equal(await delivery(`turn_72h_reminder_${short12Id}`), undefined);
assert.equal(await delivery(`turn_24h_reminder_${short12Id}`), undefined);
assert.equal((await delivery(`turn_deadline_passed_${short12Id}`))?.status, 'sent');

console.log('Invitation and turn reminder lifecycle, timing, retry, and idempotency scenarios passed locally.');
