import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const projectId = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
if (!projectId || !firestoreHost) throw new Error('Run this inside Firebase emulators:exec.');
if (getApps().length === 0) initializeApp({ projectId });
const firestore = getFirestore();
const secret = 'local-github-webhook-secret';
const repository = 'JeffSandov6/who-touched-this';
const endpoint = `http://127.0.0.1:5001/${projectId}/us-central1/githubWebhook`;

async function clearFirestore() {
  const response = await fetch(
    `http://${firestoreHost}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  assert.equal(response.ok, true);
}

function webhookPayload({
  action = 'opened', draft = false, authorId = 12345, ownerRepo = repository,
  baseRepo = ownerRepo, branch = 'main', number = 41,
  url = `https://github.com/${ownerRepo}/pull/${number}`,
} = {}) {
  return {
    action,
    repository: { full_name: ownerRepo },
    pull_request: {
      number, html_url: url, draft,
      user: { id: authorId, login: 'presentation-name-does-not-authorize' },
      base: { ref: branch, repo: { full_name: baseRepo } },
      head: { ref: 'small-change', repo: { full_name: 'contributor/a-fork' } },
    },
  };
}

async function postWebhook(payload, {
  deliveryId = randomUUID(), event = 'pull_request', validSignature = true,
} = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  const signature = `sha256=${createHmac('sha256', validSignature ? secret : 'wrong-secret')
    .update(body).digest('hex')}`;
  const response = await fetch(endpoint, {
    method: 'POST', body,
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-github-delivery': deliveryId,
      'x-hub-signature-256': signature,
    },
  });
  return { response, body: await response.json() };
}

async function seedTurn(status = 'active', options = {}) {
  const githubUserId = String(options.githubUserId ?? 12345);
  const turnId = `turn-${randomUUID()}`;
  const now = Timestamp.now();
  const dueAt = Timestamp.fromMillis(Date.now() + (options.pastDue ? -1 : 24 * 60 * 60 * 1000));
  const turn = {
    githubUserId, season: 1, status, targetContributionNumber: 1,
    startedAt: now, dueAt, createdAt: now, updatedAt: now,
    ...(status === 'submitted' || status === 'under_review' || status === 'merged'
      ? { prNumber: 41, prUrl: `https://github.com/${repository}/pull/41`, submittedAt: now }
      : {}),
    ...(status === 'under_review' || status === 'merged' ? { reviewStartedAt: now } : {}),
    ...(status === 'merged' ? { mergedAt: now, endedAt: now } : {}),
    ...(status === 'expired' || status === 'skipped' ? { endedAt: now } : {}),
  };
  await Promise.all([
    firestore.doc(`contributors/${githubUserId}`).set({
      githubUserId, displayName: 'Alice', githubUsername: 'alice',
      email: 'alice@example.test', createdAt: now, updatedAt: now,
    }),
    firestore.doc('site/admin').set({
      activeTurnId: turnId,
      pendingInvitationId: null,
      pendingArchiveContributionNumber: options.pendingArchiveContributionNumber ?? null,
      updatedAt: now,
    }),
    firestore.doc('site/public').set({
      currentVersion: 0, totalContributions: 0,
      turnStatus: ['active', 'submitted', 'under_review'].includes(status) ? status : 'none',
      currentContributor: ['active', 'submitted', 'under_review'].includes(status)
        ? { displayName: 'Alice', githubUsername: 'alice' } : null,
      targetContributionNumber: ['active', 'submitted', 'under_review'].includes(status) ? 1 : null,
      dueAt: ['active', 'submitted', 'under_review'].includes(status) ? dueAt : null,
      updatedAt: now,
    }),
    firestore.doc(`turns/${turnId}`).set(turn),
    firestore.doc(`queue/1_${githubUserId}`).set({ githubUserId, season: 1, status: 'active', joinedAt: now, priority: 0, updatedAt: now }),
    firestore.doc(`participation/1_${githubUserId}`).set({ githubUserId, season: 1, status: 'active', createdAt: now, updatedAt: now }),
  ]);
  return { turnId, githubUserId, dueAt };
}

async function waitForAdminNotification(turnId) {
  const deliveryId = `pr_submitted_${turnId}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [delivery, mailbox] = await Promise.all([
      firestore.doc(`emailDeliveries/${deliveryId}`).get(),
      firestore.doc(`devEmailSink/${deliveryId}`).get(),
    ]);
    if (delivery.data()?.status === 'sent' && mailbox.exists) return { delivery, mailbox };
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${deliveryId}.`);
}

async function assertStillActive(turnId) {
  assert.equal((await firestore.doc(`turns/${turnId}`).get()).data()?.status, 'active');
  assert.equal((await firestore.doc('site/public').get()).data()?.turnStatus, 'active');
}

await clearFirestore();
{
  const { turnId } = await seedTurn();
  const { response } = await postWebhook(webhookPayload(), { validSignature: false });
  assert.equal(response.status, 401);
  await assertStillActive(turnId);
  assert.equal((await firestore.collection('githubWebhookDeliveries').get()).empty, true);
}

await clearFirestore();
{
  const { turnId } = await seedTurn();
  const { response } = await postWebhook({ repository: { full_name: repository } }, { event: 'push' });
  assert.equal(response.status, 202);
  await assertStillActive(turnId);
}

