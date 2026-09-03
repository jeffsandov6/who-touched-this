import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const boundary = await readFile(new URL('../.github/workflows/contribution-boundary.yml', import.meta.url), 'utf8');
const build = await readFile(new URL('../.github/workflows/contributor-build.yml', import.meta.url), 'utf8');

test('trusted boundary workflow is base-controlled metadata-only execution', () => {
  assert.match(boundary, /pull_request_target:/);
  assert.match(boundary, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.doesNotMatch(boundary, /github\.event\.pull_request\.head/);
  assert.doesNotMatch(boundary, /npm (?:ci|install|run)/);
  assert.doesNotMatch(boundary, /\$\{\{\s*secrets\./);
  assert.match(boundary, /contents: read/);
  assert.match(boundary, /pull-requests: read/);
  assert.match(boundary, /persist-credentials: false/);
});

test('untrusted fork workflow is read-only, secretless, hosted, and bounded', () => {
  assert.match(build, /\n  pull_request:/);
  assert.doesNotMatch(build, /pull_request_target/);
  assert.match(build, /permissions:\n  contents: read/);
  assert.match(build, /runs-on: ubuntu-latest/);
  assert.match(build, /timeout-minutes: 10/);
  assert.match(build, /persist-credentials: false/);
  assert.doesNotMatch(build, /self-hosted/);
  assert.doesNotMatch(build, /\$\{\{\s*secrets\./);
});

test('untrusted fork workflow runs only validation, checks, build, and fast tests', () => {
  for (const expected of ['npm ci', 'contribution:validate', 'npm run check', 'npm run build', 'npm run test:contributor']) {
    assert.match(build, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(build, /firebase\s+(?:deploy|emulators)/);
  assert.doesNotMatch(build, /functions:(?:test|build|check)/);
  assert.doesNotMatch(build, /Resend|RESEND|GITHUB_WEBHOOK_SECRET|service.account/i);
  assert.doesNotMatch(build, /deploy/i);
});
