import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  calculateWttEntitlementTotals,
  parseWttEntitlement,
  wttEntitlementSourceLabel,
  type ParsedWttEntitlement,
} from '../src/platform/wtt-entitlements.ts';

const timestamp = (milliseconds: number) => ({ toDate: () => new Date(milliseconds) });

function record(sourceId: string, overrides: Record<string, unknown> = {}) {
  return {
    sourceType: 'contribution', sourceId, githubProviderId: '1001', contributorId: '1001',
    amount: 1, status: 'unclaimed', claimId: null, earnedAt: timestamp(Number(sourceId) * 1000),
    claimedAt: null, claimedWallet: null, claimTransaction: null, ...overrides,
  };
}

function parse(sourceId: string, overrides: Record<string, unknown> = {}) {
  return parseWttEntitlement(`contribution:${sourceId}`, record(sourceId, overrides), '1001');
}

test('no-entitlement state totals are all zero', () => {
  assert.deepEqual(calculateWttEntitlementTotals([]), { earned: 0, unclaimed: 0, claimed: 0 });
});

test('multiple entitlements for one stable GitHub identity parse independently', () => {
  const entitlements = ['12', '47', '81'].map((sourceId) => parse(sourceId));
  assert.equal(entitlements.every(Boolean), true);
  assert.deepEqual(calculateWttEntitlementTotals(entitlements as ParsedWttEntitlement[]), {
    earned: 3, unclaimed: 3, claimed: 0,
  });
  assert.equal(wttEntitlementSourceLabel(entitlements[0]!), 'Contribution #012');
});

test('claimed and unclaimed amounts coexist in earned totals', () => {
  const claimed = parse('12', {
    amount: 2, status: 'claimed', claimId: 'claim-1', claimedAt: timestamp(20_000),
    claimedWallet: 'FakeWallet111111111111111111111111111111', claimTransaction: 'fake-tx-1',
  });
  const unclaimed = parse('47');
  assert.ok(claimed && unclaimed);
  assert.deepEqual(calculateWttEntitlementTotals([claimed, unclaimed]), {
    earned: 3, unclaimed: 1, claimed: 2,
  });
});

test('all-claimed totals leave nothing unclaimed while preserving earned history', () => {
  const claimed = ['12', '47'].map((sourceId, index) => parse(sourceId, {
    status: 'claimed', claimId: `claim-${index + 1}`, claimedAt: timestamp(20_000 + index),
    claimedWallet: `FakeWallet${index + 1}`, claimTransaction: `fake-tx-${index + 1}`,
  })) as ParsedWttEntitlement[];
  assert.deepEqual(calculateWttEntitlementTotals(claimed), {
    earned: 2, unclaimed: 0, claimed: 2,
  });
});

test('claiming remains unclaimed in public totals and final claim fields parse safely', () => {
  const claiming = parse('12', { status: 'claiming', claimId: 'challenge-12' });
  const claimed = parse('47', {
    status: 'claimed', claimId: 'challenge-47', claimedAt: timestamp(47_000),
    claimedWallet: 'RecipientWallet', claimTransaction: 'confirmed-signature',
  });
  assert.ok(claiming && claimed);
  assert.deepEqual(calculateWttEntitlementTotals([claiming, claimed]), {
    earned: 2, unclaimed: 1, claimed: 1,
  });
  assert.equal(claiming.status, 'claiming');
  assert.equal(claimed.status, 'claimed');
  assert.equal(claimed.claimedWallet, 'RecipientWallet');
  assert.equal(claimed.claimTransaction, 'confirmed-signature');
  assert.equal(parse('81', {
    status: 'claimed', claimId: 'challenge-81', claimedAt: timestamp(81_000),
    claimedWallet: null, claimTransaction: null,
  }), null);
});

