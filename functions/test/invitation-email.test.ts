import assert from 'node:assert/strict';
import test from 'node:test';
import {
  invitationDeliveryId,
  processInvitationCreated,
  type InvitationCreatedData,
} from '../src/email/invitation-delivery.js';
import {
  buildInvitationEmail,
  INVITATION_EMAIL_SUBJECT,
  invitationJoinUrl,
} from '../src/email/template.js';
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

class MemoryDeliveryStore implements DeliveryStore {
  status: 'none' | 'sending' | 'sent' | 'failed' = 'none';
  failureCode: string | null = null;
  messageId: string | null = null;
  claims = 0;

  async claim(_identity: DeliveryIdentity): Promise<DeliveryClaim> {
    this.claims += 1;
    if (this.status === 'sent') return { kind: 'already-sent' };
    if (this.status === 'sending') return { kind: 'busy' };
    this.status = 'sending';
    return { kind: 'claimed' };
  }
  async markSent(_identity: DeliveryIdentity, messageId: string) {
    this.status = 'sent';
    this.messageId = messageId;
  }
  async markFailed(_identity: DeliveryIdentity, failureCode: string) {
    this.status = 'failed';
    this.failureCode = failureCode;
  }
}

class FakeProvider implements EmailProvider {
  sends: SendEmailInput[] = [];
  fail = false;

  async sendEmail(input: SendEmailInput) {
    this.sends.push(input);
    if (this.fail) {
      const error = new Error('Provider failed with private details.');
      error.name = 'FakeProviderError';
      throw error;
    }
    return { messageId: 'provider-message-1' };
  }
}

const deadline = new Date('2030-06-02T18:30:00.000Z');

