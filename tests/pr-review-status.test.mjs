import assert from 'node:assert/strict';
import test from 'node:test';
import {
  reviewConclusion,
  reportTrustedContributorReview,
  TRUSTED_REVIEW_CHECK_NAME,
} from '../scripts/pr-review/status.mjs';

const baseSha = 'a'.repeat(40);
const headSha = 'b'.repeat(40);
const handoff = {
  schemaVersion: 1,
  pullRequestNumber: 42,
  baseRepository: 'JeffSandov6/who-touched-this',
  baseSha,
  headRepository: 'malicious-fork/who-touched-this',
  headSha,
};
const successResults = { handoff: 'success', build: 'success', preview: 'success' };

function pull(overrides = {}) {
  return {
    number: 42,
    state: 'open',
    base: { sha: baseSha, repo: { full_name: handoff.baseRepository } },
    head: { sha: headSha, repo: { full_name: handoff.headRepository } },
    ...overrides,
  };
}

function githubMock(currentPull = pull()) {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    if (options.method === 'POST') return { ok: true, status: 201, json: async () => ({ id: 99 }) };
    return { ok: true, status: 200, json: async () => currentPull };
  };
  return { calls, request };
}

function reportInput(mock, overrides = {}) {
  return {
    handoff,
    jobResults: successResults,
    token: 'test-read-checks-write-token',
    detailsUrl: 'https://github.com/JeffSandov6/who-touched-this/actions/runs/1234',
    request: mock.request,
    ...overrides,
  };
}

test('success requires validated handoff, sandboxed build, preview, and current exact PR identity', async () => {
  const mock = githubMock();
  const result = await reportTrustedContributorReview(reportInput(mock));
  assert.equal(result.conclusion, 'success');
  assert.equal(result.identityMatches, true);
  assert.equal(mock.calls.length, 2);
  assert.match(mock.calls[0].url, /repos\/JeffSandov6\/who-touched-this\/pulls\/42$/);
  assert.match(mock.calls[1].url, /repos\/JeffSandov6\/who-touched-this\/check-runs$/);
  assert.equal(mock.calls[1].body.name, TRUSTED_REVIEW_CHECK_NAME);
  assert.equal(mock.calls[1].body.head_sha, headSha);
  assert.equal(mock.calls[1].body.conclusion, 'success');
  assert.equal(mock.calls[1].body.details_url, 'https://github.com/JeffSandov6/who-touched-this/actions/runs/1234');
  assert.doesNotMatch(JSON.stringify(mock.calls[1].body), /test-read-checks-write-token/);
});

test('every failed, skipped, cancelled, or incomplete required review result is non-success', () => {
  assert.equal(reviewConclusion({ ...successResults, build: 'failure' }), 'failure');
  assert.equal(reviewConclusion({ ...successResults, preview: 'failure' }), 'failure');
  assert.equal(reviewConclusion({ ...successResults, preview: 'skipped' }), 'failure');
  assert.equal(reviewConclusion({ ...successResults, build: 'cancelled', preview: 'skipped' }), 'cancelled');
  assert.equal(reviewConclusion(successResults, false), 'failure');
  assert.throws(() => reviewConclusion({ ...successResults, handoff: 'skipped' }), /validated trusted handoff/);
});

test('a stale head receives failure only on the reviewed SHA and a new head needs a fresh cycle', async () => {
  const newHeadSha = 'c'.repeat(40);
  const staleMock = githubMock(pull({ head: { sha: newHeadSha, repo: { full_name: handoff.headRepository } } }));
  const stale = await reportTrustedContributorReview(reportInput(staleMock));
  assert.equal(stale.conclusion, 'failure');
  assert.equal(staleMock.calls[1].body.head_sha, headSha);

  const freshHandoff = { ...handoff, headSha: newHeadSha };
  const freshMock = githubMock(pull({ head: { sha: newHeadSha, repo: { full_name: handoff.headRepository } } }));
  const fresh = await reportTrustedContributorReview(reportInput(freshMock, { handoff: freshHandoff }));
  assert.equal(fresh.conclusion, 'success');
  assert.equal(freshMock.calls[1].body.head_sha, newHeadSha);
});

test('closed PR or failed identity revalidation can never report success', async () => {
  const closedMock = githubMock(pull({ state: 'closed' }));
  assert.equal((await reportTrustedContributorReview(reportInput(closedMock))).conclusion, 'failure');

  const calls = [];
  const failedRequest = async (url, options) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    if (options.method === 'POST') return { ok: true, status: 201, json: async () => ({ id: 100 }) };
    return { ok: false, status: 503, json: async () => ({}) };
  };
  const failed = await reportTrustedContributorReview(reportInput({ request: failedRequest }));
  assert.equal(failed.conclusion, 'failure');
  assert.equal(calls[1].body.head_sha, headSha);
});

test('malformed identity, job results, details URL, or missing token fail closed before posting', async () => {
  const mock = githubMock();
  await assert.rejects(reportTrustedContributorReview(reportInput(mock, { handoff: { ...handoff, headSha: 'bad' } })), /full lowercase Git SHAs/);
  await assert.rejects(reportTrustedContributorReview(reportInput(mock, { jobResults: { ...successResults, preview: 'neutral' } })), /malformed/);
  await assert.rejects(reportTrustedContributorReview(reportInput(mock, { detailsUrl: 'https://attacker.example/run/1' })), /not the expected/);
  await assert.rejects(reportTrustedContributorReview(reportInput(mock, { token: '' })), /checks-write/);
});
