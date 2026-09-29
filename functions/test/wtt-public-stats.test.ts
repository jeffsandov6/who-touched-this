import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateWttEntitlements,
  computePublicWttStats,
  reconcilePublicWttStats,
  refreshPublicWttStats,
  type PublicWttStatsRecord,
  type PublicWttStatsStore,
  type WttStatsEntitlementSource,
} from '../src/wtt/public-stats.js';
import { WTT_DECIMALS, WTT_MINT_ADDRESS, WTT_TOKEN_PROGRAM_ADDRESS } from '../src/wtt/config.js';
import { validateWttMintSupply } from '../src/wtt/solana-supply.js';
import { readFile } from 'node:fs/promises';

const timestamp = { toMillis: () => 1_800_000_000_000 };

function entitlement(
  id: string,
  status: 'unclaimed' | 'claiming' | 'claimed',
  amount = 1,
  wallet = `FakeWallet-${id}`,
): WttStatsEntitlementSource {
  const sourceId = id.slice(id.indexOf(':') + 1);
  const base = {
    sourceType: id.slice(0, id.indexOf(':')),
    sourceId,
    githubProviderId: '12345',
    contributorId: '12345',
    amount,
    earnedAt: timestamp,
  };
  if (status === 'claimed') return {
    id,
    data: {
      ...base, status, claimId: `claim-${sourceId}`, claimedAt: timestamp,
      claimedWallet: wallet, claimTransaction: `signature-${sourceId}`,
    },
  };
  if (status === 'claiming') return {
    id,
    data: {
      ...base, status, claimId: `claim-${sourceId}`, claimedAt: null,
      claimedWallet: null, claimTransaction: null,
    },
  };
  return {
    id,
    data: {
      ...base, status, claimId: null, claimedAt: null,
      claimedWallet: null, claimTransaction: null,
    },
  };
}

function fakeStore(entitlements: WttStatsEntitlementSource[], initial: Record<string, unknown> | null = null) {
  let current = initial;
  const writes: PublicWttStatsRecord[] = [];
  const store: PublicWttStatsStore = {
    async listEntitlements() { return entitlements; },
    async loadCurrent() { return current; },
    async writeCurrentIfNewer(record) {
      const previous = current?.updatedAt as Date | undefined;
      if (previous && previous.getTime() >= record.updatedAt.getTime()) return 'stale';
      writes.push(record);
      current = record as unknown as Record<string, unknown>;
      return 'written';
    },
  };
  return { store, writes, current: () => current };
}

test('zero, unclaimed, and claiming entitlements aggregate without inventing claims or holders', () => {
  assert.deepEqual(aggregateWttEntitlements([]), { earned: 0, claimed: 0, holders: 0 });
  assert.deepEqual(aggregateWttEntitlements([
    entitlement('contribution:0', 'unclaimed'),
    entitlement('contribution:1', 'claiming'),
  ]), { earned: 2, claimed: 0, holders: 0 });
});

test('claimed amounts and distinct wallets aggregate canonically', () => {
  assert.deepEqual(aggregateWttEntitlements([
    entitlement('contribution:1', 'claimed', 1, 'same-wallet'),
    entitlement('season_bonus:2', 'claimed', 1, 'same-wallet'),
  ]), { earned: 2, claimed: 2, holders: 1 });
  assert.deepEqual(aggregateWttEntitlements([
    entitlement('admin_award:one', 'claimed', 2, 'wallet-one'),
    entitlement('game:two', 'claimed', 3, 'wallet-two'),
  ]), { earned: 5, claimed: 5, holders: 2 });
});

test('public supply comes from the mocked Solana reader rather than claimed totals', async () => {
  const state = fakeStore([entitlement('contribution:0', 'claimed')]);
  assert.deepEqual(await computePublicWttStats({
    store: state.store,
    supply: { async loadSupply() { return 17; } },
  }), { earned: 1, claimed: 1, holders: 1, supply: 17 });
});

