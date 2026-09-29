import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildContributionCompletedEmail,
  buildDeadlinePassedEmail,
  buildInvitationReminderEmail,
  buildTurnReminderEmail,
  buildTurnStartedEmail,
} from '../src/email/lifecycle-template.js';
import {
  sendContributionCompleted,
  sendTurnNotification,
} from '../src/email/lifecycle-delivery.js';
import {
  deliveryIds,
  isInvitationReminderEligible,
  isTurn24HourReminderEligible,
  isTurn72HourReminderEligible,
  isTurnDeadlinePassedEmailEligible,
} from '../src/email/notification-eligibility.js';
import { dispatchEligibleNotifications } from '../src/email/reminder-dispatcher.js';
import type {
  DeliveryClaim,
  DeliveryIdentity,
  DeliveryStore,
  EmailProvider,
  SendEmailInput,
} from '../src/email/types.js';

const HOUR = 60 * 60 * 1000;
const now = new Date('2030-01-10T12:00:00.000Z');
class FakeTimestamp { constructor(private readonly value: Date) {} toDate() { return this.value; } }

class MemoryStore implements DeliveryStore {
  statuses = new Map<string, 'sending' | 'sent' | 'failed'>();
  failures = new Map<string, string>();
  attempts = new Map<string, number>();
  async claim(identity: DeliveryIdentity): Promise<DeliveryClaim> {
    if (this.statuses.get(identity.deliveryId) === 'sent') return { kind: 'already-sent' };
    if (this.statuses.get(identity.deliveryId) === 'sending') return { kind: 'busy' };
    this.attempts.set(identity.deliveryId, (this.attempts.get(identity.deliveryId) ?? 0) + 1);
    this.statuses.set(identity.deliveryId, 'sending');
    return { kind: 'claimed' };
  }
  async markSent(identity: DeliveryIdentity) { this.statuses.set(identity.deliveryId, 'sent'); }
  async markFailed(identity: DeliveryIdentity, code: string) {
    this.statuses.set(identity.deliveryId, 'failed'); this.failures.set(identity.deliveryId, code);
  }
}

class FakeProvider implements EmailProvider {
  sends: SendEmailInput[] = [];
  fail = false;
  async sendEmail(input: SendEmailInput) {
    this.sends.push(input);
    if (this.fail) { const error = new Error('private provider detail'); error.name = 'SafeFakeError'; throw error; }
    return { messageId: `message-${this.sends.length}` };
  }
}

function setup() {
  const store = new MemoryStore();
  const provider = new FakeProvider();
  const dependencies = {
    appOrigin: 'http://localhost:4321', deliveryStore: store, emailProvider: provider,
    async loadContributor() { return { email: 'private@example.test', displayName: 'Alice <Maker>' }; },
  };
  return { store, provider, dependencies };
}

function turn(status = 'active', remainingHours = 24, durationHours = 168) {
  return {
    githubUserId: '12345', status, targetContributionNumber: 1,
    startedAt: new FakeTimestamp(new Date(now.getTime() - (durationHours - remainingHours) * HOUR)),
    dueAt: new FakeTimestamp(new Date(now.getTime() + remainingHours * HOUR)),
  };
}

function timing(originalDurationMs: number, remainingMs: number, status = 'active') {
  const dueAt = new Date(now.getTime() + remainingMs);
  return { status, startedAt: new Date(dueAt.getTime() - originalDurationMs), dueAt };
}

test('notification IDs are deterministic and scoped to their logical notification', () => {
  assert.equal(deliveryIds.invitationReminder('abc'), 'invitation_reminder_abc');
  assert.equal(deliveryIds.turnStarted('turn-a'), 'turn_started_turn-a');
  assert.equal(deliveryIds.turn72HourReminder('turn-a'), 'turn_72h_reminder_turn-a');
  assert.equal(deliveryIds.turn24HourReminder('turn-a'), 'turn_24h_reminder_turn-a');
  assert.equal(deliveryIds.turnDeadlinePassed('turn-a'), 'turn_deadline_passed_turn-a');
  assert.equal(deliveryIds.prSubmitted('turn-a'), 'pr_submitted_turn-a');
  assert.equal(deliveryIds.contributionCompleted(1), 'contribution_completed_1');
});

