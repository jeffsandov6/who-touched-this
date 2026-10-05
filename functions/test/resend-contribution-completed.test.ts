import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resendContributionCompletedEmail,
  ResendContributionError,
} from '../src/email/resend-contribution-completed.js';
import { buildContributionEntitlement } from '../src/wtt/entitlements.js';

const auth = { firebase: { identities: { 'github.com': ['12345'] } } };
const mergedAt = { toMillis: () => 1_800_000_000_000 };
const contribution = {
  number: 12, season: 1, githubUserId: '67890', mergedAt,
  summary: 'A permanent touch.', prUrl: 'https://github.com/example/repo/pull/12',
};

function setup(entitlement: Record<string, unknown> = buildContributionEntitlement(
  '12', contribution,
) as unknown as Record<string, unknown>, result: {
  kind: 'sent' | 'already-sent' | 'busy' | 'failed'; code?: string;
} = { kind: 'sent' }) {
  let sends = 0;
  return {
    sends: () => sends,
    entitlement,
    dependencies: {
      async loadAdmin() { return { githubUserId: '12345', active: true, role: 'owner' }; },
      async loadContribution() { return contribution; },
      async loadEntitlement() { return entitlement; },
      async resend() { sends += 1; return result; },
    },
  };
}

async function rejectsCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error) => error instanceof ResendContributionError && error.code === code);
}

test('completion resend requires an authenticated active maintainer and exact input', async () => {
  const state = setup();
  await rejectsCode(resendContributionCompletedEmail(null, { contributionNumber: 12 }, state.dependencies), 'unauthenticated');
  await rejectsCode(resendContributionCompletedEmail(auth, { contributionNumber: 12, email: 'attacker@example.test' }, state.dependencies), 'invalid-argument');
  await rejectsCode(resendContributionCompletedEmail(auth, { contributionNumber: 12 }, {
    ...state.dependencies, async loadAdmin() { return null; },
  }), 'permission-denied');
});

test('resend uses historical entitlement without creating or resetting it', async () => {
  for (const status of ['unclaimed', 'claimed'] as const) {
    const base = buildContributionEntitlement('12', contribution)!;
    const entitlement = status === 'unclaimed' ? { ...base } : {
      ...base, status: 'claimed', claimId: 'claim-12', claimedAt: { toMillis: () => 1_900_000_000_000 },
      claimedWallet: 'wallet', claimTransaction: 'signature',
    };
    const state = setup(entitlement as unknown as Record<string, unknown>);
    const before = structuredClone({ ...entitlement, earnedAt: null, claimedAt: status === 'claimed' ? 'present' : null });
    assert.deepEqual(await resendContributionCompletedEmail(
      auth, { contributionNumber: 12 }, state.dependencies,
    ), { status: 'sent' });
    assert.equal(state.sends(), 1);
    assert.equal(state.entitlement.status, status);
    assert.equal(state.entitlement.claimId, before.claimId);
  }
});

test('resend refuses a missing or inconsistent entitlement', async () => {
  const state = setup({ ...buildContributionEntitlement('12', contribution), amount: 2 });
  await rejectsCode(resendContributionCompletedEmail(
    auth, { contributionNumber: 12 }, state.dependencies,
  ), 'failed-precondition');
  assert.equal(state.sends(), 0);
});

test('resend treats only sent and already-sent as successful outcomes', async () => {
  for (const kind of ['sent', 'already-sent'] as const) {
    const state = setup(undefined, { kind });
    assert.deepEqual(await resendContributionCompletedEmail(
      auth, { contributionNumber: 12 }, state.dependencies,
    ), { status: kind });
  }
  await rejectsCode(resendContributionCompletedEmail(
    auth, { contributionNumber: 12 }, setup(undefined, {
      kind: 'failed', code: 'missing_contact_email',
    }).dependencies,
  ), 'failed-precondition');
  await rejectsCode(resendContributionCompletedEmail(
    auth, { contributionNumber: 12 }, setup(undefined, { kind: 'busy' }).dependencies,
  ), 'unavailable');
});
