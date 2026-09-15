import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { captureSnapshots, createBundlePaths, createCaptureId, renderReviewPage, startStaticServer } from '../scripts/snapshots/capture.mjs';
import { validateRevisionPair } from '../scripts/snapshots/git.mjs';
import { pngDimensions, sha256, sha256File, validatePngScreenshot } from '../scripts/snapshots/integrity.mjs';
import { SNAPSHOT_CONFIG } from '../scripts/snapshots/config.mjs';
import { buildSnapshotManifest, formatContributionNumber, verifySnapshotBundle } from '../scripts/snapshots/manifest.mjs';
import { createRouteKeyMap, mergeSnapshotRoutes } from '../scripts/snapshots/routes.mjs';

const exec = promisify(execFile);
const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test('contribution labels support founder, ordinary, and numbers above 999', () => {
  assert.equal(formatContributionNumber(0), '000');
  assert.equal(formatContributionNumber(12), '012');
  assert.equal(formatContributionNumber(1234), '1234');
  assert.throws(() => formatContributionNumber(-1));
});

test('route keys are readable and collision-safe', () => {
  const keys = createRouteKeyMap(['/', '/random', '/foo/bar', '/foo--bar', '/home']);
  assert.equal(keys['/'], 'home--8a5edab2');
  assert.equal(keys['/random'], 'random');
  assert.notEqual(keys['/foo/bar'], keys['/foo--bar']);
  assert.notEqual(keys['/'], keys['/home']);
});

test('bundle paths are deterministic and capture IDs make reruns collision-safe', () => {
  const first = createCaptureId(new Date('2026-01-02T03:04:05.000Z'), 'aaaaaaaa');
  const second = createCaptureId(new Date('2026-01-02T03:04:05.000Z'), 'bbbbbbbb');
  assert.notEqual(first, second);
  assert.match(createBundlePaths('/repo', 0, first).finalPath, /\.wtt\/snapshots\/contribution-000\//);
});

test('Git revision resolution expands SHAs and rejects identical/non-ancestor pairs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wtt-revisions-'));
  try {
    await exec('git', ['init', '-q'], { cwd: root });
    await exec('git', ['config', 'user.email', 'fixture@example.test'], { cwd: root });
    await exec('git', ['config', 'user.name', 'Fixture'], { cwd: root });
    await writeFile(join(root, 'a'), 'a'); await exec('git', ['add', '.'], { cwd: root }); await exec('git', ['commit', '-qm', 'a'], { cwd: root });
    const first = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
    await writeFile(join(root, 'b'), 'b'); await exec('git', ['add', '.'], { cwd: root }); await exec('git', ['commit', '-qm', 'b'], { cwd: root });
    const second = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
    assert.deepEqual(await validateRevisionPair(root, first.slice(0, 8), second.slice(0, 8)), { beforeSha: first, afterSha: second });
    await assert.rejects(validateRevisionPair(root, first, first), /different commits/);
    await exec('git', ['checkout', '-qb', 'other', first], { cwd: root });
    await writeFile(join(root, 'c'), 'c'); await exec('git', ['add', '.'], { cwd: root }); await exec('git', ['commit', '-qm', 'c'], { cwd: root });
    const other = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
    await assert.rejects(validateRevisionPair(root, second, other), /ancestor/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function createFixtureBundle(root, routes = ['/', '/random', '/thoughts']) {
  const routeSelection = mergeSnapshotRoutes(routes, []);
  const keys = createRouteKeyMap(routes);
  const checksums = { before: {}, after: {} };
  await mkdir(join(root, 'before'), { recursive: true });
  await mkdir(join(root, 'after'), { recursive: true });
  for (const route of routes) {
    for (const side of ['before', 'after']) {
      const path = join(root, side, `${keys[route]}.png`);
      await writeFile(path, tinyPng);
      checksums[side][route] = await sha256File(path);
    }
  }
  const manifest = buildSnapshotManifest({ contributionNumber: 0, captureId: 'fixture', capturedAt: '2026-01-01T00:00:00.000Z', beforeSha: 'a'.repeat(40), afterSha: 'b'.repeat(40), ...routeSelection, waitMs: 1500, checksums });
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await writeFile(join(root, 'index.html'), renderReviewPage(manifest));
  return manifest;
}

test('manifest is portable, records complete surface, checksums, and viewer sections', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wtt-manifest-'));
  try {
    const manifest = await createFixtureBundle(root);
    assert.equal(manifest.screenshots.length, 3);
    assert.equal(manifest.screenshots.length * 2, 6);
    assert.doesNotMatch(JSON.stringify(manifest), /\/Users\/|contactEmail|firebaseUid/);
    assert.equal((await verifySnapshotBundle(root)).captureId, 'fixture');
    const viewer = await readFile(join(root, 'index.html'), 'utf8');
    assert.equal((viewer.match(/<section>/g) ?? []).length, 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('future fourth route automatically expects eight screenshots and unchanged routes remain represented', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wtt-four-routes-'));
  try {
    const manifest = await createFixtureBundle(root, ['/', '/random', '/thoughts', '/gallery']);
    assert.equal(manifest.screenshots.length * 2, 8);
    assert.deepEqual(manifest.canonicalRoutes, ['/', '/random', '/thoughts', '/gallery']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('verification rejects changed, missing, malformed, and disagreeing screenshot data', async (t) => {
  await t.test('changed image', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wtt-changed-')); try { const manifest = await createFixtureBundle(root); await writeFile(join(root, manifest.screenshots[0].before.path), Buffer.concat([tinyPng, Buffer.from('changed')])); await assert.rejects(verifySnapshotBundle(root), /checksum/); } finally { await rm(root, { recursive: true, force: true }); }
  });
  await t.test('missing image', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wtt-missing-')); try { const manifest = await createFixtureBundle(root); await rm(join(root, manifest.screenshots[0].after.path)); await assert.rejects(verifySnapshotBundle(root), /missing/); } finally { await rm(root, { recursive: true, force: true }); }
  });
  await t.test('malformed manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wtt-malformed-')); try { await writeFile(join(root, 'manifest.json'), '{'); await assert.rejects(verifySnapshotBundle(root), /Malformed/); } finally { await rm(root, { recursive: true, force: true }); }
  });
  await t.test('route disagreement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wtt-disagree-')); try { const manifest = await createFixtureBundle(root); manifest.capturedRoutes.pop(); await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest)); await assert.rejects(verifySnapshotBundle(root), /disagree/); } finally { await rm(root, { recursive: true, force: true }); }
  });
});

