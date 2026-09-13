import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import packageJson from '../package.json' with { type: 'json' };
import {
  CANONICAL_HTTPS_REMOTE,
  CANONICAL_REPOSITORY,
  CANONICAL_SSH_REMOTE,
  classifyOrigin,
  parseGitHubRemote,
  runContributorSetup,
  validateRuntimeVersions,
} from '../scripts/contributor/setup.mjs';

const exec = promisify(execFile);

async function fixture(origin = 'https://github.com/alice/who-touched-this.git') {
  const root = await mkdtemp(join(tmpdir(), 'wtt-contributor-setup-'));
  await exec('git', ['init', '-q', '-b', 'main'], { cwd: root });
  await exec('git', ['remote', 'add', 'origin', origin], { cwd: root });
  await writeFile(join(root, 'package.json'), JSON.stringify({ engines: packageJson.engines }));
  await writeFile(join(root, '.nvmrc'), '22\n');
  return root;
}

const safeOptions = { install: false, nodeVersion: 'v22.12.0', npmVersion: '10.0.0', output() {} };

test('GitHub remote parsing distinguishes a contributor fork from canonical and unrelated origins', () => {
  assert.equal(classifyOrigin('https://github.com/alice/who-touched-this.git').kind, 'fork');
  assert.equal(classifyOrigin('git@github.com:alice/who-touched-this.git').kind, 'fork');
  assert.equal(classifyOrigin(CANONICAL_HTTPS_REMOTE).kind, 'canonical');
  assert.equal(classifyOrigin('https://github.com/alice/something-else.git').kind, 'unrelated');
  assert.equal(classifyOrigin('https://example.com/alice/who-touched-this.git').kind, 'invalid');
  assert.equal(parseGitHubRemote('ssh://git@github.com/JeffSandov6/who-touched-this.git')?.repository, CANONICAL_REPOSITORY);
});

test('setup refuses a canonical origin without changing remotes', async () => {
  const root = await fixture(CANONICAL_SSH_REMOTE);
  try {
    await assert.rejects(runContributorSetup({ cwd: root, ...safeOptions }), /clone their own fork/);
    await assert.rejects(exec('git', ['remote', 'get-url', 'upstream'], { cwd: root }));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('setup refuses an unexpected upstream instead of replacing it', async () => {
  const root = await fixture();
  try {
    const unexpected = 'https://github.com/someone/another-project.git';
    await exec('git', ['remote', 'add', 'upstream', unexpected], { cwd: root });
    await assert.rejects(runContributorSetup({ cwd: root, ...safeOptions }), /was not replaced/);
    assert.equal((await exec('git', ['remote', 'get-url', 'upstream'], { cwd: root })).stdout.trim(), unexpected);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('setup adds canonical upstream, preserves transport, and reruns idempotently', async () => {
  for (const [origin, expected] of [
    ['https://github.com/alice/who-touched-this.git', CANONICAL_HTTPS_REMOTE],
    ['git@github.com:alice/who-touched-this.git', CANONICAL_SSH_REMOTE],
  ]) {
    const root = await fixture(origin);
    try {
      await runContributorSetup({ cwd: root, ...safeOptions });
      await runContributorSetup({ cwd: root, ...safeOptions });
      assert.equal((await exec('git', ['remote', 'get-url', 'upstream'], { cwd: root })).stdout.trim(), expected);
      assert.deepEqual((await exec('git', ['remote'], { cwd: root })).stdout.trim().split('\n').sort(), ['origin', 'upstream']);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test('setup does not alter dirty worktree content or perform branch/reset/push operations', async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, 'my-work.txt'), 'keep me\n');
    await runContributorSetup({ cwd: root, ...safeOptions });
    assert.equal(await readFile(join(root, 'my-work.txt'), 'utf8'), 'keep me\n');
    assert.match((await exec('git', ['status', '--porcelain'], { cwd: root })).stdout, /my-work\.txt/);
    assert.equal((await exec('git', ['branch', '--show-current'], { cwd: root })).stdout.trim(), 'main');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('runtime validation follows package.json engines and the Node 22 nvm expectation', () => {
  const valid = { engines: packageJson.engines, nvmrc: '22' };
  assert.equal(validateRuntimeVersions({ ...valid, nodeVersion: 'v22.12.0', npmVersion: '9.6.5' }), true);
  assert.equal(validateRuntimeVersions({ ...valid, nodeVersion: 'v24.1.0', npmVersion: '11.0.0' }), true);
  assert.throws(() => validateRuntimeVersions({ ...valid, nodeVersion: 'v22.11.0', npmVersion: '10.0.0' }), /22\.12\.0/);
  assert.throws(() => validateRuntimeVersions({ ...valid, nodeVersion: 'v22.12.0', npmVersion: '9.6.4' }), /9\.6\.5/);
  assert.throws(() => validateRuntimeVersions({ ...valid, nvmrc: '20', nodeVersion: 'v22.12.0', npmVersion: '10.0.0' }), /disagree/);
});

test('setup invokes only npm ci when installation is requested', async () => {
  const root = await fixture();
  const calls = [];
  try {
    await runContributorSetup({
      cwd: root,
      install: true,
      nodeVersion: 'v22.12.0',
      npmVersion: '10.0.0',
      output() {},
      runCommand: async (command, args, options) => {
        calls.push({ command, args, cwd: options.cwd });
        return { stdout: '' };
      },
    });
    assert.deepEqual(calls, [{ command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['ci'], cwd: await realpath(root) }]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('contributor setup and documentation reference only real secretless contributor scripts', async () => {
  const setupSource = await readFile(new URL('../scripts/contributor/setup.mjs', import.meta.url), 'utf8');
  const cliSource = await readFile(new URL('../scripts/contributor-setup.mjs', import.meta.url), 'utf8');
  const contributing = await readFile(new URL('../CONTRIBUTING.md', import.meta.url), 'utf8');
  for (const match of contributing.matchAll(/npm run ([a-z0-9:-]+)/gi)) {
    assert.ok(packageJson.scripts[match[1]], `documented npm script must exist: ${match[1]}`);
  }
  assert.doesNotMatch(`${setupSource}\n${cliSource}`, /firebase|resend|webhook|deploy|push|reset|checkout|secret|token/i);
});

test('contributor docs preserve fork direction, zero-secret setup, and public History expectations', async () => {
  const [contributing, readme, template, envExample] = await Promise.all([
    readFile(new URL('../CONTRIBUTING.md', import.meta.url), 'utf8'),
    readFile(new URL('../README.md', import.meta.url), 'utf8'),
    readFile(new URL('../.github/pull_request_template.md', import.meta.url), 'utf8'),
    readFile(new URL('../.env.example', import.meta.url), 'utf8'),
  ]);
  assert.match(contributing, /FROM:[\s\S]*YOUR_GITHUB_USERNAME\/who-touched-this[\s\S]*INTO:[\s\S]*JeffSandov6\/who-touched-this : main/);
  assert.match(contributing, /npm run dev:contributor/);
  assert.match(contributing, /requires no `\.env`/);
  assert.match(contributing, /one ordinary\s+contribution per season/);
  assert.match(readme, /\[CONTRIBUTING\.md\]\(CONTRIBUTING\.md\)/);
  assert.match(template, /public History summary/);
  assert.match(template, /one ordinary contribution for this season/);
  assert.match(template, /non-draft/);
  assert.match(envExample, /Contributors should not copy this file/);
});