function invitation(overrides: Partial<InvitationCreatedData> = {}): InvitationCreatedData {
  const timestamp = new FakeTimestamp(new Date('2030-06-01T18:30:00.000Z'));
  return {
    githubUserId: '123456',
    season: 1,
    status: 'pending',
    invitedAt: timestamp,
    acceptBy: new FakeTimestamp(deadline),
    turnDurationHours: 168,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function setup(options: { contributor?: { email: unknown; displayName: unknown } | null } = {}) {
  const store = new MemoryDeliveryStore();
  const provider = new FakeProvider();
  const contributor = options.contributor === undefined
    ? { email: 'private@example.test', displayName: 'Alice <Builder>' }
    : options.contributor;
  const dependencies = {
    appOrigin: 'http://localhost:4321',
    deliveryStore: store,
    emailProvider: provider,
    async loadContributor() { return contributor; },
  };
  return { store, provider, dependencies };
}

test('invitation template has the expected subject, UTC deadline, duration, and join CTA', () => {
  const email = buildInvitationEmail({
    to: 'private@example.test', displayName: 'Alice', acceptBy: deadline,
    turnDurationHours: 168, appOrigin: 'https://whotouchedthis.website',
    idempotencyKey: 'invitation_abc',
  });
  assert.equal(email.subject, INVITATION_EMAIL_SUBJECT);
  assert.match(email.text, /June 2, 2030/);
  assert.match(email.text, /6:30:00 PM UTC/);
  assert.match(email.text, /7 days/);
  assert.match(email.text, /https:\/\/whotouchedthis\.website\/join/);
  assert.match(email.html, /accept your turn/);
});

test('HTML escapes contributor-controlled presentation values', () => {
  const email = buildInvitationEmail({
    to: 'private@example.test', displayName: 'Alice <script>alert(1)</script>',
    acceptBy: deadline, turnDurationHours: 24, appOrigin: 'http://localhost:4321',
    idempotencyKey: 'invitation_abc',
  });
  assert.doesNotMatch(email.html, /<script>/);
  assert.match(email.html, /&lt;script&gt;/);
});

test('join URL generation replaces any origin path and rejects credentials', () => {
  assert.equal(invitationJoinUrl('http://localhost:4321/base'), 'http://localhost:4321/join');
  assert.throws(() => invitationJoinUrl('https://user:secret@example.com'));
});

test('delivery identity is deterministic for an invitation', () => {
  assert.equal(invitationDeliveryId('abc123'), 'invitation_abc123');
});

test('a pending invitation sends once to the private contributor email', async () => {
  const { store, provider, dependencies } = setup();
  const result = await processInvitationCreated({
    invitationId: 'abc123', claimToken: 'attempt-1', data: invitation(),
  }, dependencies);
  assert.deepEqual(result, { kind: 'sent' });
  assert.equal(provider.sends.length, 1);
  assert.equal(provider.sends[0]?.to, 'private@example.test');
  assert.equal(provider.sends[0]?.idempotencyKey, 'invitation_abc123');
  assert.equal(store.status, 'sent');
  assert.equal(store.messageId, 'provider-message-1');
  assert.match(provider.sends[0]?.text ?? '', /June 2, 2030/);
  assert.match(provider.sends[0]?.text ?? '', /7 days/);
  assert.match(provider.sends[0]?.text ?? '', /localhost:4321\/join/);
  assert.doesNotMatch(provider.sends[0]?.text ?? '', /123456|queue position/i);
});

test('an already-sent delivery and duplicate invocation do not send again', async () => {
  const { store, provider, dependencies } = setup();
  await processInvitationCreated({
    invitationId: 'abc123', claimToken: 'attempt-1', data: invitation(),
  }, dependencies);
  const result = await processInvitationCreated({
    invitationId: 'abc123', claimToken: 'attempt-2', data: invitation(),
  }, dependencies);
  assert.deepEqual(result, { kind: 'already-sent' });
  assert.equal(provider.sends.length, 1);
  assert.equal(store.claims, 2);
});

test('missing contributor and missing email fail safely', async () => {
  const missing = setup({ contributor: null });
  assert.deepEqual(await processInvitationCreated({
    invitationId: 'missing', claimToken: 'attempt-1', data: invitation(),
  }, missing.dependencies), { kind: 'failed', code: 'missing_contributor' });
  assert.equal(missing.store.failureCode, 'missing_contributor');

  const noEmail = setup({ contributor: { email: '', displayName: 'Alice' } });
  assert.deepEqual(await processInvitationCreated({
    invitationId: 'no-email', claimToken: 'attempt-2', data: invitation(),
  }, noEmail.dependencies), { kind: 'failed', code: 'missing_contact_email' });
  assert.equal(noEmail.store.failureCode, 'missing_contact_email');
});

test('provider failure records only a safe code and leaves invitation input unchanged', async () => {
  const { store, provider, dependencies } = setup();
  provider.fail = true;
  const data = invitation();
  const statusBefore = data.status;
  await assert.rejects(processInvitationCreated({
    invitationId: 'abc123', claimToken: 'attempt-1', data,
  }, dependencies));
  assert.equal(store.status, 'failed');
  assert.equal(store.failureCode, 'FakeProviderError');
  assert.equal(data.status, statusBefore);
});

test('a failed delivery may be retried with the same deterministic provider key', async () => {
  const { provider, dependencies } = setup();
  provider.fail = true;
  await assert.rejects(processInvitationCreated({
    invitationId: 'abc123', claimToken: 'attempt-1', data: invitation(),
  }, dependencies));
  provider.fail = false;
  assert.deepEqual(await processInvitationCreated({
    invitationId: 'abc123', claimToken: 'attempt-2', data: invitation(),
  }, dependencies), { kind: 'sent' });
  assert.equal(provider.sends.length, 2);
  assert.equal(provider.sends[0]?.idempotencyKey, provider.sends[1]?.idempotencyKey);
});

test('accepted, expired, and malformed invitation events fail closed without sending', async () => {
  const { provider, dependencies } = setup();
  for (const status of ['accepted', 'expired']) {
    assert.deepEqual(await processInvitationCreated({
      invitationId: status, claimToken: status, data: invitation({ status }),
    }, dependencies), { kind: 'ignored' });
  }
  assert.deepEqual(await processInvitationCreated({
    invitationId: 'malformed', claimToken: 'malformed',
    data: invitation({ turnDurationHours: 999, internalField: 'nope' }),
  }, dependencies), { kind: 'failed', code: 'malformed_invitation' });
  assert.equal(provider.sends.length, 0);
});
