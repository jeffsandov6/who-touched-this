import { isAbsolute, resolve, sep } from 'node:path';
import { readFile } from 'node:fs/promises';
import { SNAPSHOT_CONFIG } from './config.mjs';
import { validatePngScreenshot, sha256File } from './integrity.mjs';
import { createRouteKeyMap, normalizeSnapshotRoute } from './routes.mjs';
import { validateSnapshotManifest } from '../../src/platform/snapshots/schema.ts';

export function formatContributionNumber(number) {
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('Contribution number must be a non-negative safe integer.');
  return String(number).padStart(3, '0');
}

export function buildSnapshotManifest(input) {
  const routeKeys = createRouteKeyMap(input.capturedRoutes);
  return {
    schemaVersion: SNAPSHOT_CONFIG.manifestSchemaVersion,
    contributionNumber: input.contributionNumber,
    contributionLabel: formatContributionNumber(input.contributionNumber),
    captureId: input.captureId,
    capturedAt: input.capturedAt,
    git: {
      before: input.beforeSha,
      after: input.afterSha,
    },
    routeRegistry: {
      path: SNAPSHOT_CONFIG.routeRegistryPath,
      revision: input.afterSha,
    },
    canonicalRoutes: input.canonicalRoutes,
    additionalRoutes: input.additionalRoutes,
    capturedRoutes: input.capturedRoutes,
    capture: {
      viewport: SNAPSHOT_CONFIG.viewport,
      deviceScaleFactor: SNAPSHOT_CONFIG.deviceScaleFactor,
      fullPage: SNAPSHOT_CONFIG.fullPage,
      format: SNAPSHOT_CONFIG.format,
      locale: SNAPSHOT_CONFIG.locale,
      timezoneId: SNAPSHOT_CONFIG.timezoneId,
      waitMs: input.waitMs,
    },
    screenshots: input.capturedRoutes.map((route) => ({
      route,
      key: routeKeys[route],
      before: { path: `before/${routeKeys[route]}.png`, sha256: input.checksums.before[route] },
      after: { path: `after/${routeKeys[route]}.png`, sha256: input.checksums.after[route] },
    })),
  };
}

function assertPortableRelativePath(value, label) {
  if (typeof value !== 'string' || !value || isAbsolute(value) || value.split(/[\\/]/).includes('..')) {
    throw new Error(`${label} must be a portable relative path.`);
  }
}

export async function verifySnapshotBundle(bundlePath) {
  const manifestPath = resolve(bundlePath, 'manifest.json');
  let manifest;
  try {
    const serialized = await readFile(manifestPath);
    if (serialized.length > SNAPSHOT_CONFIG.maximumManifestBytes) throw new Error('snapshot manifest exceeds its size limit.');
    manifest = validateSnapshotManifest(JSON.parse(serialized.toString('utf8')));
  } catch (error) {
    throw new Error(`Malformed or missing snapshot manifest: ${error.message}`);
  }
  if (manifest.schemaVersion !== SNAPSHOT_CONFIG.manifestSchemaVersion) throw new Error('Unsupported snapshot manifest schema.');
  if (manifest.contributionLabel !== formatContributionNumber(manifest.contributionNumber)
    || typeof manifest.captureId !== 'string' || !/^[A-Za-z0-9-]+$/.test(manifest.captureId)
    || typeof manifest.capturedAt !== 'string' || !Number.isFinite(Date.parse(manifest.capturedAt))) {
    throw new Error('Manifest identity metadata is malformed.');
  }
  if (!manifest.git || !/^[0-9a-f]{40}$/.test(manifest.git.before)
    || !/^[0-9a-f]{40}$/.test(manifest.git.after) || manifest.git.before === manifest.git.after) {
    throw new Error('Manifest Git revisions are malformed.');
  }
  if (manifest.routeRegistry?.path !== SNAPSHOT_CONFIG.routeRegistryPath
    || manifest.routeRegistry?.revision !== manifest.git.after) {
    throw new Error('Manifest historical route-registry metadata is malformed.');
  }
  if (!manifest.capture || manifest.capture.viewport?.width !== SNAPSHOT_CONFIG.viewport.width
    || manifest.capture.viewport?.height !== SNAPSHOT_CONFIG.viewport.height
    || manifest.capture.deviceScaleFactor !== SNAPSHOT_CONFIG.deviceScaleFactor
    || manifest.capture.fullPage !== SNAPSHOT_CONFIG.fullPage
    || manifest.capture.format !== SNAPSHOT_CONFIG.format
    || !Number.isInteger(manifest.capture.waitMs) || manifest.capture.waitMs < 0
    || manifest.capture.waitMs > SNAPSHOT_CONFIG.maximumWaitMs) {
    throw new Error('Manifest capture metadata is malformed.');
  }
  if (!Array.isArray(manifest.canonicalRoutes) || !Array.isArray(manifest.additionalRoutes)
    || !Array.isArray(manifest.capturedRoutes) || !Array.isArray(manifest.screenshots)) {
    throw new Error('Manifest route metadata is malformed.');
  }
  const expected = [...manifest.canonicalRoutes, ...manifest.additionalRoutes].map(normalizeSnapshotRoute);
  if (JSON.stringify([...manifest.canonicalRoutes, ...manifest.additionalRoutes]) !== JSON.stringify(expected)) {
    throw new Error('Manifest routes must already be normalized.');
  }
  if (manifest.canonicalRoutes.length === 0 || new Set(expected).size !== expected.length) {
    throw new Error('Manifest routes must be non-empty and unique.');
  }
  if (JSON.stringify(expected) !== JSON.stringify(manifest.capturedRoutes)
    || manifest.screenshots.length !== expected.length) {
    throw new Error('Manifest route and screenshot records disagree.');
  }
  const keys = createRouteKeyMap(expected);
  for (let index = 0; index < expected.length; index += 1) {
    const record = manifest.screenshots[index];
    if (record.route !== expected[index] || record.key !== keys[expected[index]]) {
      throw new Error('Manifest route and screenshot records disagree.');
    }
    for (const side of ['before', 'after']) {
      const item = record[side];
      assertPortableRelativePath(item?.path, `${side} screenshot path`);
      if (!/^[0-9a-f]{64}$/.test(item?.sha256 ?? '')) throw new Error('Manifest screenshot checksum is malformed.');
      if (item.path !== `${side}/${record.key}.png`) {
        throw new Error('Manifest route and screenshot paths disagree.');
      }
      const absolute = resolve(bundlePath, item.path);
      if (!absolute.startsWith(`${resolve(bundlePath)}${sep}`)) throw new Error('Screenshot path escapes the bundle.');
      let contents;
      try {
        contents = await readFile(absolute);
      } catch {
        throw new Error(`Expected screenshot is missing: ${item.path}`);
      }
      try {
        validatePngScreenshot(contents, SNAPSHOT_CONFIG);
      } catch (error) {
        throw new Error(`Invalid screenshot ${item.path}: ${error.message}`);
      }
      const actual = await sha256File(absolute);
      if (actual !== item.sha256) throw new Error(`Screenshot checksum mismatch: ${item.path}`);
    }
  }
  return manifest;
}
