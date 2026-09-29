import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildContributionEntitlement,
  contributionEntitlementId,
  grantContributionEntitlement,
  type WttContributionEntitlementRecord,
} from '../src/wtt/entitlements.js';

const timestamp = { toMillis: () => 1_800_000_000_000 };

function contribution(number: number, githubUserId = '1001') {
  return { number, season: 1, githubUserId, mergedAt: timestamp };
}

function memoryStore() {
  const records = new Map<string, WttContributionEntitlementRecord>();
  return {
    records,
    store: {
      async createIfAbsent(id: string, record: WttContributionEntitlementRecord) {
        if (records.has(id)) return 'already_exists' as const;
        records.set(id, record);
        return 'created' as const;
      },
    },
  };
}

test('eligible completed contribution earns one unclaimed WTT entitlement', async () => {
  const state = memoryStore();
  assert.deepEqual(await grantContributionEntitlement('7', contribution(7), state.store), {
    status: 'created', entitlementId: 'contribution:7',
  });
  assert.deepEqual(state.records.get('contribution:7'), {
    sourceType: 'contribution', sourceId: '7', githubProviderId: '1001',
    contributorId: '1001', amount: 1, status: 'unclaimed', claimId: null,
    earnedAt: timestamp, claimedAt: null, claimedWallet: null, claimTransaction: null,
  });
});

test('retrying the same completion does not create a second entitlement', async () => {
  const state = memoryStore();
  await grantContributionEntitlement('7', contribution(7), state.store);
  assert.deepEqual(await grantContributionEntitlement('7', contribution(7), state.store), {
    status: 'already_exists', entitlementId: 'contribution:7',
  });
  assert.equal(state.records.size, 1);
});

test('two contributions by one GitHub identity create two entitlements', async () => {
  const state = memoryStore();
  await grantContributionEntitlement('7', contribution(7), state.store);
  await grantContributionEntitlement('8', contribution(8), state.store);
  assert.deepEqual([...state.records.keys()], ['contribution:7', 'contribution:8']);
  assert.equal([...state.records.values()].every((record) => record.githubProviderId === '1001'), true);
});

test('founder contribution zero uses the same entitlement builder', () => {
  assert.equal(buildContributionEntitlement('0', {
    ...contribution(0, '9001'), contributionKind: 'founder_seed',
  })?.sourceId, '0');
  assert.equal(contributionEntitlementId(0), 'contribution:0');
});

test('malformed or mismatched contribution records are ineligible', async () => {
  const state = memoryStore();
  for (const [id, data] of [
    ['07', contribution(7)],
    ['7', contribution(8)],
    ['7', contribution(7, 'mutable-name')],
    ['7', { ...contribution(7), mergedAt: null }],
  ] as const) {
    assert.deepEqual(await grantContributionEntitlement(id, data, state.store), { status: 'ineligible' });
  }
  assert.equal(state.records.size, 0);
});