await clearFirestore();
{
  const { turnId, githubUserId } = await seedTurn();
  const deliveryId = randomUUID();
  const first = await postWebhook(webhookPayload(), { deliveryId });
  assert.equal(first.response.status, 200);
  assert.equal(first.body.result, 'submitted');
  const turn = (await firestore.doc(`turns/${turnId}`).get()).data();
  assert.equal(turn.status, 'submitted'); assert.equal(turn.prNumber, 41);
  assert.equal(turn.prUrl, `https://github.com/${repository}/pull/41`);
  assert.equal((await firestore.doc('site/public').get()).data()?.turnStatus, 'submitted');
  assert.equal((await firestore.doc('site/admin').get()).data()?.activeTurnId, turnId);
  assert.equal((await firestore.doc(`queue/1_${githubUserId}`).get()).data()?.status, 'active');
  assert.equal((await firestore.doc(`participation/1_${githubUserId}`).get()).data()?.status, 'active');
  assert.equal((await firestore.doc('site/public').get()).data()?.currentVersion, 0);
  assert.equal((await firestore.collection('contributions').get()).empty, true);
  assert.equal((await firestore.collection('historyEvents').get()).empty, true);
  const notification = await waitForAdminNotification(turnId);
  assert.equal(notification.mailbox.data()?.to, 'hello@whotouchedthis.website');
  assert.match(notification.mailbox.data()?.subject, /PR submitted — #001/);
  assert.match(notification.mailbox.data()?.text, /GitHub: @alice/);
  assert.equal(notification.delivery.data()?.attemptCount, 1);
  const duplicate = await postWebhook(webhookPayload(), { deliveryId });
  assert.equal(duplicate.body.result, 'duplicate_delivery');
  const samePr = await postWebhook(webhookPayload({ action: 'ready_for_review' }));
  assert.equal(samePr.body.result, 'already_submitted_same_pr');
  const secondPr = await postWebhook(webhookPayload({ number: 42 }));
  assert.equal(secondPr.body.result, 'submission_conflict');
  assert.equal((await firestore.doc(`turns/${turnId}`).get()).data()?.prNumber, 41);
  assert.equal((await firestore.doc(`emailDeliveries/pr_submitted_${turnId}`).get()).data()?.attemptCount, 1);
}

for (const scenario of [
  { payload: webhookPayload({ draft: true }), expected: 'draft_opened' },
  { payload: webhookPayload({ action: 'synchronize' }), expected: 'unsupported_action' },
  { payload: webhookPayload({ action: 'edited' }), expected: 'unsupported_action' },
  { payload: webhookPayload({ action: 'reopened' }), expected: 'unsupported_action' },
  { payload: webhookPayload({ authorId: 99999 }), expected: 'wrong_contributor' },
  { payload: webhookPayload({ ownerRepo: 'another-owner/another-repository' }), expected: 'wrong_repository' },
  { payload: webhookPayload({ baseRepo: 'another-owner/another-repository' }), expected: 'wrong_base_repository' },
  { payload: webhookPayload({ branch: 'develop' }), expected: 'wrong_base_branch' },
]) {
  await clearFirestore();
  const { turnId } = await seedTurn();
  const result = await postWebhook(scenario.payload);
  assert.equal(result.body.result, scenario.expected);
  await assertStillActive(turnId);
  assert.equal((await firestore.doc(`emailDeliveries/pr_submitted_${turnId}`).get()).exists, false);
}

await clearFirestore();
{
  const { turnId } = await seedTurn();
  const result = await postWebhook(webhookPayload({ action: 'ready_for_review', draft: false }));
  assert.equal(result.body.result, 'submitted');
  assert.equal((await firestore.doc(`turns/${turnId}`).get()).data()?.status, 'submitted');
  assert.equal((await waitForAdminNotification(turnId)).mailbox.data()?.to, 'hello@whotouchedthis.website');
}

await clearFirestore();
{
  await firestore.doc('site/admin').set({ activeTurnId: null, pendingInvitationId: null, updatedAt: Timestamp.now() });
  assert.equal((await postWebhook(webhookPayload())).body.result, 'no_active_turn');
  await firestore.doc('site/admin').set({ activeTurnId: null, pendingInvitationId: 'invitation-only', updatedAt: Timestamp.now() });
  assert.equal((await postWebhook(webhookPayload())).body.result, 'no_active_turn');
}

await clearFirestore();
{
  const { turnId } = await seedTurn('active', { pastDue: true });
  assert.equal((await postWebhook(webhookPayload())).body.result, 'submitted');
  assert.equal((await firestore.doc(`turns/${turnId}`).get()).data()?.status, 'submitted');
}

await clearFirestore();
{
  const { turnId } = await seedTurn('active', { pendingArchiveContributionNumber: 7 });
  assert.equal((await postWebhook(webhookPayload())).body.result, 'turn_not_active');
  await assertStillActive(turnId);
  assert.equal((await firestore.doc('site/admin').get()).data()?.pendingArchiveContributionNumber, 7);
  assert.equal((await firestore.doc(`emailDeliveries/pr_submitted_${turnId}`).get()).exists, false);
}

for (const status of ['expired', 'skipped', 'submitted', 'under_review', 'merged']) {
  await clearFirestore();
  const { turnId } = await seedTurn(status);
  const result = await postWebhook(webhookPayload({ number: 42 }));
  assert.equal(result.body.result, status === 'submitted' ? 'submission_conflict' : 'turn_not_active');
  assert.equal((await firestore.doc(`turns/${turnId}`).get()).data()?.status, status);
  if (status !== 'active') assert.notEqual((await firestore.doc(`turns/${turnId}`).get()).data()?.prNumber, 42);
}

console.log('GitHub webhook scenarios passed without changing queue, numbering, History, or terminal states.');
