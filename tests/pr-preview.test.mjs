import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { chromium } from 'playwright';
import { buildPullRequestPreviewManifest, capturePullRequestPreview, renderPullRequestReviewPage, selectCanonicalPreviewRoutes, validatePullRequestPreviewIdentity, validateStaticPreviewTree, verifyPullRequestPreviewBundle } from '../scripts/pr-review/preview.mjs';
import { captureRevision } from '../scripts/snapshots/capture.mjs';
import { sha256File } from '../scripts/snapshots/integrity.mjs';

const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const baseSha = 'a'.repeat(40);
const headSha = 'b'.repeat(40);
const exec = promisify(execFile);

async function fixtureBundle(root, routes = ['/', '/random', '/thoughts']) {
  const keys = Object.fromEntries(buildPullRequestPreviewManifest({ pullRequestNumber: 27, baseSha, headSha, routes, capturedAt: '2026-01-01T00:00:00.000Z', waitMs: 1500, checksums: { before: {}, proposedAfter: {} } }).screenshots.map((record) => [record.route, record.key]));
  const checksums = { before: {}, proposedAfter: {} };
  for (const directory of ['before', 'proposed-after']) await mkdir(join(root, directory), { recursive: true });
  for (const route of routes) {
    for (const [side, directory] of [['before', 'before'], ['proposedAfter', 'proposed-after']]) {
      const relative = `${directory}/${keys[route]}/tile-000.png`;
      await mkdir(join(root, directory, keys[route]), { recursive: true });
      await writeFile(join(root, relative), tinyPng);
      checksums[side][route] = { width: 1, height: 1, tiles: [{ index: 0, y: 0, width: 1, height: 1, path: relative, sha256: await sha256File(join(root, relative)), bytes: tinyPng.length }] };
    }
  }
  const manifest = buildPullRequestPreviewManifest({ pullRequestNumber: 27, baseSha, headSha, routes, capturedAt: '2026-01-01T00:00:00.000Z', waitMs: 1500, checksums });
  await writeFile(join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(root, 'index.html'), renderPullRequestReviewPage(manifest));
  return manifest;
}

test('preview manifest distinguishes exact base and proposed head across every canonical route', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wtt-pr-preview-'));
  try {
    const manifest = await fixtureBundle(root);
    assert.equal(manifest.git.base, baseSha);
    assert.equal(manifest.git.proposedHead, headSha);
    assert.deepEqual(manifest.canonicalRoutes, ['/', '/random', '/thoughts']);
    const routeSideRecords = manifest.screenshots.flatMap(() => ['before', 'proposed-after']).length;
    assert.equal(routeSideRecords, 6);
    assert.deepEqual(await verifyPullRequestPreviewBundle(root), manifest);
    const viewer = await readFile(join(root, 'index.html'), 'utf8');
    assert.equal((viewer.match(/<section>/g) ?? []).length, 3);
    assert.match(viewer, /PROPOSED AFTER/);
    assert.match(viewer, /not a permanent History snapshot/);
    assert.match(viewer, /\.page-stack img\{display:block;width:100%;height:auto;margin:0;border:0\}/);
    assert.doesNotMatch(viewer, /tile-000\.png"[^>]*><\/div>\s+<img/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('canonical route selection is deterministic and cannot be replaced or changed by the PR', () => {
  const routes = ['/', '/random', '/thoughts'];
  assert.deepEqual(selectCanonicalPreviewRoutes(routes, [...routes]), routes);
  assert.throws(() => selectCanonicalPreviewRoutes(routes, ['/random']), /changed the protected/);
  assert.throws(() => selectCanonicalPreviewRoutes([], []), /malformed/);
  assert.throws(() => selectCanonicalPreviewRoutes(['/admin'], ['/admin']), /Protected operational/);
  const future = ['/', '/random', '/thoughts', '/gallery'];
  const routeSideRecords = selectCanonicalPreviewRoutes(future, [...future]).flatMap(() => ['before', 'proposed-after']).length;
  assert.equal(routeSideRecords, 8);
});

test('malformed preview identities fail closed', () => {
  assert.throws(() => validatePullRequestPreviewIdentity({ pullRequestNumber: 0, baseSha, headSha }), /positive integer/);
  assert.throws(() => validatePullRequestPreviewIdentity({ pullRequestNumber: 1, baseSha: 'short', headSha }), /full lowercase/);
  assert.throws(() => validatePullRequestPreviewIdentity({ pullRequestNumber: 1, baseSha, headSha: baseSha }), /differ/);
});

test('preview verification fails for modified, missing, and malformed artifacts', async (t) => {
  await t.test('modified screenshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wtt-pr-modified-'));
    try { const manifest = await fixtureBundle(root); await writeFile(join(root, manifest.screenshots[0].before.tiles[0].path), Buffer.concat([tinyPng, Buffer.from('changed')])); await assert.rejects(verifyPullRequestPreviewBundle(root), /byte length|checksum/); }
    finally { await rm(root, { recursive: true, force: true }); }
  });
  await t.test('missing screenshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wtt-pr-missing-'));
    try { const manifest = await fixtureBundle(root); await rm(join(root, manifest.screenshots[0].proposedAfter.tiles[0].path)); await assert.rejects(verifyPullRequestPreviewBundle(root), /missing/); }
    finally { await rm(root, { recursive: true, force: true }); }
  });
  await t.test('malformed manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wtt-pr-malformed-'));
    try { await writeFile(join(root, 'manifest.json'), '{'); await assert.rejects(verifyPullRequestPreviewBundle(root), /missing or malformed/); }
    finally { await rm(root, { recursive: true, force: true }); }
  });
});