test('invitation reminder eligibility requires pending, a meaningful original window, and future <=6h', () => {
  const eligible = { status: 'pending', invitedAt: new Date(now.getTime() - 20 * HOUR), acceptBy: new Date(now.getTime() + 4 * HOUR) };
  assert.equal(isInvitationReminderEligible(eligible, now), true);
  assert.equal(isInvitationReminderEligible({ ...eligible, status: 'accepted' }, now), false);
  assert.equal(isInvitationReminderEligible({ ...eligible, status: 'expired' }, now), false);
  assert.equal(isInvitationReminderEligible({ ...eligible, acceptBy: new Date(now.getTime() - 1) }, now), false);
  assert.equal(isInvitationReminderEligible({ ...eligible, invitedAt: new Date(now.getTime() - HOUR) }, now), false);
});

test('turn reminder and deadline eligibility enforce active status and original-duration rules', () => {
  const seventy = { status: 'active', startedAt: new Date(now.getTime() - 100 * HOUR), dueAt: new Date(now.getTime() + 70 * HOUR) };
  assert.equal(isTurn72HourReminderEligible(seventy, now), true);
  assert.equal(isTurn72HourReminderEligible({ ...seventy, startedAt: new Date(now.getTime()) }, now), false);
  assert.equal(isTurn72HourReminderEligible({ ...seventy, status: 'submitted' }, now), false);
  const twenty = { status: 'active', startedAt: new Date(now.getTime() - 100 * HOUR), dueAt: new Date(now.getTime() + 20 * HOUR) };
  assert.equal(isTurn24HourReminderEligible(twenty, now), true);
  assert.equal(isTurn24HourReminderEligible({ ...twenty, startedAt: new Date(now.getTime()) }, now), false);
  assert.equal(isTurnDeadlinePassedEmailEligible({ ...twenty, dueAt: now }, now), true);
  assert.equal(isTurnDeadlinePassedEmailEligible({ ...twenty, status: 'under_review', dueAt: now }, now), false);
});

test('72-hour reminder uses the exact (24h, 72h] window and skips short turns', () => {
  const longTurn = 168 * HOUR;
  assert.equal(isTurn72HourReminderEligible(timing(longTurn, 72 * HOUR + 1), now), false);
  assert.equal(isTurn72HourReminderEligible(timing(longTurn, 72 * HOUR), now), true);
  assert.equal(isTurn72HourReminderEligible(timing(longTurn, 24 * HOUR + 1), now), true);
  assert.equal(isTurn72HourReminderEligible(timing(longTurn, 24 * HOUR), now), false);
  assert.equal(isTurn72HourReminderEligible(timing(72 * HOUR, 48 * HOUR), now), false);
  assert.equal(isTurn72HourReminderEligible(timing(48 * HOUR, 40 * HOUR), now), false);
});

test('24-hour reminder uses the exact (0h, 24h] window and skips short turns', () => {
  const longTurn = 168 * HOUR;
  assert.equal(isTurn24HourReminderEligible(timing(longTurn, 24 * HOUR + 1), now), false);
  assert.equal(isTurn24HourReminderEligible(timing(longTurn, 24 * HOUR), now), true);
  assert.equal(isTurn24HourReminderEligible(timing(longTurn, 1), now), true);
  assert.equal(isTurn24HourReminderEligible(timing(longTurn, 0), now), false);
  assert.equal(isTurn24HourReminderEligible(timing(24 * HOUR, 12 * HOUR), now), false);
  assert.equal(isTurn24HourReminderEligible(timing(12 * HOUR, 10 * HOUR), now), false);
});

test('deadline notice begins exactly at dueAt and every reminder rejects non-active turns', () => {
  const longTurn = 168 * HOUR;
  assert.equal(isTurnDeadlinePassedEmailEligible(timing(longTurn, 1), now), false);
  assert.equal(isTurnDeadlinePassedEmailEligible(timing(longTurn, 0), now), true);
  assert.equal(isTurnDeadlinePassedEmailEligible(timing(longTurn, -1), now), true);
  for (const status of ['submitted', 'under_review', 'merged', 'expired', 'skipped']) {
    assert.equal(isTurn72HourReminderEligible(timing(longTurn, 70 * HOUR, status), now), false);
    assert.equal(isTurn24HourReminderEligible(timing(longTurn, 20 * HOUR, status), now), false);
    assert.equal(isTurnDeadlinePassedEmailEligible(timing(longTurn, -HOUR, status), now), false);
  }
  assert.equal(isTurnDeadlinePassedEmailEligible(timing(12 * HOUR, -1), now), true);
});

