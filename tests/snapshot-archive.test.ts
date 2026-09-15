import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  isAllowedPublicHistorySnapshotPath,
  snapshotArchiveObjectPath,
  snapshotArchivePrefix,
  validateSelectedSnapshotBundle,
} from '../src/platform/snapshots/archive.ts';
import { validateSnapshotManifest } from '../src/platform/snapshots/schema.ts';
import {
  historicalRouteLabel,
  parsePublicContributionSnapshot,
  snapshotHistorySummary,
  snapshotImageAlt,
} from '../src/platform/snapshots/public.ts';

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const checksum = createHash('sha256').update(png).digest('hex');
const captureId = '2026-01-01T00-00-00-000Z--abcdef01';
const timestamp = { toDate: () => new Date('2026-01-02T00:00:00Z') };

function manifest(routes = ['/']) {
  return {
    schemaVersion: 1, contributionNumber: 42, contributionLabel: '042', captureId,
    capturedAt: '2026-01-01T00:00:00.000Z',
    git: { before: 'a'.repeat(40), after: 'b'.repeat(40) },
    routeRegistry: { path: 'src/platform/config/editable-routes.json', revision: 'b'.repeat(40) },
    canonicalRoutes: routes, additionalRoutes: [], capturedRoutes: routes,
    capture: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, fullPage: true, format: 'png', locale: 'en-US', timezoneId: 'UTC', waitMs: 1500 },
    screenshots: routes.map((route, index) => {
      const key = index === 0 ? 'home' : `route-${index}`;
      return { route, key, before: { path: `before/${key}.png`, sha256: checksum }, after: { path: `after/${key}.png`, sha256: checksum } };
    }),
  };
}

function selectedFile(contents: BlobPart[], name: string, type: string, relativePath: string): File {
  const file = new File(contents, name, { type });
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath, configurable: true });
  return file;
}

function filesFor(value = manifest()) {
  const files = [selectedFile([JSON.stringify(value)], 'manifest.json', 'application/json', `${captureId}/manifest.json`)];
  for (const screenshot of value.screenshots) {
    files.push(selectedFile([png], `${screenshot.key}.png`, 'image/png', `${captureId}/${screenshot.before.path}`));
    files.push(selectedFile([png], `${screenshot.key}.png`, 'image/png', `${captureId}/${screenshot.after.path}`));
  }
  return files;
}

test('browser importer validates a complete reviewed bundle and checksums', async () => {
  const bundle = await validateSelectedSnapshotBundle(filesFor());
  assert.equal(bundle.manifest.contributionNumber, 42);
  assert.equal(bundle.validChecksums, 2);
  assert.equal(bundle.screenshots.size, 2);
});

test('browser importer rejects missing, changed, duplicate, unsafe, and mismatched files', async () => {
  await assert.rejects(validateSelectedSnapshotBundle(filesFor().slice(0, -1)), /missing/);
  const changed = filesFor();
  changed[1] = selectedFile([Buffer.concat([png, Buffer.from([9])])], 'home.png', 'image/png', `${captureId}/before/home.png`);
  await assert.rejects(validateSelectedSnapshotBundle(changed), /checksum/);
  await assert.rejects(validateSelectedSnapshotBundle([...filesFor(), filesFor()[1]]), /duplicate/);
  const unsafe = filesFor();
  Object.defineProperty(unsafe[1], 'webkitRelativePath', { value: `${captureId}/../before/home.png`, configurable: true });
  await assert.rejects(validateSelectedSnapshotBundle(unsafe), /unsafe/);
  const wrong = manifest(); wrong.captureId = 'different';
  await assert.rejects(validateSelectedSnapshotBundle(filesFor(wrong)), /capture id/);
  const oversized = filesFor();
  Object.defineProperty(oversized[1], 'size', { value: 20 * 1024 * 1024 + 1 });
  await assert.rejects(validateSelectedSnapshotBundle(oversized), /allowed png/);
});

test('manifest schema rejects unsupported schema, duplicate routes, and traversal paths', () => {
  assert.throws(() => validateSnapshotManifest({ ...manifest(), schemaVersion: 2 }), /unsupported/);
  assert.throws(() => validateSnapshotManifest(manifest(['/', '/'])), /duplicate/);
  const traversal = manifest(); traversal.screenshots[0].before.path = '../home.png';
  assert.throws(() => validateSnapshotManifest(traversal), /disagree|relative/);
});

test('archive paths format founder and >999 numbers and reject private paths', () => {
  assert.equal(snapshotArchivePrefix(0, captureId), `public/history/contributions/000/${captureId}`);
  assert.equal(snapshotArchivePrefix(1001, captureId), `public/history/contributions/1001/${captureId}`);
  const parsed = validateSnapshotManifest(manifest());
  assert.equal(snapshotArchiveObjectPath(parsed, 'before/home.png'), `public/history/contributions/042/${captureId}/before/home.png`);
  assert.equal(isAllowedPublicHistorySnapshotPath(`public/history/contributions/042/${captureId}/after/home.png`), true);
  assert.equal(isAllowedPublicHistorySnapshotPath('private/snapshot.png'), false);
});

function publicSnapshot(routes = ['/']) {
  const prefix = `public/history/contributions/042/${captureId}`;
  return {
    schemaVersion: 1, contributionNumber: 42, captureId,
    beforeGitSha: 'a'.repeat(40), afterGitSha: 'b'.repeat(40),
    canonicalRoutes: routes, additionalRoutes: [], capturedRoutes: routes,
    routes: routes.map((route, index) => {
      const routeKey = index === 0 ? 'home' : `route-${index}`;
      return { route, routeKey, before: { storagePath: `${prefix}/before/${routeKey}.png`, sha256: checksum }, after: { storagePath: `${prefix}/after/${routeKey}.png`, sha256: checksum } };
    }),
    manifestStoragePath: `${prefix}/manifest.json`,
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1, fullPage: true }, archivedAt: timestamp,
  };
}

test('public metadata supports historical three and future four route archives', () => {
  const three = parsePublicContributionSnapshot(publicSnapshot(['/', '/random', '/thoughts']));
  const four = parsePublicContributionSnapshot(publicSnapshot(['/', '/random', '/thoughts', '/gallery']));
  assert.equal(three?.routes.length, 3);
  assert.equal(snapshotHistorySummary(three!), 'before & after · 3 pages');
  assert.equal(four?.routes.length, 4);
  assert.equal(historicalRouteLabel('/'), 'home');
  assert.equal(historicalRouteLabel('/gallery'), '/gallery');
  assert.equal(snapshotImageAlt('before', 42, '/random'), 'before contribution #042, /random');
});

test('public parser fails closed for unsupported schemas and unsafe Storage records', () => {
  assert.equal(parsePublicContributionSnapshot({ ...publicSnapshot(), schemaVersion: 2 }), null);
  const unsafe = publicSnapshot(); unsafe.routes[0].before.storagePath = 'private/home.png';
  assert.equal(parsePublicContributionSnapshot(unsafe), null);
});

test('History detail snapshot UI is complete, lazy, accessible, and failure tolerant', async () => {
  const source = await readFile(new URL('../src/platform/components/HistorySnapshots.tsx', import.meta.url), 'utf8');
  assert.match(source, /snapshot\.routes\.map/);
  assert.doesNotMatch(source, /expanded &&/);
  assert.match(source, /loading="lazy"/);
  assert.match(source, /useEffect/);
  assert.match(source, /loading screenshot/);
  assert.match(source, /screenshot unavailable/);
  assert.match(source, /snapshotImageAlt/);
});