test('checksum helper is deterministic', () => assert.equal(sha256(Buffer.from('snapshot')), sha256(Buffer.from('snapshot'))));

test('permanent PNG verification enforces dimensions, pixel area, byte size, and full-page consistency', () => {
  assert.deepEqual(pngDimensions(tinyPng), { width: 1, height: 1 });
  assert.deepEqual(validatePngScreenshot(tinyPng, SNAPSHOT_CONFIG, { width: 1, height: 1 }), { width: 1, height: 1 });
  assert.throws(() => validatePngScreenshot(tinyPng, SNAPSHOT_CONFIG, { width: 1, height: 2 }), /dimensions disagree/);
  assert.throws(() => validatePngScreenshot(tinyPng, { ...SNAPSHOT_CONFIG, maximumScreenshotBytes: tinyPng.length - 1 }), /exceeds/);
  const tooTall = Buffer.from(tinyPng); tooTall.writeUInt32BE(20_001, 20);
  assert.throws(() => validatePngScreenshot(tooTall, SNAPSHOT_CONFIG), /archive bounds/);
  const tooManyPixels = Buffer.from(tinyPng); tooManyPixels.writeUInt32BE(20_000, 16); tooManyPixels.writeUInt32BE(2_000, 20);
  assert.throws(() => validatePngScreenshot(tooManyPixels, SNAPSHOT_CONFIG), /archive bounds/);
});

test('bundle verification rejects a manifest above the permanent one MiB limit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wtt-large-manifest-'));
  try {
    await createFixtureBundle(root);
    const current = await readFile(join(root, 'manifest.json'), 'utf8');
    await writeFile(join(root, 'manifest.json'), `${current}${' '.repeat(1024 * 1024)}`);
    await assert.rejects(verifySnapshotBundle(root), /size limit/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('loopback preview server serves routes and closes cleanly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wtt-server-'));
  const routeDirectory = join(root, 'random');
  await mkdir(routeDirectory, { recursive: true }); await writeFile(join(routeDirectory, 'index.html'), '<h1>Random</h1>');
  const server = await startStaticServer(root);
  try { const response = await fetch(`${server.origin}/random`); assert.equal(response.status, 200); assert.match(await response.text(), /Random/); }
  finally { await server.close(); }
  await assert.rejects(fetch(`${server.origin}/random`));
  await rm(root, { recursive: true, force: true });
});

