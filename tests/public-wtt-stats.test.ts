import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parsePublicWttStats } from '../src/platform/public-wtt-stats.ts';
import { PUBLIC_WTT_STATS_DOCUMENT_PATH } from '../src/platform/firebase/paths.ts';

const updatedAt = { toDate: () => new Date('2026-01-01T00:00:00.000Z') };

test('public WTT stats parser accepts only bounded aggregate fields', () => {
  assert.deepEqual(parsePublicWttStats({
    earned: 2, claimed: 1, holders: 1, supply: 7, updatedAt,
  }), {
    earned: 2,
    claimed: 1,
    holders: 1,
    supply: 7,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  assert.equal(parsePublicWttStats({ earned: 1, claimed: 2, holders: 1, supply: 2, updatedAt }), null);
  assert.equal(parsePublicWttStats({ earned: 1, claimed: 1, holders: 2, supply: 1, updatedAt }), null);
  assert.equal(parsePublicWttStats({ earned: 1, claimed: 1, holders: 1, supply: -1, updatedAt }), null);
  assert.equal(parsePublicWttStats({
    earned: 1, claimed: 1, holders: 1, supply: 1, updatedAt,
    claimedWallet: 'must-not-be-public',
  }), null);
});

test('public client subscribes only to the aggregate and exposes all non-fake UI states', async () => {
  const source = await readFile(new URL('../src/platform/firebase/public-wtt-stats.ts', import.meta.url), 'utf8');
  assert.equal(PUBLIC_WTT_STATS_DOCUMENT_PATH, 'publicWttStats/current');
  assert.match(source, /onState\(\{ status: 'loading' \}\)/);
  assert.match(source, /doc\(getPlatformFirestore\(\), PUBLIC_WTT_STATS_DOCUMENT_PATH\)/);
  assert.match(source, /status: 'ready'/);
  assert.match(source, /status: 'missing'/);
  assert.match(source, /status: 'error'/);
  assert.doesNotMatch(source, /wttEntitlements|wttClaims|wttClaimChallenges|claimedWallet/);
});
