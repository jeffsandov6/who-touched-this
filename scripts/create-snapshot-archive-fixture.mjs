#!/usr/bin/env node
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import registry from '../src/platform/config/editable-routes.json' with { type: 'json' };
import { buildSnapshotManifest, verifySnapshotBundle } from './snapshots/manifest.mjs';
import { sha256 } from './snapshots/integrity.mjs';
import { createRouteKeyMap, validateCanonicalRouteRegistry } from './snapshots/routes.mjs';

const argumentIndex = process.argv.indexOf('--contribution');
const contributionNumber = argumentIndex >= 0 ? Number(process.argv[argumentIndex + 1]) : 1;
if (!Number.isSafeInteger(contributionNumber) || contributionNumber < 0) {
  throw new Error('Fixture contribution number must be a non-negative safe integer.');
}
const contributionLabel = String(contributionNumber).padStart(3, '0');
const captureId = contributionNumber === 0 ? 'emulator-founder-snapshot-fixture' : 'emulator-snapshot-fixture';
const routes = validateCanonicalRouteRegistry(registry);
const keys = createRouteKeyMap(routes);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const checksum = sha256(png);
const output = resolve(`.wtt/snapshot-archive-fixture/contribution-${contributionLabel}`, captureId);

if (await stat(output).then(() => true).catch(() => false)) {
  throw new Error(`Fixture already exists and was not overwritten: ${output}`);
}
await Promise.all([mkdir(`${output}/before`, { recursive: true }), mkdir(`${output}/after`, { recursive: true })]);
for (const route of routes) {
  await Promise.all([
    writeFile(`${output}/before/${keys[route]}.png`, png),
    writeFile(`${output}/after/${keys[route]}.png`, png),
  ]);
}
const checksums = Object.fromEntries(routes.map((route) => [route, checksum]));
const manifest = buildSnapshotManifest({
  contributionNumber,
  captureId,
  capturedAt: '2026-01-01T00:00:00.000Z',
  beforeSha: 'a'.repeat(40),
  afterSha: 'b'.repeat(40),
  canonicalRoutes: routes,
  additionalRoutes: [],
  capturedRoutes: routes,
  waitMs: 1500,
  checksums: { before: checksums, after: checksums },
});
await writeFile(`${output}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
await verifySnapshotBundle(output);
console.log(`Created verified emulator-only archive fixture: ${output}`);