test('templates have correct subjects, CTAs, readable lines, UTC times, and escaped HTML', () => {
  const base = { to: 'private@example.test', displayName: 'Alice <script>', appOrigin: 'https://whotouchedthis.website' };
  const invitation = buildInvitationReminderEmail({ ...base, acceptBy: now, turnDurationHours: 168, idempotencyKey: 'a' });
  const started = buildTurnStartedEmail({ ...base, targetContributionNumber: 1, dueAt: now, idempotencyKey: 'b' });
  const seventy = buildTurnReminderEmail({ ...base, targetContributionNumber: 1, dueAt: now, idempotencyKey: 'c' }, 72);
  const twenty = buildTurnReminderEmail({ ...base, targetContributionNumber: 1, dueAt: now, idempotencyKey: 'd' }, 24);
  const deadline = buildDeadlinePassedEmail({ ...base, targetContributionNumber: 1, dueAt: now, idempotencyKey: 'e' });
  assert.equal(invitation.subject, 'your who touched this invitation expires soon');
  assert.equal(started.subject, 'your who touched this turn has started');
  assert.equal(seventy.subject, '3 days left on your who touched this turn');
  assert.equal(twenty.subject, '24 hours left on your who touched this turn');
  assert.equal(deadline.subject, 'your who touched this deadline has passed');
  for (const email of [invitation, started, seventy, twenty, deadline]) {
    assert.match(email.text, /\n\n/); assert.match(email.text, /\/join/);
    assert.doesNotMatch(email.html, /<script>/); assert.match(email.html, /&lt;script&gt;/);
    assert.doesNotMatch(email.text, /12345|queue position|Firebase UID/i);
  }
  assert.match(deadline.text, /remains technically open/);
});

test('completion template includes public contribution data and universal WTT claim link', () => {
  const email = buildContributionCompletedEmail({
    to: 'private@example.test', displayName: 'Alice', contributionNumber: 1,
    summary: 'Added a button.', prUrl: 'https://github.com/example/repo/pull/27',
    appOrigin: 'https://whotouchedthis.website', idempotencyKey: 'complete_1',
  });
  assert.equal(email.subject, 'contribution #001 is now part of who touched this');
  assert.match(email.text, /Added a button\./); assert.match(email.text, /\/history/);
  assert.match(email.text, /you earned 1 WTT/);
  assert.match(email.text, /https:\/\/whotouchedthis\.website\/wtt\/claim/);
  assert.match(email.html, /new to Solana wallets/);
  assert.doesNotMatch(email.text, /[?&](token|claim|secret)=/i);
  assert.throws(() => buildContributionCompletedEmail({
    to: 'x@y.test', displayName: 'Alice', contributionNumber: 1, summary: 'x',
    prUrl: 'https://user:password@github.com/example/repo/pull/27', appOrigin: 'https://example.com', idempotencyKey: 'x',
  }));
});

test('completion delivery refuses contributor identity mismatch', async () => {
  const { provider, dependencies } = setup();
  const result = await sendContributionCompleted('t1', turn('merged'), {
    number: 1, githubUserId: '99999', summary: 'Wrong owner.',
    prUrl: 'https://github.com/example/repo/pull/27',
  }, 'claim-mismatch', dependencies);
  assert.deepEqual(result, { kind: 'failed', code: 'malformed_contribution' });
  assert.equal(provider.sends.length, 0);
});

