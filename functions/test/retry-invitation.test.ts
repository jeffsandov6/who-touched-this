import assert from 'node:assert/strict';
import test from 'node:test';
import { retryInvitationDelivery, RetryInvitationError } from '../src/email/retry-invitation.js';

const token = { firebase: { identities: { 'github.com': ['12345'] } } };

function setup(overrides: Record<string, unknown> = {}) {
  let retries = 0;
  const deps = {
    async loadAdmin() { return { githubUserId: '12345', active: true, role: 'owner' }; },
    async loadInvitation() { return { status: 'pending' }; },
    async loadDelivery() { return { status: 'failed' }; },
    async retry() { retries += 1; return { kind: 'sent' }; },
    ...overrides,
  };
  return { deps, getRetries: () => retries };
}

async function rejectsCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error) => error instanceof RetryInvitationError && error.code === code);
}

test('invitation retry requires authentication with a stable GitHub identity', async () => {
  const { deps } = setup();
  await rejectsCode(retryInvitationDelivery(null, { invitationId: 'i1' }, deps), 'unauthenticated');
  await rejectsCode(retryInvitationDelivery({ firebase: { identities: {} } }, { invitationId: 'i1' }, deps), 'permission-denied');
});

test('ordinary and inactive accounts cannot retry', async () => {
  await rejectsCode(retryInvitationDelivery(token, { invitationId: 'i1' }, setup({
    async loadAdmin() { return null; },
  }).deps), 'permission-denied');
  await rejectsCode(retryInvitationDelivery(token, { invitationId: 'i1' }, setup({
    async loadAdmin() { return { githubUserId: '12345', active: false, role: 'owner' }; },
  }).deps), 'permission-denied');
});

test('retry input accepts only an invitation ID and cannot specify recipient or content', async () => {
  const { deps } = setup();
  await rejectsCode(retryInvitationDelivery(token, {
    invitationId: 'i1', to: 'attacker@example.test', subject: 'arbitrary',
  }, deps), 'invalid-argument');
});

test('accepted and expired invitations cannot be retried', async () => {
  for (const status of ['accepted', 'expired']) {
    await rejectsCode(retryInvitationDelivery(token, { invitationId: 'i1' }, setup({
      async loadInvitation() { return { status }; },
    }).deps), 'failed-precondition');
  }
});

test('already-sent delivery returns safely without sending', async () => {
  const { deps, getRetries } = setup({ async loadDelivery() { return { status: 'sent' }; } });
  assert.deepEqual(await retryInvitationDelivery(token, { invitationId: 'i1' }, deps), { status: 'already-sent' });
  assert.equal(getRetries(), 0);
});

test('failed pending delivery can retry and report success', async () => {
  const { deps, getRetries } = setup();
  assert.deepEqual(await retryInvitationDelivery(token, { invitationId: 'i1' }, deps), { status: 'sent' });
  assert.equal(getRetries(), 1);
});

test('retry provider failure propagates without changing invitation data', async () => {
  const invitation = { status: 'pending' };
  const { deps } = setup({
    async loadInvitation() { return invitation; },
    async retry() { throw new Error('provider failed'); },
  });
  await assert.rejects(retryInvitationDelivery(token, { invitationId: 'i1' }, deps));
  assert.equal(invitation.status, 'pending');
});
