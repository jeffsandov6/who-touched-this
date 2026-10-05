import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { createReviewHandoffFromPullRequestEvent, validateReviewHandoff, verifyReviewHandoff } from '../scripts/pr-review/handoff.mjs';
import { hostileContainerArguments, HOSTILE_NODE_IMAGE, REVIEW_LIMITS } from '../scripts/pr-review/policy.mjs';
import { assertTrustedManifests, createTrustedWorkspace, overlayContributorCanvas, sanitizeStaticArtifact, validateOverlayPath } from '../scripts/pr-review/workspace.mjs';
import { validateScreenshotDimensions } from '../scripts/snapshots/capture.mjs';

const exec = promisify(execFile);
const baseSha = 'a'.repeat(40);
const headSha = 'b'.repeat(40);
const event = {
  action: 'synchronize', number: 27, repository: { full_name: 'jeffsandov6/who-touched-this' },
  pull_request: {
    number: 27, state: 'open',
    base: { sha: baseSha, repo: { full_name: 'jeffsandov6/who-touched-this' } },
    head: { sha: headSha, repo: { full_name: 'attacker/who-touched-this' } },
  },
};

test('trusted handoff contains only bounded event-derived identity', () => {
  assert.deepEqual(createReviewHandoffFromPullRequestEvent(event), {
    schemaVersion: 1, pullRequestNumber: 27, baseRepository: 'jeffsandov6/who-touched-this', baseSha,
    headRepository: 'attacker/who-touched-this', headSha,
  });
  assert.throws(() => validateReviewHandoff({ ...createReviewHandoffFromPullRequestEvent(event), extra: true }), /unexpected/);
});

test('workflow handoff requires exact successful run and current PR identity', async () => {
  const handoff = createReviewHandoffFromPullRequestEvent(event);
  const workflowRunEvent = { workflow_run: { id: 99, name: 'Contribution boundary', event: 'pull_request_target', conclusion: 'success', repository: { full_name: handoff.baseRepository }, pull_requests: [{ number: 27 }] } };
  const request = async () => ({ ok: true, json: async () => event.pull_request });
  assert.deepEqual(await verifyReviewHandoff({ handoff, workflowRunEvent, token: 'read-token', request }), handoff);
  await assert.rejects(verifyReviewHandoff({ handoff: { ...handoff, baseSha: 'c'.repeat(40) }, workflowRunEvent, token: 'read-token', request }), /stale or disagrees/);
  await assert.rejects(verifyReviewHandoff({ handoff: { ...handoff, headSha: 'c'.repeat(40) }, workflowRunEvent, token: 'read-token', request }), /stale or disagrees/);
  await assert.rejects(verifyReviewHandoff({ handoff, workflowRunEvent: { workflow_run: { ...workflowRunEvent.workflow_run, conclusion: 'failure' } }, token: 'read-token', request }), /successful trusted/);
  await assert.rejects(verifyReviewHandoff({ handoff, workflowRunEvent, token: 'read-token', request: async () => ({ ok: true, json: async () => ({ ...event.pull_request, state: 'closed' }) }) }), /no longer open/);
  assert.deepEqual(await verifyReviewHandoff({ handoff, workflowRunEvent: { workflow_run: { ...workflowRunEvent.workflow_run, pull_requests: [] } }, token: 'read-token', request }), handoff);
  await assert.rejects(verifyReviewHandoff({ handoff, workflowRunEvent: { workflow_run: { ...workflowRunEvent.workflow_run, pull_requests: [{ number: 28 }] } }, token: 'read-token', request }), /association disagrees/);
});

async function gitFixture() {
  const root = await mkdtemp(join(tmpdir(), 'wtt-overlay-'));
  await exec('git', ['init', '-q'], { cwd: root });
  await exec('git', ['config', 'user.email', 'fixture@example.test'], { cwd: root });
  await exec('git', ['config', 'user.name', 'Fixture'], { cwd: root });
  await mkdir(join(root, 'src/canvas'), { recursive: true });
  await mkdir(join(root, 'src/platform'), { recursive: true });
  await writeFile(join(root, 'package.json'), '{"name":"trusted"}\n');
  await writeFile(join(root, 'package-lock.json'), '{"name":"trusted","lockfileVersion":3,"packages":{}}\n');
  await writeFile(join(root, 'src/canvas/View.tsx'), 'export const marker = "base";\n');
  await writeFile(join(root, 'src/platform/protected.ts'), 'export const protectedValue = "trusted";\n');
  await exec('git', ['add', '.'], { cwd: root });
  await exec('git', ['commit', '-qm', 'base'], { cwd: root });
  const base = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  return { root, base };
}

test('proposed workspace keeps base infrastructure and overlays only exact head canvas blobs', async () => {
  const fixture = await gitFixture();
  const trusted = `${fixture.root}-trusted`;
  const proposed = `${fixture.root}-proposed`;
  try {
    await exec('git', ['clone', '-q', fixture.root, trusted]);
    await writeFile(join(fixture.root, 'src/canvas/View.tsx'), 'export const marker = "head";\n');
    await writeFile(join(fixture.root, 'src/platform/protected.ts'), 'export const protectedValue = "attacker";\n');
    await exec('git', ['commit', '-qam', 'head'], { cwd: fixture.root });
    const head = (await exec('git', ['rev-parse', 'HEAD'], { cwd: fixture.root })).stdout.trim();
    await createTrustedWorkspace({ trustedRoot: trusted, outputRoot: proposed });
    await overlayContributorCanvas({ workspaceRoot: proposed, headRepository: fixture.root, headSha: head });
    await assertTrustedManifests(trusted, proposed);
    assert.match(await readFile(join(proposed, 'src/canvas/View.tsx'), 'utf8'), /head/);
    assert.match(await readFile(join(proposed, 'src/platform/protected.ts'), 'utf8'), /trusted/);
  } finally {
    await Promise.all([fixture.root, trusted, proposed].map((path) => rm(path, { recursive: true, force: true })));
  }
});