test('Playwright smoke captures six PNGs from two exact fixture revisions and cleans worktrees', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wtt-playwright-fixture-'));
  try {
    await exec('git', ['init', '-q'], { cwd: root });
    await exec('git', ['config', 'user.email', 'fixture@example.test'], { cwd: root });
    await exec('git', ['config', 'user.name', 'Fixture'], { cwd: root });
    await mkdir(join(root, 'src/platform/config'), { recursive: true });
    await writeFile(join(root, 'src/platform/config/editable-routes.json'), JSON.stringify({ schemaVersion: 1, routes: ['/', '/random', '/thoughts'] }));
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'snapshot-fixture', version: '1.0.0', type: 'module', scripts: { 'build:contributor': 'node build.mjs' } }));
    await writeFile(join(root, 'package-lock.json'), JSON.stringify({ name: 'snapshot-fixture', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'snapshot-fixture', version: '1.0.0' } } }));
    await writeFile(join(root, 'build.mjs'), `import { mkdir, readFile, writeFile } from 'node:fs/promises';
const registry = JSON.parse(await readFile('src/platform/config/editable-routes.json', 'utf8'));
const marker = await readFile('marker.txt', 'utf8');
for (const route of registry.routes) {
  const directory = route === '/' ? 'dist' : \`dist\${route}\`;
  await mkdir(directory, { recursive: true });
  await writeFile(\`\${directory}/index.html\`, \`<!doctype html><html><body><main><h1>\${route}</h1><p>\${marker}</p></main></body></html>\`);
}`);
    await writeFile(join(root, 'marker.txt'), 'BEFORE');
    await exec('git', ['add', '.'], { cwd: root });
    await exec('git', ['commit', '-qm', 'before'], { cwd: root });
    const before = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
    await writeFile(join(root, 'marker.txt'), 'AFTER');
    await exec('git', ['commit', '-qam', 'after'], { cwd: root });
    const after = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();

    const result = await captureSnapshots({ repoRoot: root, artifactRoot: '.artifacts', contributionNumber: 0, before, after, captureId: 'smoke', waitMs: 0 });
    assert.equal(result.manifest.screenshots.length * 2, 6);
    assert.deepEqual(result.manifest.canonicalRoutes, ['/', '/random', '/thoughts']);
    assert.equal((await readdir(join(result.bundlePath, 'before'))).length, 3);
    assert.equal((await readdir(join(result.bundlePath, 'after'))).length, 3);
    await verifySnapshotBundle(result.bundlePath);
    const viewer = await readFile(join(result.bundlePath, 'index.html'), 'utf8');
    assert.equal((viewer.match(/<section>/g) ?? []).length, 3);
    await assert.rejects(captureSnapshots({ repoRoot: root, artifactRoot: '.artifacts', contributionNumber: 0, before, after, captureId: 'smoke', waitMs: 0 }), /will not be overwritten/);
    let worktrees = (await exec('git', ['worktree', 'list', '--porcelain'], { cwd: root })).stdout;
    assert.equal((worktrees.match(/^worktree /gm) ?? []).length, 1);
    assert.equal(await readFile(join(root, 'marker.txt'), 'utf8'), 'AFTER');

    await writeFile(join(root, 'build.mjs'), "throw new Error('fixture build failure');\n");
    await exec('git', ['commit', '-qam', 'broken descendant'], { cwd: root });
    const broken = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
    await assert.rejects(captureSnapshots({ repoRoot: root, artifactRoot: '.artifacts', contributionNumber: 1, before: after, after: broken, captureId: 'failure', waitMs: 0 }), /build failed/);
    worktrees = (await exec('git', ['worktree', 'list', '--porcelain'], { cwd: root })).stdout;
    assert.equal((worktrees.match(/^worktree /gm) ?? []).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
