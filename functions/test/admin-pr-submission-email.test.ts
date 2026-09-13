import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADMIN_NOTIFICATION_EMAIL,
  type AdminSubmissionDependencies,
  type SubmittedTurnData,
  buildAdminPrSubmittedEmail,
  processAdminPrSubmission,
} from '../src/email/admin-submission-delivery.js';
import { deliveryIds } from '../src/email/notification-eligibility.js';
import type {
  DeliveryClaim,
  DeliveryIdentity,
  DeliveryStore,
  EmailProvider,
  SendEmailInput,
} from '../src/email/types.js';

class FakeTimestamp {
  constructor(private readonly date: Date) {}
  toDate() { return this.date; }
}

class MemoryStore implements DeliveryStore {
  statuses = new Map<string, 'sending' | 'sent' | 'failed'>();
  failures = new Map<string, string>();
  claims: DeliveryIdentity[] = [];
  async claim(identity: DeliveryIdentity): Promise<DeliveryClaim> {
    this.claims.push(identity);
    if (this.statuses.get(identity.deliveryId) === 'sent') return { kind: 'already-sent' };
    if (this.statuses.get(identity.deliveryId) === 'sending') return { kind: 'busy' };
    this.statuses.set(identity.deliveryId, 'sending');
    return { kind: 'claimed' };
  }
  async markSent(identity: DeliveryIdentity) { this.statuses.set(identity.deliveryId, 'sent'); }
  async markFailed(identity: DeliveryIdentity, code: string) {
    this.statuses.set(identity.deliveryId, 'failed');
    this.failures.set(identity.deliveryId, code);
  }
}

class FakeProvider implements EmailProvider {
  sends: SendEmailInput[] = [];
  fail = false;
  async sendEmail(input: SendEmailInput) {
    this.sends.push(input);
    if (this.fail) { const error = new Error('private provider detail'); error.name = 'SafeProviderFailure'; throw error; }
    return { messageId: `message-${this.sends.length}` };
  }
}

const submittedAt = new Date('2030-05-04T12:30:00.000Z');
const active = {
  githubUserId: '12345', status: 'active', targetContributionNumber: 12,
};
const submitted = {
  ...active, status: 'submitted', prNumber: 321,
  prUrl: 'https://github.com/JeffSandov6/who-touched-this/pull/321',
  submittedAt: new FakeTimestamp(submittedAt),
};

function setup() {
  const deliveryStore = new MemoryStore();
  const emailProvider = new FakeProvider();
  const dependencies: AdminSubmissionDependencies = {
    appOrigin: 'https://whotouchedthis.website',
    expectedRepository: 'JeffSandov6/who-touched-this',
    deliveryStore, emailProvider,
    async loadContributor() { return { displayName: 'Alice <Maker>', githubUsername: 'alice-maker' }; },
  };
  return { deliveryStore, emailProvider, dependencies };
}

test('admin PR-submission identity is stable per turn', () => {
  assert.equal(deliveryIds.prSubmitted('turn-abc'), 'pr_submitted_turn-abc');
  assert.throws(() => deliveryIds.prSubmitted('../turn'));
});