test('canvas overlay rejects symlink and gitlink modes', async () => {
  const fixture = await gitFixture();
  const trusted = `${fixture.root}-trusted`;
  const proposed = `${fixture.root}-proposed`;
  try {
    await exec('git', ['clone', '-q', fixture.root, trusted]);
    await symlink('../../package.json', join(fixture.root, 'src/canvas/link.ts'));
    await exec('git', ['add', 'src/canvas/link.ts'], { cwd: fixture.root });
    await exec('git', ['commit', '-qm', 'symlink'], { cwd: fixture.root });
    const head = (await exec('git', ['rev-parse', 'HEAD'], { cwd: fixture.root })).stdout.trim();
    await createTrustedWorkspace({ trustedRoot: trusted, outputRoot: proposed });
    await assert.rejects(overlayContributorCanvas({ workspaceRoot: proposed, headRepository: fixture.root, headSha: head }), /symbolic link/);
    await exec('git', ['rm', '-q', 'src/canvas/link.ts'], { cwd: fixture.root });
    await exec('git', ['update-index', '--add', '--cacheinfo', `160000,${fixture.base},src/canvas/module`], { cwd: fixture.root });
    await exec('git', ['commit', '-qm', 'gitlink'], { cwd: fixture.root });
    const gitlinkHead = (await exec('git', ['rev-parse', 'HEAD'], { cwd: fixture.root })).stdout.trim();
    await assert.rejects(overlayContributorCanvas({ workspaceRoot: proposed, headRepository: fixture.root, headSha: gitlinkHead }), /gitlink/);
  } finally {
    await Promise.all([fixture.root, trusted, proposed].map((path) => rm(path, { recursive: true, force: true })));
  }
});

test('overlay path policy rejects traversal, absolute, and non-canvas paths', () => {
  assert.equal(validateOverlayPath('src/canvas/pages/Home.tsx'), 'src/canvas/pages/Home.tsx');
  for (const path of ['../src/canvas/x.ts', '/src/canvas/x.ts', 'src/canvas/../platform/x.ts', 'src/platform/x.ts', 'src\\canvas\\x.ts']) {
    assert.throws(() => validateOverlayPath(path), /Unsafe overlay path/);
  }
});

test('artifact sanitizer copies regular bounded files and rejects links and limits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wtt-artifact-'));
  try {
    const source = join(root, 'source');
    await mkdir(source);
    await mkdir(join(source, 'nested'));
    await writeFile(join(source, 'index.html'), '<main>safe</main>');
    await writeFile(join(source, 'nested/app.js'), 'ok');
    assert.deepEqual(await sanitizeStaticArtifact(source, join(root, 'clean')), { files: 2, bytes: 19 });
    await symlink('index.html', join(source, 'link.html'));
    await assert.rejects(sanitizeStaticArtifact(source, join(root, 'links')), /non-regular/);
    await rm(join(source, 'link.html'));
    await link(join(source, 'index.html'), join(source, 'hard.html'));
    await assert.rejects(sanitizeStaticArtifact(source, join(root, 'hardlinks')), /non-regular/);
    await rm(join(source, 'hard.html'));
    await exec('mkfifo', [join(source, 'pipe')]);
    await assert.rejects(sanitizeStaticArtifact(source, join(root, 'fifo')), /non-regular/);
    await rm(join(source, 'pipe'));
    await assert.rejects(sanitizeStaticArtifact(source, join(root, 'limited'), { ...REVIEW_LIMITS, maxArtifactFileBytes: 1 }), /file exceeds/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('sandbox arguments disable network, tokens, privilege, and bound resources', () => {
  const args = hostileContainerArguments({ image: HOSTILE_NODE_IMAGE, workspace: '/tmp/workspace', timeoutSeconds: 60, command: ['node', 'build.mjs'] });
  const joined = args.join(' ');
  for (const expected of ['--network none', '--read-only', '--cap-drop ALL', 'no-new-privileges', '--memory 4g', '--memory-swap 4g', '--cpus 2', '--pids-limit 256', '--ulimit fsize=26214400:26214400', '--user 1001:1001', '--rm']) assert.match(joined, new RegExp(expected));
  assert.doesNotMatch(joined, /GITHUB_TOKEN|ACTIONS_RUNTIME_TOKEN|docker\.sock|RESEND|FIREBASE/);
  assert.match(HOSTILE_NODE_IMAGE, /@sha256:[0-9a-f]{64}$/);
});

test('screenshot dimensions calculate tiles and enforce route bounds', () => {
  assert.deepEqual(validateScreenshotDimensions({ width: 1440, height: 900 }), { width: 1440, height: 900, pixels: 1_296_000, tileCount: 1 });
  assert.deepEqual(validateScreenshotDimensions({ width: 1440, height: 7_201 }).tileCount, 3);
  assert.throws(() => validateScreenshotDimensions({ width: 1440, height: 230_401 }), /exceeds/);
  assert.throws(() => validateScreenshotDimensions({ width: 2_881, height: 2_000 }), /exceeds/);
});
