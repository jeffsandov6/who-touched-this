import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateMergedCounters,
  ContributionValidationError,
  validateContributionDetails,
} from '../src/platform/contribution-validation.ts';
import {
  formatContributionNumber,
  parseHistoryEvent,
  parsePublicContribution,
} from '../src/platform/history.ts';

const timestamp = (milliseconds: number) => ({ toDate: () => new Date(milliseconds) });

test('contribution details trim required summary and optional message', () => {
  assert.deepEqual(validateContributionDetails('  Added a button.  ', '  Hello!  '), {
    summary: 'Added a button.', contributorMessage: 'Hello!',
  });
  assert.deepEqual(validateContributionDetails('Added a button.', '   '), {
    summary: 'Added a button.',
  });
});

test('summary is required and bounded', () => {
  for (const value of ['', '   ', 'x'.repeat(161)]) {
    assert.throws(() => validateContributionDetails(value, ''), ContributionValidationError);
  }
  assert.equal(validateContributionDetails('x'.repeat(160), '').summary.length, 160);
});

test('contributor message is optional and bounded', () => {
  assert.equal(validateContributionDetails('Summary', 'x'.repeat(280)).contributorMessage?.length, 280);
  assert.throws(
    () => validateContributionDetails('Summary', 'x'.repeat(281)),
    ContributionValidationError,
  );
});

test('merged counters advance exactly once and require the next target', () => {
  assert.deepEqual(calculateMergedCounters(4, 4, 5), {
    currentVersion: 5, totalContributions: 5,
  });
  assert.throws(() => calculateMergedCounters(4, 4, 6), ContributionValidationError);
});

test('public History event parser distinguishes contributions from failed turns', () => {
  assert.deepEqual(parseHistoryEvent('turn-a', {
    type: 'turn_expired', season: 1, displayName: 'Alice', githubUsername: 'alice',
    targetContributionNumber: 1, occurredAt: timestamp(1000),
  })?.type, 'turn_expired');
  const contributionEvent = parseHistoryEvent('turn-b', {
    type: 'contribution', season: 1, displayName: 'Bob', githubUsername: 'bob',
    targetContributionNumber: 1, contributionNumber: 1, occurredAt: timestamp(2000),
  });
  assert.equal(
    contributionEvent?.type === 'contribution' ? contributionEvent.contributionNumber : null,
    1,
  );
});

test('public parsers reject expanded private data', () => {
  assert.equal(parseHistoryEvent('turn-a', {
    type: 'turn_skipped', season: 1, displayName: 'Alice', githubUsername: 'alice',
    targetContributionNumber: 1, occurredAt: timestamp(1000), email: 'private@example.test',
  }), null);
  assert.equal(parsePublicContribution({
    number: 1, season: 1, displayName: 'Alice', githubUsername: 'alice', summary: 'Summary',
    prNumber: 27, prUrl: 'https://github.com/example/repo/pull/27',
    mergedAt: timestamp(1000), createdAt: timestamp(1000), githubUserId: '123',
  }), null);
});

test('public contribution parsing and display formatting are deterministic', () => {
  const contribution = parsePublicContribution({
    number: 1, season: 1, displayName: 'Alice', githubUsername: 'alice', summary: 'Summary',
    contributorMessage: 'Thanks!', prNumber: 27,
    prUrl: 'https://github.com/example/repo/pull/27',
    mergedAt: timestamp(1000), createdAt: timestamp(1000),
  });
  assert.equal(contribution?.prNumber, 27);
  assert.equal(formatContributionNumber(1), '#001');
  assert.equal(formatContributionNumber(123), '#123');
});
