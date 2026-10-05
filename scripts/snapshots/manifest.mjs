import { resolve, sep } from 'node:path';
import { readFile } from 'node:fs/promises';
import { SNAPSHOT_CONFIG } from './config.mjs';
import { validatePngScreenshot, sha256File } from './integrity.mjs';
import { createRouteKeyMap } from './routes.mjs';
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
      captureMode: SNAPSHOT_CONFIG.captureMode,
      tileHeight: SNAPSHOT_CONFIG.tileHeight,
      format: SNAPSHOT_CONFIG.format,
      locale: SNAPSHOT_CONFIG.locale,
      timezoneId: SNAPSHOT_CONFIG.timezoneId,
      waitMs: input.waitMs,
      maximumTileCount: SNAPSHOT_CONFIG.maximumTileCount,
      maximumTotalScreenshotPixels: SNAPSHOT_CONFIG.maximumTotalScreenshotPixels,
      maximumTotalScreenshotBytes: SNAPSHOT_CONFIG.maximumTotalScreenshotBytes,
    },
    screenshots: input.capturedRoutes.map((route) => ({
      route,
      key: routeKeys[route],
      before: input.checksums.before[route],
      after: input.checksums.after[route],
    })),
  };
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
  if (manifest.capture.viewport.width !== SNAPSHOT_CONFIG.viewport.width || manifest.capture.viewport.height !== SNAPSHOT_CONFIG.viewport.height) throw new Error('Manifest capture metadata is malformed.');
  let bundleBytes = 0;
  for (const record of manifest.screenshots) {
    for (const side of ['before', 'after']) {
      const items = manifest.schemaVersion === 1 ? [record[side]] : record[side].tiles;
      let totalBytes = 0;
      for (const item of items) {
        const absolute = resolve(bundlePath, item.path);
        if (!absolute.startsWith(`${resolve(bundlePath)}${sep}`)) throw new Error('Screenshot path escapes the bundle.');
        let contents;
        try { contents = await readFile(absolute); } catch { throw new Error(`Expected screenshot is missing: ${item.path}`); }
        try {
          const config = manifest.schemaVersion === 1 ? {
            maximumScreenshotBytes: SNAPSHOT_CONFIG.maximumTileBytes,
            maximumDocumentHeight: SNAPSHOT_CONFIG.legacyMaximumDocumentHeight,
            maximumScreenshotPixels: SNAPSHOT_CONFIG.legacyMaximumScreenshotPixels,
          } : SNAPSHOT_CONFIG;
          const expected = manifest.schemaVersion === 1 ? undefined : { width: item.width, height: item.height };
          validatePngScreenshot(contents, config, expected);
        } catch (error) { throw new Error(`Invalid screenshot ${item.path}: ${error.message}`); }
        if (manifest.schemaVersion === 2 && contents.length !== item.bytes) throw new Error(`Screenshot byte length mismatch: ${item.path}`);
        totalBytes += contents.length;
        bundleBytes += contents.length;
        if (manifest.schemaVersion === 2 && totalBytes > SNAPSHOT_CONFIG.maximumTotalScreenshotBytes) throw new Error(`Screenshot side exceeds total byte bounds: ${record.route}`);
        if (await sha256File(absolute) !== item.sha256) throw new Error(`Screenshot checksum mismatch: ${item.path}`);
      }
    }
  }
  if (bundleBytes > SNAPSHOT_CONFIG.maximumBundleScreenshotBytes) throw new Error('Snapshot bundle screenshots exceed total artifact bounds.');
  return manifest;
}
