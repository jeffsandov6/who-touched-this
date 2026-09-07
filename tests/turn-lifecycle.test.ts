import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canExpireTurn,
  getPublicTurnPresentation,
  normalizePullRequestSubmission,
  PullRequestValidationError,
} from '../src/platform/turn-lifecycle.ts';

test('normalizes a valid GitHub pull request URL', () => {
  assert.deepEqual(
    normalizePullRequestSubmission(
      '  https://github.com/example/repo/pull/123?tab=checks  ',
      '123',
    ),
    { prUrl: 'https://github.com/example/repo/pull/123', prNumber: 123 },
  );
});

for (const [description, url, number] of [
  ['HTTP URL', 'http://github.com/example/repo/pull/123', 123],
  ['non-GitHub host', 'https://example.com/foo/pull/123', 123],
  ['issue URL', 'https://github.com/example/repo/issues/123', 123],
  ['nonnumeric PR', 'https://github.com/example/repo/pull/not-a-number', 123],
  ['credentials', 'https://user:password@github.com/example/repo/pull/123', 123],
  ['number mismatch', 'https://github.com/example/repo/pull/123', 124],
] as const) {
  test(`rejects ${description}`, () => {
    assert.throws(
      () => normalizePullRequestSubmission(url, number),
      PullRequestValidationError,
    );
  });
}

test('expiration becomes available exactly at the deadline for active turns', () => {
  assert.equal(canExpireTurn('active', 1000, 999), false);
  assert.equal(canExpireTurn('active', 1000, 1000), true);
  assert.equal(canExpireTurn('active', 1000, 1001), true);
  assert.equal(canExpireTurn('submitted', 1000, 1001), false);
  assert.equal(canExpireTurn('under_review', 1000, 1001), false);
});

test('maps current public states to restrained presentation', () => {
  assert.deepEqual(getPublicTurnPresentation('active'), {
    statusLabel: 'active', targetLabel: 'working on', showCountdown: true,
  });
  assert.deepEqual(getPublicTurnPresentation('submitted'), {
    statusLabel: 'pr submitted', targetLabel: 'contribution', showCountdown: false,
  });
  assert.deepEqual(getPublicTurnPresentation('under_review'), {
    statusLabel: 'under review', targetLabel: 'contribution', showCountdown: false,
  });
  assert.deepEqual(getPublicTurnPresentation('none'), {
    statusLabel: 'no active turn', targetLabel: null, showCountdown: false,
  });
});