test('RPC failure preserves the last valid aggregate without any write', async () => {
  const original = {
    earned: 1, claimed: 0, holders: 0, supply: 0,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  const state = fakeStore([entitlement('contribution:0', 'unclaimed')], original);
  await assert.rejects(refreshPublicWttStats(new Date('2026-01-02T00:00:00.000Z'), {
    store: state.store,
    supply: { async loadSupply() { throw new Error('RPC unavailable'); } },
  }), /RPC unavailable/);
  assert.equal(state.writes.length, 0);
  assert.equal(state.current(), original);
});

test('an older retried refresh cannot overwrite a newer aggregate', async () => {
  const state = fakeStore([entitlement('contribution:0', 'unclaimed')], {
    earned: 1, claimed: 0, holders: 0, supply: 0,
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  });
  const result = await refreshPublicWttStats(new Date('2026-01-01T00:00:00.000Z'), {
    store: state.store,
    supply: { async loadSupply() { return 0; } },
  });
  assert.equal(result.write, 'stale');
  assert.equal(state.writes.length, 0);
});

test('reconciliation dry run is deterministic and explicit apply writes expected values', async () => {
  const state = fakeStore([
    entitlement('contribution:0', 'claimed', 1, 'wallet-one'),
    entitlement('contribution:1', 'claimed', 1, 'wallet-two'),
  ], {
    earned: 1, claimed: 0, holders: 0, supply: 0,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  const dependencies = {
    store: state.store,
    supply: { async loadSupply() { return 9; } },
  };
  const dryRun = await reconcilePublicWttStats(
    false, new Date('2026-01-02T00:00:00.000Z'), dependencies,
  );
  assert.deepEqual(dryRun.expected, { earned: 2, claimed: 2, holders: 2, supply: 9 });
  assert.deepEqual(dryRun.differences, ['earned', 'claimed', 'holders', 'supply']);
  assert.equal(dryRun.applied, false);
  assert.equal(state.writes.length, 0);

  const applied = await reconcilePublicWttStats(
    true, new Date('2026-01-02T00:00:00.000Z'), dependencies,
  );
  assert.equal(applied.applied, true);
  assert.equal(state.writes.length, 1);
  assert.deepEqual(state.writes[0], {
    earned: 2, claimed: 2, holders: 2, supply: 9,
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  });
});

test('reconciliation treats any identity-bearing extra public field as malformed and replaces it on apply', async () => {
  const state = fakeStore([], {
    earned: 0, claimed: 0, holders: 0, supply: 0,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    claimedWallet: 'must-not-be-public',
  });
  const dependencies = {
    store: state.store,
    supply: { async loadSupply() { return 0; } },
  };
  const dryRun = await reconcilePublicWttStats(
    false, new Date('2026-01-02T00:00:00.000Z'), dependencies,
  );
  assert.equal(dryRun.storedStatus, 'malformed');
  const applied = await reconcilePublicWttStats(
    true, new Date('2026-01-02T00:00:00.000Z'), dependencies,
  );
  assert.equal(applied.applied, true);
  assert.equal('claimedWallet' in (state.current() ?? {}), false);
});

test('expected founder lifecycle is 0/0/0/0 to 1/0/0/0 to 1/1/1/1', async () => {
  const entitlements: WttStatsEntitlementSource[] = [];
  const state = fakeStore(entitlements);
  let supply = 0;
  const dependencies = { store: state.store, supply: { async loadSupply() { return supply; } } };
  assert.deepEqual(await computePublicWttStats(dependencies), {
    earned: 0, claimed: 0, holders: 0, supply: 0,
  });
  entitlements.push(entitlement('contribution:0', 'unclaimed'));
  assert.deepEqual(await computePublicWttStats(dependencies), {
    earned: 1, claimed: 0, holders: 0, supply: 0,
  });
  entitlements[0] = entitlement('contribution:0', 'claimed', 1, 'founder-wallet');
  supply = 1;
  assert.deepEqual(await computePublicWttStats(dependencies), {
    earned: 1, claimed: 1, holders: 1, supply: 1,
  });
});

test('supply validation binds the official mint, Classic Token Program, and zero decimals', () => {
  const valid = {
    address: WTT_MINT_ADDRESS,
    programAddress: WTT_TOKEN_PROGRAM_ADDRESS,
    decimals: WTT_DECIMALS,
    isInitialized: true,
    supply: 12n,
  };
  assert.equal(validateWttMintSupply(valid), 12);
  assert.throws(() => validateWttMintSupply({ ...valid, address: 'wrong' }));
  assert.throws(() => validateWttMintSupply({ ...valid, programAddress: 'wrong' }));
  assert.throws(() => validateWttMintSupply({ ...valid, decimals: 9 }));
});

test('the retryable entitlement trigger never contacts Solana from the emulator', async () => {
  const source = await readFile(new URL('../../src/index.ts', import.meta.url), 'utf8');
  assert.match(source, /refreshPublicWttStats = onDocumentWritten\(\{[\s\S]*retry: true/);
  assert.match(source, /if \(process\.env\.FUNCTIONS_EMULATOR === 'true'\) \{[\s\S]*wtt_public_stats_emulator_skipped[\s\S]*return;/);
});