test('first active-to-submitted transition sends one admin notification', async () => {
  const { deliveryStore, emailProvider, dependencies } = setup();
  assert.deepEqual(await processAdminPrSubmission('turn-abc', active, submitted, 'claim-1', dependencies), { kind: 'sent' });
  assert.equal(emailProvider.sends.length, 1);
  assert.equal(emailProvider.sends[0]?.to, ADMIN_NOTIFICATION_EMAIL);
  assert.equal(emailProvider.sends[0]?.idempotencyKey, 'pr_submitted_turn-abc');
  assert.equal(deliveryStore.statuses.get('pr_submitted_turn-abc'), 'sent');
  assert.match(emailProvider.sends[0]?.subject ?? '', /PR submitted — #012/);
  assert.match(emailProvider.sends[0]?.text ?? '', /Alice <Maker> submitted PR #321/);
  assert.match(emailProvider.sends[0]?.text ?? '', /GitHub: @alice-maker/);
  assert.match(emailProvider.sends[0]?.text ?? '', /May 4, 2030/);
  assert.match(emailProvider.sends[0]?.text ?? '', /\/admin/);
  assert.doesNotMatch(emailProvider.sends[0]?.html ?? '', /<Maker>/);
  assert.match(emailProvider.sends[0]?.html ?? '', /&lt;Maker&gt;/);
});

test('duplicate trigger delivery cannot send a second successful email', async () => {
  const { emailProvider, dependencies } = setup();
  await processAdminPrSubmission('turn-abc', active, submitted, 'claim-1', dependencies);
  assert.deepEqual(await processAdminPrSubmission('turn-abc', active, submitted, 'claim-2', dependencies), { kind: 'already-sent' });
  assert.equal(emailProvider.sends.length, 1);
});

test('later synchronize/edit/reopen-equivalent turn updates do not qualify', async () => {
  const { emailProvider, dependencies } = setup();
  const transitions: Array<[SubmittedTurnData, SubmittedTurnData]> = [
    [submitted, submitted],
    [submitted, { ...submitted, status: 'under_review' }],
    [{ ...active, status: 'under_review' }, submitted],
    [active, active],
  ];
  for (const [before, after] of transitions) assert.deepEqual(await processAdminPrSubmission('turn-abc', before, after, 'claim', dependencies), { kind: 'ignored' });
  assert.equal(emailProvider.sends.length, 0);
});

test('provider failure leaves lifecycle input unchanged and retries with the same idempotency key', async () => {
  const { deliveryStore, emailProvider, dependencies } = setup();
  const beforeCopy = structuredClone(active);
  const afterStatus = submitted.status;
  emailProvider.fail = true;
  await assert.rejects(processAdminPrSubmission('turn-abc', active, submitted, 'claim-1', dependencies), /private provider detail/);
  assert.equal(deliveryStore.statuses.get('pr_submitted_turn-abc'), 'failed');
  assert.equal(deliveryStore.failures.get('pr_submitted_turn-abc'), 'SafeProviderFailure');
  emailProvider.fail = false;
  assert.deepEqual(await processAdminPrSubmission('turn-abc', active, submitted, 'claim-2', dependencies), { kind: 'sent' });
  assert.deepEqual(await processAdminPrSubmission('turn-abc', active, submitted, 'claim-3', dependencies), { kind: 'already-sent' });
  assert.deepEqual(emailProvider.sends.map((email) => email.idempotencyKey), ['pr_submitted_turn-abc', 'pr_submitted_turn-abc']);
  assert.deepEqual(active, beforeCopy);
  assert.equal(submitted.status, afterStatus);
});

test('malformed, unrelated, and wrong-account notification data fails without sending', async () => {
  const cases = [
    { ...submitted, githubUserId: 'not-numeric' },
    { ...submitted, targetContributionNumber: 0 },
    { ...submitted, prNumber: 0 },
    { ...submitted, prUrl: 'https://attacker.example/pull/321' },
    { ...submitted, submittedAt: 'now' },
  ];
  for (const value of cases) {
    const { emailProvider, dependencies } = setup();
    assert.deepEqual(await processAdminPrSubmission('turn-abc', active, value, 'claim', dependencies), { kind: 'failed', code: 'malformed_submission' });
    assert.equal(emailProvider.sends.length, 0);
  }
  const { emailProvider, dependencies } = setup();
  dependencies.loadContributor = async () => null;
  assert.deepEqual(await processAdminPrSubmission('turn-abc', active, submitted, 'claim', dependencies), { kind: 'failed', code: 'invalid_contributor' });
  assert.equal(emailProvider.sends.length, 0);
});

test('template contains only operational public presentation and safe canonical links', () => {
  const input = {
    displayName: 'Alice', githubUsername: 'alice', contributionNumber: 12, prNumber: 321,
    prUrl: 'https://github.com/JeffSandov6/who-touched-this/pull/321', submittedAt,
    appOrigin: 'https://whotouchedthis.website',
    expectedRepository: 'JeffSandov6/who-touched-this',
    idempotencyKey: 'pr_submitted_turn-abc',
  };
  const email = buildAdminPrSubmittedEmail(input);
  assert.equal(email.to, 'hello@whotouchedthis.website');
  assert.match(email.text, /Review PR: https:\/\/github\.com/);
  assert.match(email.text, /Open Admin: https:\/\/whotouchedthis\.website\/admin/);
  assert.doesNotMatch(`${email.text}\n${email.html}`, /private@example|Firebase UID|queue|email address/i);
  assert.throws(() => buildAdminPrSubmittedEmail({ ...input, prUrl: 'javascript:alert(1)' }));
  assert.throws(() => buildAdminPrSubmittedEmail({
    ...input, prUrl: 'https://github.com/another-owner/who-touched-this/pull/321',
  }));
  assert.throws(() => buildAdminPrSubmittedEmail({
    ...input, prUrl: 'https://github.com/JeffSandov6/another-repo/pull/321',
  }));
  assert.doesNotThrow(() => buildAdminPrSubmittedEmail({
    ...input, prUrl: 'https://github.com/jeffsandov6/WHO-TOUCHED-THIS/pull/321',
  }));
});
