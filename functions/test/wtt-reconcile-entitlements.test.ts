import assert from 'node:assert/strict';
import test from 'node:test';
import {
  reconcileContributionEntitlements,
  WttEntitlementReconciliationError,
} from '../src/wtt/reconcile-entitlements.js';
import { buildContributionEntitlement } from '../src/wtt/entitlements.js';

const earnedAt = { toMillis: () => 1_800_000_000_000 };
const contribution = (number: number) => ({
  number, season: number === 47 ? 2 : 1, githubUserId: '12345', mergedAt: earnedAt,
});

function setup(records = new Map<string, Record<string, unknown>>()) {
  const contributions = [0, 12, 47].map((number) => ({
    id: String(number), data: contribution(number),
  }));
  let grants = 0;
  return {
    records,
    grants: () => grants,
    dependencies: {
      async listContributions() { return contributions; },
      async loadEntitlement(id: string) { return records.get(id) ?? null; },
      async grant(id: string, data: Record<string, unknown>) {
        grants += 1;
        const expected = buildContributionEntitlement(id, data)!;
        const entitlementId = `contribution:${id}`;
        if (records.has(entitlementId)) return { status: 'already_exists' as const, entitlementId };
        records.set(entitlementId, expected as unknown as Record<string, unknown>);
        return { status: 'created' as const, entitlementId };
      },
    },
  };
}

test('reconciliation defaults safely to a read-only dry-run report including contribution zero', async () => {
  const state = setup();
  const report = await reconcileContributionEntitlements(false, state.dependencies);
  assert.deepEqual(report, {
    mode: 'dry-run', scanned: 3, present: 0, missing: 3, created: 0,
    malformedContributions: [], conflictingEntitlements: [],
  });
  assert.equal(state.grants(), 0);
});

test('apply creates only missing canonical entitlements and leaves valid records untouched', async () => {
  const records = new Map<string, Record<string, unknown>>();
  records.set('contribution:12', buildContributionEntitlement('12', contribution(12)) as unknown as Record<string, unknown>);
  const original = records.get('contribution:12');
  const state = setup(records);
  const report = await reconcileContributionEntitlements(true, state.dependencies);
  assert.equal(report.present, 1);
  assert.equal(report.missing, 2);
  assert.equal(report.created, 2);
  assert.equal(state.grants(), 2);
  assert.equal(records.get('contribution:12'), original);
  assert.ok(records.has('contribution:0'));
});

test('claimed canonical entitlement is valid history and is never changed', async () => {
  const records = new Map<string, Record<string, unknown>>();
  const claimedAt = { toMillis: () => 1_900_000_000_000 };
  const claimed = {
    ...buildContributionEntitlement('12', contribution(12)), status: 'claimed',
    claimId: 'claim-12', claimedAt, claimedWallet: 'wallet', claimTransaction: 'signature',
  };
  records.set('contribution:12', claimed);
  const state = setup(records);
  await reconcileContributionEntitlements(true, state.dependencies);
  assert.equal(records.get('contribution:12'), claimed);
});

test('malformed contribution or conflicting entitlement refuses the entire apply', async () => {
  const state = setup(new Map([['contribution:12', {
    ...buildContributionEntitlement('12', contribution(12)), githubProviderId: '99999',
  } as Record<string, unknown>]]));
  await assert.rejects(
    reconcileContributionEntitlements(true, state.dependencies),
    (error) => error instanceof WttEntitlementReconciliationError
      && error.report.conflictingEntitlements.length === 1,
  );
  assert.equal(state.grants(), 0);
  assert.equal(state.records.has('contribution:0'), false);
});
