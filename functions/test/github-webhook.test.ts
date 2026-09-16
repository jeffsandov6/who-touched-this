import assert from 'node:assert/strict';
import test from 'node:test';
import { qualifyPullRequestPayload } from '../src/github/qualification.js';
import { createGitHubSignature, verifyGitHubSignature } from '../src/github/signature.js';

const secret = 'synthetic-test-webhook-secret';
const config = { repository: 'jeffsandov6/who-touched-this', baseBranch: 'main' };

function payload(overrides: Record<string, unknown> = {}) {
  const base = {
    action: 'opened',
    repository: { full_name: config.repository },
    pull_request: {
      number: 41,
      html_url: 'https://github.com/jeffsandov6/who-touched-this/pull/41',
      draft: false,
      user: { id: 12345, login: 'new-username' },
      base: { ref: 'main', repo: { full_name: config.repository } },
      head: { ref: 'contribution', repo: { full_name: 'someone/a-fork' } },
    },
  };
  return { ...base, ...overrides };
}

function withPullRequest(changes: Record<string, unknown>, root: Record<string, unknown> = {}) {
  const value = payload(root);
  return { ...value, pull_request: { ...value.pull_request, ...changes } };
}

test('SHA-256 signature verification uses deterministic raw bytes', () => {
  const raw = Buffer.from('{"action":"opened"}');
  const signature = createGitHubSignature(raw, secret);
  assert.match(signature, /^sha256=[a-f0-9]{64}$/);
  assert.equal(verifyGitHubSignature(raw, signature, secret), true);
  assert.equal(verifyGitHubSignature(raw, undefined, secret), false);
  assert.equal(verifyGitHubSignature(raw, 'sha256=bad', secret), false);
  assert.equal(verifyGitHubSignature(Buffer.from('{"action":"edited"}'), signature, secret), false);
});

test('valid non-draft opened fork PR qualifies by canonical base repository and branch', () => {
  const result = qualifyPullRequestPayload(payload(), config);
  assert.equal(result.kind, 'qualified');
  if (result.kind === 'qualified') {
    assert.equal(result.pullRequest.authorGitHubUserId, '12345');
    assert.equal(result.pullRequest.prNumber, 41);
    assert.equal(result.pullRequest.prUrl, 'https://github.com/jeffsandov6/who-touched-this/pull/41');
  }
});

test('draft opened is ignored while ready_for_review non-draft qualifies', () => {
  assert.deepEqual(
    qualifyPullRequestPayload(withPullRequest({ draft: true }), config).kind,
    'ignored',
  );
  const ready = qualifyPullRequestPayload(withPullRequest(
    { draft: false }, { action: 'ready_for_review' },
  ), config);
  assert.equal(ready.kind, 'qualified');
});

test('wrong repository and wrong base branch do not qualify', () => {
  assert.equal(qualifyPullRequestPayload(payload({
    repository: { full_name: 'another-owner/another-repository' },
  }), config).kind, 'ignored');
  const wrongBranch = qualifyPullRequestPayload(withPullRequest({
    base: { ref: 'develop', repo: { full_name: config.repository } },
  }), config);
  assert.equal(wrongBranch.kind, 'ignored');
});

test('invalid PR number and structurally invalid URL are rejected', () => {
  assert.equal(qualifyPullRequestPayload(withPullRequest({ number: 0 }), config).kind, 'ignored');
  assert.equal(qualifyPullRequestPayload(withPullRequest({
    html_url: 'https://github.com/jeffsandov6/who-touched-this/issues/41',
  }), config).kind, 'ignored');
});

test('numeric identity is returned independently of mutable username presentation', () => {
  const changedUsername = qualifyPullRequestPayload(withPullRequest({
    user: { id: 12345, login: 'completely-renamed' },
  }), config);
  assert.equal(changedUsername.kind, 'qualified');
  if (changedUsername.kind === 'qualified') {
    assert.equal(changedUsername.pullRequest.authorGitHubUserId, '12345');
    assert.equal('githubUsername' in changedUsername.pullRequest, false);
  }
  const usernameOnly = qualifyPullRequestPayload(withPullRequest({
    user: { id: 99999, login: 'expected-username' },
  }), config);
  assert.equal(usernameOnly.kind, 'qualified');
  if (usernameOnly.kind === 'qualified') {
    assert.notEqual(usernameOnly.pullRequest.authorGitHubUserId, '12345');
  }
});

test('synchronize, edited, and reopened pull request actions are acknowledged as irrelevant', () => {
  for (const action of ['synchronize', 'edited', 'reopened']) {
    const result = qualifyPullRequestPayload(payload({ action }), config);
    assert.equal(result.kind, 'ignored');
    if (result.kind === 'ignored') assert.equal(result.code, 'unsupported_action');
  }
});