test('records cannot cross GitHub identities and malformed claim state fails closed', () => {
  assert.equal(parseWttEntitlement('contribution:12', record('12'), '2002'), null);
  assert.equal(parse('12', { githubProviderId: 'mutable-username' }), null);
  assert.equal(parse('12', { status: 'claimed', claimId: null, claimedAt: null }), null);
  assert.equal(parseWttEntitlement('contribution:13', record('12'), '1001'), null);
});

test('future source types have centralized display labels', () => {
  const base = parse('12')!;
  assert.equal(wttEntitlementSourceLabel({ ...base, id: 'easter_egg:first-touch', sourceType: 'easter_egg', sourceId: 'first-touch' }), 'Easter egg: first-touch');
  assert.equal(wttEntitlementSourceLabel({ ...base, id: 'game:cursor-run', sourceType: 'game', sourceId: 'cursor-run' }), 'Game: cursor-run');
  assert.equal(wttEntitlementSourceLabel({ ...base, id: 'season_bonus:2', sourceType: 'season_bonus', sourceId: '2' }), 'Season 2 bonus');
});

test('claim page presents signed-out, empty, totals, history, wallet, and all-claimed states', async () => {
  const source = await readFile(new URL('../src/platform/pages/WttClaimPage.tsx', import.meta.url), 'utf8');
  for (const text of [
    'continue with GitHub',
    'no wtt waiting for you',
    "you've earned {totals.earned} wtt",
    'connect wallet',
    'verify wallet',
    'Signing this message does not send a transaction and does not cost SOL.',
    'wallet ownership verified. nothing has been minted yet.',
    'claim ${verifiedChallenge.amount} wtt',
    'claim in progress',
    'resume claim',
    'view confirmed transaction on Solscan',
    'nothing remains to claim',
    'entitlement.status',
  ]) assert.ok(source.includes(text), text);
  assert.match(source, /entitlements\.map\(\(entitlement\)/);
  assert.match(source, /href=\{`\/history\/\$\{entitlement\.sourceId\}`\}/);
});

test('claim page selection supports many unclaimed records but disables claimed history', async () => {
  const source = await readFile(new URL('../src/platform/pages/WttClaimPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /new Set\(unclaimedIds\)/);
  assert.match(source, /selectedEntitlementIds\.has\(entitlement\.id\)/);
  assert.match(source, /disabled=\{entitlement\.status !== 'unclaimed'\}/);
  assert.match(source, /selectedEntitlementIds\.size === 0/);
  assert.ok(source.includes('select all unclaimed'));
  assert.ok(source.includes('clear selection'));
  assert.match(source, /filter\(\(entitlement\) => entitlement\.status === 'unclaimed'\)/);
  assert.match(source, /if \(entitlement\.status !== 'claiming'\) continue/);
});

test('claim execution sends only challengeId and guards repeat clicks', async () => {
  const page = await readFile(new URL('../src/platform/pages/WttClaimPage.tsx', import.meta.url), 'utf8');
  const callable = await readFile(new URL('../src/platform/firebase/wtt-claim-challenges.ts', import.meta.url), 'utf8');
  assert.match(callable, /callable\(\{ challengeId \}\)/);
  assert.match(page, /if \(!identity \|\| claimBusy\) return/);
  assert.match(page, /disabled=\{claimBusy\}/);
  assert.match(page, /claimWtt\(claimId\)/);
  assert.match(page, /handleClaim\(claim\.claimId\)/);
  assert.match(page, /https:\/\/solscan\.io\/tx/);
});

test('selection and wallet changes clear the local verified state', async () => {
  const source = await readFile(new URL('../src/platform/pages/WttClaimPage.tsx', import.meta.url), 'utf8');
  const resets = source.match(/clearVerifiedChallenge\(\)/g) ?? [];
  assert.ok(resets.length >= 6, 'verified state is reset across auth, selection, and wallet changes');
  assert.match(source, /changeSelection[\s\S]*clearVerifiedChallenge\(\)/);
  assert.match(source, /account\.address !== connection\.account\.address[\s\S]*clearVerifiedChallenge\(\)/);
  assert.match(source, /verificationRequest === verificationSequence\.current/);
});
