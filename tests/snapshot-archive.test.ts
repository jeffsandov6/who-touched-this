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
import { snapshotSideTiles, validateSnapshotManifest } from '../src/platform/snapshots/schema.ts';
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

// Historical schema-v1 fixture retained to prove old permanent archives remain portable.
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
    for (const side of ['before', 'after'] as const) for (const image of snapshotSideTiles(screenshot[side])) files.push(selectedFile([png], image.path.split('/').at(-1)!, 'image/png', `${captureId}/${image.path}`));
  }
  return files;
}

function tiledManifest() {
  const value = manifest() as any;
  value.schemaVersion = 2;
  value.capture = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, captureMode: 'tiled-document', tileHeight: 3600, format: 'png', locale: 'en-US', timezoneId: 'UTC', waitMs: 1500, maximumTileCount: 64, maximumTotalScreenshotPixels: 384_000_000, maximumTotalScreenshotBytes: 160 * 1024 * 1024 };
  for (const record of value.screenshots) for (const side of ['before', 'after']) record[side] = { width: 1, height: 1, tiles: [{ index: 0, y: 0, width: 1, height: 1, path: `${side}/${record.key}/tile-000.png`, sha256: checksum, bytes: png.length }] };
  return value;
}

test('browser importer validates a complete reviewed bundle and checksums', async () => {
  const bundle = await validateSelectedSnapshotBundle(filesFor());
  assert.equal(bundle.manifest.contributionNumber, 42);
  assert.equal(bundle.validChecksums, 2);
  assert.equal(bundle.screenshots.size, 2);
});

test('browser importer validates schema-v2 tiled bundles while schema-v1 history remains readable', async () => {
  const bundle = await validateSelectedSnapshotBundle(filesFor(tiledManifest()));
  assert.equal(bundle.manifest.schemaVersion, 2);
  assert.equal(bundle.validChecksums, 2);
  assert.equal(isAllowedPublicHistorySnapshotPath(`public/history/contributions/042/${captureId}/before/home/tile-000.png`), true);
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
  assert.throws(() => validateSnapshotManifest({ ...manifest(), schemaVersion: 3 }), /unsupported/);
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

function publicTiledSnapshot(width = 1440, heights = [3600, 1]) {
  const value = publicSnapshot() as any;
  value.schemaVersion = 2;
  value.viewport = { width: 1440, height: 900, deviceScaleFactor: 1, captureMode: 'tiled-document', tileHeight: 3600 };
  for (const record of value.routes) for (const side of ['before', 'after']) {
    let y = 0;
    const root = value.manifestStoragePath.replace('/manifest.json', '');
    const tiles = heights.map((height, index) => {
      const tile = { index, y, width, height, storagePath: `${root}/${side}/${record.routeKey}/tile-${String(index).padStart(3, '0')}.png`, sha256: checksum };
      y += height;
      return tile;
    });
    record[side] = { width, height: y, tiles };
  }
  return value;
}

test('schema-v1 public/history snapshots still parse with legacy single-image sides', () => {
  const three = parsePublicContributionSnapshot(publicSnapshot(['/', '/random', '/thoughts']));
  const four = parsePublicContributionSnapshot(publicSnapshot(['/', '/random', '/thoughts', '/gallery']));
  assert.equal(three?.routes.length, 3);
  assert.equal(snapshotHistorySummary(three!), 'before & after · 3 pages');
  assert.equal(four?.routes.length, 4);
  assert.equal(three?.schemaVersion, 1);
  assert.equal('storagePath' in three!.routes[0].before, true);
  assert.equal(historicalRouteLabel('/'), 'home');
  assert.equal(historicalRouteLabel('/gallery'), '/gallery');
  assert.equal(snapshotImageAlt('before', 42, '/random'), 'before contribution #042, /random');
});

test('schema-v2 public metadata parses bounded tiled sides with continuous offsets', () => {
  const value = publicTiledSnapshot();
  const parsed = parsePublicContributionSnapshot(value);
  assert.equal(parsed?.schemaVersion, 2);
  assert.equal('tiles' in parsed!.routes[0].before ? parsed!.routes[0].before.tiles.length : 0, 2);
  value.routes[0].before.tiles[1].y = 3599;
  assert.equal(parsePublicContributionSnapshot(value), null);
});

test('schema-v2 public parser rejects excessive dimensions, pixels, tiles, seams, paths, and checksums', () => {
  assert.equal(parsePublicContributionSnapshot(publicTiledSnapshot(2_881, [1])), null);
  assert.equal(parsePublicContributionSnapshot(publicTiledSnapshot(2_000, Array(64).fill(3_600))), null);
  assert.equal(parsePublicContributionSnapshot(publicTiledSnapshot(1, Array(65).fill(3_600))), null);
  assert.equal(parsePublicContributionSnapshot(publicTiledSnapshot(1, [3_599, 1])), null);
  const path = publicTiledSnapshot(); path.routes[0].before.tiles[0].storagePath = 'private/tile-000.png';
  assert.equal(parsePublicContributionSnapshot(path), null);
  const sha = publicTiledSnapshot(); sha.routes[0].before.tiles[0].sha256 = 'not-a-sha';
  assert.equal(parsePublicContributionSnapshot(sha), null);
});

test('public parser fails closed for unsupported schemas and unsafe Storage records', () => {
  assert.equal(parsePublicContributionSnapshot({ ...publicSnapshot(), schemaVersion: 2 }), null);
  const unsafe = publicSnapshot(); unsafe.routes[0].before.storagePath = 'private/home.png';
  assert.equal(parsePublicContributionSnapshot(unsafe), null);
});

test('History detail supports legacy loading and reserves seamless tiled geometry', async () => {
  const source = await readFile(new URL('../src/platform/components/HistorySnapshots.tsx', import.meta.url), 'utf8');
  assert.match(source, /snapshot\.routes\.map/);
  assert.doesNotMatch(source, /expanded &&/);
  assert.match(source, /loading="lazy"/);
  assert.match(source, /useEffect/);
  assert.match(source, /loading screenshot/);
  assert.match(source, /screenshot unavailable/);
  assert.match(source, /snapshotImageAlt/);
  const tiledComponent = source.slice(source.indexOf('function ResolvedTile'), source.indexOf('function SnapshotImage'));
  assert.match(tiledComponent, /aspectRatio/);
  assert.doesNotMatch(tiledComponent, /<p/);
  assert.match(tiledComponent, /history-snapshot-tile-error/);
  const css = await readFile(new URL('../src/styles/global.css', import.meta.url), 'utf8');
  assert.match(css, /\.history-snapshot-tile \{ position: relative; display: block; width: 100%; margin: 0;/);
  assert.match(css, /\.history-snapshot-tile img \{ display: block; width: 100%; height: 100%; margin: 0; border: 0;/);
  assert.match(css, /\.history-snapshot-image-link img \{ display: block; width: 100%; height: auto; margin: 0; border: 1px solid/);
});
