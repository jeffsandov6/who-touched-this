import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CANONICAL_REPOSITORY,
  classifyPullRequest,
  evaluateDependabotMaintenance,
} from '../scripts/pull-request-policy.mjs';
import { evaluateContribution } from '../scripts/contribution-validator.mjs';

const sha = (character) => character.repeat(40);

function event(overrides = {}) {
  const pullRequest = {
    number: 17,
    user: { login: 'community-user' },
    base: { ref: 'main', sha: sha('a'), repo: { full_name: CANONICAL_REPOSITORY } },
    head: { ref: 'canvas-update', sha: sha('b'), repo: { full_name: 'community-user/who-touched-this' } },
    ...overrides.pull_request,
  };
  return {
    number: 17,
    repository: { full_name: CANONICAL_REPOSITORY },
    sender: { login: pullRequest.user.login },
    ...overrides,
    pull_request: pullRequest,
  };
}

function dependabotEvent(overrides = {}) {
  return event({
    sender: { login: 'dependabot[bot]' },
    ...overrides,
    pull_request: {
      user: { login: 'dependabot[bot]' },
      base: { ref: 'main', sha: sha('a'), repo: { full_name: CANONICAL_REPOSITORY } },
      head: {
        ref: 'dependabot/npm_and_yarn/root-minor-and-patch-1234',
        sha: sha('b'),
        repo: { full_name: CANONICAL_REPOSITORY },
      },
      ...overrides.pull_request,
    },
  });
}

function change(filePath, overrides = {}) {
  const patch = filePath.endsWith('package.json')
    ? '@@ -1 +1 @@\n-    "vue": "3.5.42"\n+    "vue": "3.5.43"'
    : filePath.startsWith('.github/workflows/')
      ? '@@ -1,2 +1,2 @@\n-      # actions/checkout v6.0.2\n-      uses: actions/checkout@1111111111111111111111111111111111111111\n+      # actions/checkout v6.0.3\n+      uses: actions/checkout@2222222222222222222222222222222222222222'
      : '@@ lockfile metadata';
  return { status: 'M', paths: [filePath], targetPath: filePath, mode: '100644', size: 10, patch, ...overrides };
}

test('normal valid contributor PR is classified as contribution', () => {
  assert.equal(classifyPullRequest(event(), 'community-user'), 'contribution');
});

test('genuine Dependabot PR is classified as maintenance from trusted event identity', () => {
  assert.equal(classifyPullRequest(dependabotEvent(), 'dependabot[bot]'), 'maintenance');
});

test('ordinary user cannot authenticate with a dependabot-prefixed branch', () => {
  const input = event({ pull_request: {
    head: { ref: 'dependabot/npm_and_yarn/fake', sha: sha('b'), repo: { full_name: CANONICAL_REPOSITORY } },
  } });
  assert.equal(classifyPullRequest(input, 'community-user'), 'contribution');
});

test('fork cannot pretend to be Dependabot even with bot identity fields', () => {
  const input = dependabotEvent({ pull_request: {
    head: { ref: 'dependabot/npm_and_yarn/fake', sha: sha('b'), repo: { full_name: 'attacker/fork' } },
  } });
  assert.throws(() => classifyPullRequest(input, 'dependabot[bot]'), /identity metadata is inconsistent/);
});

test('malformed or mismatched repository metadata fails closed', () => {
  for (const input of [
    event({ repository: { full_name: 'attacker/fork' } }),
    event({ pull_request: { base: { ref: 'other', sha: sha('a'), repo: { full_name: CANONICAL_REPOSITORY } } } }),
    event({ pull_request: { base: { ref: 'main', sha: sha('a'), repo: { full_name: 'attacker/fork' } } } }),
  ]) assert.throws(() => classifyPullRequest(input, 'community-user'), /incomplete or mismatched/);
});

test('contributor protected-file changes remain outside contribution policy', () => {
  const result = evaluateContribution([change('package.json')]);
  assert.equal(result.passed, false);
  assert.match(result.failures.join('\n'), /Protected path modified/);
});

test('Dependabot maintenance permits only one configured dependency ecosystem', () => {
  assert.equal(evaluateDependabotMaintenance([change('package.json'), change('package-lock.json')]).passed, true);
  assert.equal(evaluateDependabotMaintenance([change('functions/package.json'), change('functions/package-lock.json')]).passed, true);
  assert.equal(evaluateDependabotMaintenance([change('.github/workflows/contributor-build.yml')]).passed, true);
  assert.equal(evaluateDependabotMaintenance([change('package-lock.json'), change('functions/package-lock.json')]).passed, false);
});

test('Dependabot maintenance rejects source files, renames, additions, and executable modes', () => {
  for (const candidate of [
    change('src/platform/app.ts'),
    change('package.json', { status: 'A' }),
    change('package.json', { status: 'R', paths: ['old.json', 'package.json'] }),
    change('.github/workflows/build.yml', { mode: '100755' }),
  ]) assert.equal(evaluateDependabotMaintenance([candidate]).passed, false);
});

test('Dependabot workflow and manifest patches are limited to expected update shapes', () => {
  assert.equal(evaluateDependabotMaintenance([
    change('.github/workflows/build.yml', { patch: '@@ -1 +1 @@\n-run: curl attacker.test\n+run: curl other.test' }),
  ]).passed, false);
  assert.equal(evaluateDependabotMaintenance([
    change('.github/workflows/build.yml', { patch: '@@ -1 +1 @@\n-uses: actions/checkout@1111111111111111111111111111111111111111\n+uses: attacker/action@2222222222222222222222222222222222222222' }),
  ]).passed, false);
  assert.equal(evaluateDependabotMaintenance([
    change('package.json', { patch: '@@ -1 +1 @@\n-  "scripts": {}\n+  "scripts": {"postinstall":"bad"}' }),
  ]).passed, false);
});