test('PR preview executes client JavaScript while blocking external requests', async () => {
  let externalRequests = 0;
  const external = createServer((_request, response) => {
    externalRequests += 1;
    response.writeHead(200, { 'content-type': 'text/plain' }).end('external');
  });
  await new Promise((resolve) => external.listen(0, '127.0.0.1', resolve));
  const address = external.address();
  const root = await mkdtemp(join(tmpdir(), 'wtt-pr-network-'));
  let browser;
  try {
    await writeFile(join(root, 'index.html'), `<!doctype html><main>Preview</main><script>document.body.innerHTML = '<div style="height:7201px">javascript executed</div>'; fetch('http://127.0.0.1:${address.port}/should-not-run').catch(() => {});</script>`);
    await mkdir(join(root, 'shots'), { recursive: true });
    browser = await chromium.launch({ headless: true });
    const checksums = await captureRevision({
      browser,
      side: 'shots',
      sha: baseSha,
      routes: ['/'],
      routeKeys: { '/': 'home' },
      distPath: root,
      outputPath: root,
      waitMs: 50,
      blockExternalRequests: true,
    });
    assert.match(checksums['/'].tiles[0].sha256, /^[0-9a-f]{64}$/);
    assert.ok(checksums['/'].height > 7_201);
    assert.equal(externalRequests, 0);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => external.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test('preview engine builds exact base/head checkouts and captures all canonical routes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wtt-pr-engine-'));
  const source = join(root, 'source');
  const baseCheckout = join(root, 'base');
  const headCheckout = join(root, 'head');
  const output = join(root, 'artifact');
  try {
    await mkdir(join(source, 'src/platform/config'), { recursive: true });
    await exec('git', ['init', '-q'], { cwd: source });
    await exec('git', ['config', 'user.email', 'fixture@example.test'], { cwd: source });
    await exec('git', ['config', 'user.name', 'Fixture'], { cwd: source });
    await writeFile(join(source, 'src/platform/config/editable-routes.json'), JSON.stringify({ schemaVersion: 1, routes: ['/', '/random', '/thoughts'] }));
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: 'pr-preview-fixture', version: '1.0.0', type: 'module', scripts: { 'build:contributor': 'node build.mjs' } }));
    await writeFile(join(source, 'package-lock.json'), JSON.stringify({ name: 'pr-preview-fixture', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'pr-preview-fixture', version: '1.0.0' } } }));
    await writeFile(join(source, 'build.mjs'), `import { mkdir, readFile, writeFile } from 'node:fs/promises';
const routes = JSON.parse(await readFile('src/platform/config/editable-routes.json', 'utf8')).routes;
const marker = await readFile('marker.txt', 'utf8');
for (const route of routes) { const directory = route === '/' ? 'dist' : \`dist\${route}\`; await mkdir(directory, { recursive: true }); await writeFile(\`\${directory}/index.html\`, \`<!doctype html><main><h1>\${route}</h1><p>\${marker}</p></main>\`); }`);
    await writeFile(join(source, 'marker.txt'), 'BASE');
    await exec('git', ['add', '.'], { cwd: source });
    await exec('git', ['commit', '-qm', 'base'], { cwd: source });
    const actualBaseSha = (await exec('git', ['rev-parse', 'HEAD'], { cwd: source })).stdout.trim();
    await writeFile(join(source, 'marker.txt'), 'PROPOSED');
    await exec('git', ['commit', '-qam', 'proposed'], { cwd: source });
    const actualHeadSha = (await exec('git', ['rev-parse', 'HEAD'], { cwd: source })).stdout.trim();
    await exec('git', ['clone', '-q', source, baseCheckout]);
    await exec('git', ['checkout', '-q', actualBaseSha], { cwd: baseCheckout });
    await exec('git', ['clone', '-q', source, headCheckout]);
    await exec('npm', ['ci'], { cwd: baseCheckout });
    await exec('npm', ['run', 'build:contributor'], { cwd: baseCheckout });
    await exec('npm', ['ci'], { cwd: headCheckout });
    await exec('npm', ['run', 'build:contributor'], { cwd: headCheckout });
    const options = { pullRequestNumber: 27, baseRepository: baseCheckout, baseDistPath: join(baseCheckout, 'dist'), proposedDistPath: join(headCheckout, 'dist'), baseSha: actualBaseSha, headSha: actualHeadSha, outputPath: output, waitMs: 0 };
    const result = await capturePullRequestPreview(options);
    const routeSideRecords = result.manifest.screenshots.flatMap(() => ['before', 'proposed-after']).length;
    assert.equal(routeSideRecords, 6);
    assert.deepEqual(result.manifest.canonicalRoutes, ['/', '/random', '/thoughts']);
    assert.equal(result.manifest.capture.externalNetwork, 'container-and-browser-blocked');
    assert.equal(result.manifest.capture.tileHeight, 3_600);
    await verifyPullRequestPreviewBundle(output);
    await assert.rejects(capturePullRequestPreview(options), /will not be overwritten/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('downloaded proposed static trees reject symlinks and bounded-limit violations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wtt-pr-static-tree-'));
  try {
    await writeFile(join(root, 'index.html'), '<main>safe</main>');
    assert.deepEqual(await validateStaticPreviewTree(root), { files: 1, bytes: 17 });
    await symlink('index.html', join(root, 'linked.html'));
    await assert.rejects(validateStaticPreviewTree(root), /non-regular/);
    await rm(join(root, 'linked.html'));
    await assert.rejects(validateStaticPreviewTree(root, { maxFiles: 0, maxBytes: 100 }), /bounded artifact limits/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