test('turn-created and merged-turn delivery send once and duplicate events do not duplicate', async () => {
  const { provider, dependencies } = setup();
  await sendTurnNotification('turn_started', 't1', turn(), 'claim-1', dependencies);
  await sendTurnNotification('turn_started', 't1', turn(), 'claim-2', dependencies);
  await sendContributionCompleted('t1', turn('merged'), {
    number: 1, githubUserId: '12345', summary: 'Made it permanent.', prUrl: 'https://github.com/example/repo/pull/27',
  }, 'claim-3', dependencies);
  await sendContributionCompleted('t1', turn('merged'), {
    number: 1, githubUserId: '12345', summary: 'Made it permanent.', prUrl: 'https://github.com/example/repo/pull/27',
  }, 'claim-4', dependencies);
  assert.equal(provider.sends.length, 2);
  assert.match(provider.sends[0]!.subject, /started/); assert.match(provider.sends[1]!.subject, /#001/);
});

test('hourly dispatcher sends eligible reminder types once and skips non-active turns', async () => {
  const { provider, dependencies } = setup();
  const invitedAt = new FakeTimestamp(new Date(now.getTime() - 20 * HOUR));
  await dispatchEligibleNotifications({ now, claimToken: () => crypto.randomUUID(), invitations: [{
    id: 'i1', data: { githubUserId: '12345', status: 'pending', invitedAt,
      acceptBy: new FakeTimestamp(new Date(now.getTime() + 4 * HOUR)), turnDurationHours: 168 },
  }], turns: [
    { id: 't72', data: turn('active', 70, 170) },
    { id: 't24', data: turn('active', 20, 120) },
    { id: 'late', data: turn('active', -1, 120) },
    { id: 'submitted', data: turn('submitted', -1, 120) },
  ] }, dependencies);
  await dispatchEligibleNotifications({ now, claimToken: () => crypto.randomUUID(), invitations: [{
    id: 'i1', data: { githubUserId: '12345', status: 'pending', invitedAt,
      acceptBy: new FakeTimestamp(new Date(now.getTime() + 4 * HOUR)), turnDurationHours: 168 },
  }], turns: [
    { id: 't72', data: turn('active', 70, 170) }, { id: 't24', data: turn('active', 20, 120) },
    { id: 'late', data: turn('active', -1, 120) },
  ] }, dependencies);
  assert.deepEqual(provider.sends.map((email) => email.idempotencyKey).sort(), [
    'invitation_reminder_i1', 'turn_24h_reminder_t24',
    'turn_72h_reminder_t72', 'turn_deadline_passed_late',
  ]);
});

test('one active turn can receive each independent reminder once across later sweeps', async () => {
  const { store, provider, dependencies } = setup();
  const dueAt = new Date(now.getTime() + 72 * HOUR);
  const data = {
    githubUserId: '12345', status: 'active', targetContributionNumber: 1,
    startedAt: new FakeTimestamp(new Date(dueAt.getTime() - 168 * HOUR)),
    dueAt: new FakeTimestamp(dueAt),
  };
  const snapshot = { status: data.status, dueAt: data.dueAt.toDate().getTime() };
  for (const sweepNow of [now, now, new Date(now.getTime() + 48 * HOUR),
    new Date(now.getTime() + 48 * HOUR), dueAt, dueAt]) {
    await dispatchEligibleNotifications({
      now: sweepNow, invitations: [], turns: [{ id: 'progressing', data }],
      claimToken: () => crypto.randomUUID(),
    }, dependencies);
  }
  assert.deepEqual(provider.sends.map((email) => email.idempotencyKey), [
    'turn_72h_reminder_progressing',
    'turn_24h_reminder_progressing',
    'turn_deadline_passed_progressing',
  ]);
  assert.deepEqual([...store.attempts.entries()].sort(), [
    ['turn_24h_reminder_progressing', 1],
    ['turn_72h_reminder_progressing', 1],
    ['turn_deadline_passed_progressing', 1],
  ]);
  assert.deepEqual({ status: data.status, dueAt: data.dueAt.toDate().getTime() }, snapshot);
});

test('failed reminder retries the same identity without suppressing later reminder types', async () => {
  const { store, provider, dependencies } = setup();
  const data = turn('active', 70, 168);
  provider.fail = true;
  await dispatchEligibleNotifications({
    now, invitations: [], turns: [{ id: 'retry', data }], claimToken: () => 'claim-1',
  }, dependencies);
  assert.equal(store.statuses.get('turn_72h_reminder_retry'), 'failed');
  provider.fail = false;
  await dispatchEligibleNotifications({
    now, invitations: [], turns: [{ id: 'retry', data }], claimToken: () => 'claim-2',
  }, dependencies);
  await dispatchEligibleNotifications({
    now: new Date(now.getTime() + 46 * HOUR), invitations: [],
    turns: [{ id: 'retry', data }], claimToken: () => 'claim-3',
  }, dependencies);
  assert.deepEqual(provider.sends.map((email) => email.idempotencyKey), [
    'turn_72h_reminder_retry',
    'turn_72h_reminder_retry',
    'turn_24h_reminder_retry',
  ]);
  assert.equal(store.attempts.get('turn_72h_reminder_retry'), 2);
  assert.equal(store.attempts.get('turn_24h_reminder_retry'), 1);
});

test('provider failure records failure and never mutates source lifecycle data', async () => {
  const { store, provider, dependencies } = setup(); provider.fail = true;
  const data = turn(); const before = structuredClone({ status: data.status, target: data.targetContributionNumber });
  await assert.rejects(sendTurnNotification('turn_started', 'failed', data, 'claim', dependencies));
  assert.deepEqual({ status: data.status, target: data.targetContributionNumber }, before);
  assert.equal(store.statuses.get('turn_started_failed'), 'failed');
  assert.equal(store.failures.get('turn_started_failed'), 'SafeFakeError');
});
