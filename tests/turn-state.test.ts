import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_PUBLIC_SITE_STATE,
  calculateTargetContributionNumber,
  formatCountdown,
  getCountdownState,
  parsePublicSiteState,
} from '../src/platform/turn-state.ts';

const timestamp = (milliseconds: number) => ({ toMillis: () => milliseconds });

test('target contribution number is current version plus one without mutating current version', () => {
  assert.equal(calculateTargetContributionNumber(11), 12);
  assert.equal(calculateTargetContributionNumber(0), 1);
});

test('countdown formats a deterministic positive duration', () => {
  const state = getCountdownState(1000 + 6 * 86_400_000 + 4 * 3_600_000 + 12 * 60_000 + 33_000, 1000);
  assert.equal(formatCountdown(state), '6d 04h 12m 33s');
  assert.equal(state.expired, false);
});

test('countdown never becomes negative and reports expiration', () => {
  const state = getCountdownState(1000, 5000);
  assert.equal(state.totalSeconds, 0);
  assert.deepEqual([state.days, state.hours, state.minutes, state.seconds], [0, 0, 0, 0]);
  assert.equal(formatCountdown(state), 'Deadline passed');
});

test('missing public site state falls back to the safe initial state', () => {
  assert.deepEqual(parsePublicSiteState(undefined), DEFAULT_PUBLIC_SITE_STATE);
});

test('valid inactive public state parses without fake contributor data', () => {
  assert.deepEqual(
    parsePublicSiteState({
      currentVersion: 0,
      totalContributions: 0,
      turnStatus: 'none',
      targetContributionNumber: null,
      currentContributor: null,
      dueAt: null,
      updatedAt: timestamp(1000),
    }),
    DEFAULT_PUBLIC_SITE_STATE,
  );
});

test('valid active public state parses only public presentation data', () => {
  assert.deepEqual(
    parsePublicSiteState({
      currentVersion: 11,
      totalContributions: 11,
      turnStatus: 'active',
      targetContributionNumber: 12,
      currentContributor: { githubUsername: 'alice', displayName: 'Alice' },
      dueAt: timestamp(9000),
      updatedAt: timestamp(1000),
    }),
    {
      currentVersion: 11,
      totalContributions: 11,
      turnStatus: 'active',
      targetContributionNumber: 12,
      currentContributor: { githubUsername: 'alice', displayName: 'Alice' },
      dueAtMillis: 9000,
    },
  );
});

test('malformed or expanded public state fails closed to the initial state', () => {
  assert.deepEqual(
    parsePublicSiteState({
      currentVersion: 0,
      totalContributions: 0,
      turnStatus: 'active',
      targetContributionNumber: 1,
      currentContributor: { githubUsername: 'alice', displayName: 'Alice' },
      dueAt: timestamp(9000),
      updatedAt: timestamp(1000),
      email: 'private@example.test',
    }),
    DEFAULT_PUBLIC_SITE_STATE,
  );
});
