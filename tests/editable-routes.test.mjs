import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { SNAPSHOT_CONFIG } from '../scripts/snapshots/config.mjs';
import { readHistoricalRouteRegistry } from '../scripts/snapshots/git.mjs';
import { mergeSnapshotRoutes, normalizeSnapshotRoute, validateCanonicalRouteRegistry } from '../scripts/snapshots/routes.mjs';

const exec = promisify(execFile);
const currentRegistry = JSON.parse(await readFile(SNAPSHOT_CONFIG.routeRegistryPath, 'utf8'));

test('canonical editable registry starts with the three normalized unique routes', () => {
  assert.deepEqual(validateCanonicalRouteRegistry(currentRegistry), ['/', '/random', '/thoughts']);
});

test('canonical route registry rejects protected, external, and duplicate routes', () => {
  assert.throws(() => validateCanonicalRouteRegistry({ schemaVersion: 1, routes: ['/', '/admin'] }), /Protected/);
  assert.throws(() => validateCanonicalRouteRegistry({ schemaVersion: 1, routes: ['/', 'https:\/\/example.com'] }), /same-origin/);
  assert.throws(() => validateCanonicalRouteRegistry({ schemaVersion: 1, routes: ['/', '/random', '/random/'] }), /duplicate/);
});

test('normal route validation handles roots, nested routes, and hostile values', () => {
  assert.equal(normalizeSnapshotRoute('/'), '/');
  assert.equal(normalizeSnapshotRoute('/some/future/page/'), '/some/future/page');
  for (const route of ['//example.com', 'javascript:alert(1)', 'file:///tmp/a', 'data:text/plain,a', '/api/private']) {
    assert.throws(() => normalizeSnapshotRoute(route));
  }
});

test('additional routes are additive and safely deduplicated', () => {
  const result = mergeSnapshotRoutes(['/', '/random', '/thoughts'], ['/random/', '/special', '/special/']);
  assert.deepEqual(result.canonicalRoutes, ['/', '/random', '/thoughts']);
  assert.deepEqual(result.additionalRoutes, ['/special']);
  assert.deepEqual(result.capturedRoutes, ['/', '/random', '/thoughts', '/special']);
});

test('historical route resolution uses the AFTER commit, not the current checkout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wtt-route-history-'));
  try {
    await exec('git', ['init', '-q'], { cwd: root });
    await exec('git', ['config', 'user.email', 'fixture@example.test'], { cwd: root });
    await exec('git', ['config', 'user.name', 'Fixture'], { cwd: root });
    const registryPath = join(root, SNAPSHOT_CONFIG.routeRegistryPath);
    await mkdir(join(registryPath, '..'), { recursive: true });
    await writeFile(registryPath, JSON.stringify({ schemaVersion: 1, routes: ['/', '/random', '/thoughts'] }));
    await exec('git', ['add', '.'], { cwd: root });
    await exec('git', ['commit', '-qm', 'three routes'], { cwd: root });
    const commitA = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
    await writeFile(registryPath, JSON.stringify({ schemaVersion: 1, routes: ['/', '/random', '/thoughts', '/gallery'] }));
    await exec('git', ['commit', '-qam', 'four routes'], { cwd: root });
    const commitB = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
    await writeFile(registryPath, JSON.stringify({ schemaVersion: 1, routes: ['/wrong-current-route'] }));

    assert.deepEqual(await readHistoricalRouteRegistry(root, commitA), ['/', '/random', '/thoughts']);
    assert.deepEqual(await readHistoricalRouteRegistry(root, commitB), ['/', '/random', '/thoughts', '/gallery']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

