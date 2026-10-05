import { chromium } from 'playwright';
import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { captureRevision } from '../snapshots/capture.mjs';
import { SNAPSHOT_CONFIG } from '../snapshots/config.mjs';
import { readHistoricalRouteRegistry, resolveCommit } from '../snapshots/git.mjs';
import { sha256File, validatePngScreenshot } from '../snapshots/integrity.mjs';
import { createRouteKeyMap } from '../snapshots/routes.mjs';

export const PR_PREVIEW_SCHEMA_VERSION = 2;
const SHA = /^[0-9a-f]{40}$/;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

export function validatePullRequestPreviewIdentity({ pullRequestNumber, baseSha, headSha }) {
  if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1) throw new Error('Pull request number must be a positive integer.');
  if (!SHA.test(baseSha ?? '') || !SHA.test(headSha ?? '')) throw new Error('Preview revisions must be full lowercase Git SHAs.');
  if (baseSha === headSha) throw new Error('Preview base and proposed head revisions must differ.');
  return { pullRequestNumber, baseSha, headSha };
}

export function selectCanonicalPreviewRoutes(baseRoutes, proposedRoutes = baseRoutes) {
  if (!Array.isArray(baseRoutes) || baseRoutes.length === 0 || new Set(baseRoutes).size !== baseRoutes.length) {
    throw new Error('Canonical preview routes are malformed.');
  }
  createRouteKeyMap(baseRoutes);
  if (JSON.stringify(baseRoutes) !== JSON.stringify(proposedRoutes)) {
    throw new Error('The proposed contribution changed the protected canonical editable-route registry.');
  }
  return [...baseRoutes];
}

export async function validateStaticPreviewTree(rootPath, limits = { maxFiles: 20_000, maxBytes: 250 * 1024 * 1024 }) {
  const root = resolve(rootPath);
  const pending = [root];
  let files = 0;
  let bytes = 0;
  while (pending.length) {
    const directory = pending.pop();
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const itemPath = join(directory, entry.name);
      const item = await lstat(itemPath);
      if (item.isSymbolicLink() || (!item.isDirectory() && !item.isFile())) {
        throw new Error('Proposed preview output contains a non-regular filesystem object.');
      }
      if (item.isDirectory()) pending.push(itemPath);
      else {
        files += 1;
        bytes += item.size;
        if (files > limits.maxFiles || bytes > limits.maxBytes) {
          throw new Error('Proposed preview output exceeds bounded artifact limits.');
        }
      }
    }
  }
  return { files, bytes };
}

export function buildPullRequestPreviewManifest(input) {
  const identity = validatePullRequestPreviewIdentity(input);
  const routeKeys = createRouteKeyMap(input.routes);
  return {
    schemaVersion: PR_PREVIEW_SCHEMA_VERSION,
    artifactKind: 'pull-request-visual-preview',
    pullRequestNumber: identity.pullRequestNumber,
    capturedAt: input.capturedAt,
    git: { base: identity.baseSha, proposedHead: identity.headSha },
    routeRegistry: { path: SNAPSHOT_CONFIG.routeRegistryPath, revision: identity.baseSha },
    canonicalRoutes: input.routes,
    capture: {
      viewport: SNAPSHOT_CONFIG.viewport,
      deviceScaleFactor: SNAPSHOT_CONFIG.deviceScaleFactor,
      captureMode: SNAPSHOT_CONFIG.captureMode,
      tileHeight: SNAPSHOT_CONFIG.tileHeight,
      format: SNAPSHOT_CONFIG.format,
      locale: SNAPSHOT_CONFIG.locale,
      timezoneId: SNAPSHOT_CONFIG.timezoneId,
      waitMs: input.waitMs,
      externalNetwork: 'container-and-browser-blocked',
      maximumTileWidth: SNAPSHOT_CONFIG.maximumTileWidth,
      maximumTilePixels: SNAPSHOT_CONFIG.maximumTilePixels,
      maximumTileCount: SNAPSHOT_CONFIG.maximumTileCount,
      maximumTotalScreenshotPixels: SNAPSHOT_CONFIG.maximumTotalScreenshotPixels,
      maximumTileBytes: SNAPSHOT_CONFIG.maximumTileBytes,
      maximumTotalScreenshotBytes: SNAPSHOT_CONFIG.maximumTotalScreenshotBytes,
      screenshotTimeoutMs: SNAPSHOT_CONFIG.screenshotTimeoutMs,
    },
    screenshots: input.routes.map((route) => ({
      route,
      key: routeKeys[route],
      before: input.checksums.before[route],
      proposedAfter: input.checksums.proposedAfter[route],
    })),
  };
}

export function renderPullRequestReviewPage(manifest) {
  const stack = (side, label, route) => `<div class="page-stack">${side.tiles.map((tile) => `<img src="${escapeHtml(tile.path)}" alt="${label} ${escapeHtml(route)}, tile ${tile.index + 1} of ${side.tiles.length}">`).join('')}</div>`;
  const comparisons = manifest.screenshots.map((record) => `<section><h2>${escapeHtml(record.route)}</h2><div class="comparison"><figure><figcaption>BEFORE</figcaption>${stack(record.before, 'Before', record.route)}</figure><figure><figcaption>PROPOSED AFTER</figcaption>${stack(record.proposedAfter, 'Proposed after', record.route)}</figure></div></section>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>PR #${manifest.pullRequestNumber} visual review</title><style>body{font:16px system-ui,sans-serif;margin:2rem;background:#f5f5f5;color:#171717}header,section{max-width:1800px;margin:0 auto 2rem}.comparison{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}figure{margin:0}figcaption{font-weight:700;margin-bottom:.5rem}.page-stack{line-height:0;background:white;border:1px solid #bbb;overflow:hidden}.page-stack img{display:block;width:100%;height:auto;margin:0;border:0}@media(max-width:800px){.comparison{grid-template-columns:1fr}}</style></head><body><header><h1>Pull request #${manifest.pullRequestNumber}</h1><p>Review artifact only — not a permanent History snapshot.</p><p>BASE ${manifest.git.base.slice(0, 12)} · PROPOSED HEAD ${manifest.git.proposedHead.slice(0, 12)}</p></header>${comparisons}</body></html>`;
}

export async function verifyPullRequestPreviewBundle(bundlePath) {
  const root = resolve(bundlePath);
  let manifest;
  try {
    const serialized = await readFile(join(root, 'manifest.json'));
    if (serialized.length > SNAPSHOT_CONFIG.maximumManifestBytes) throw new Error('too large');
    manifest = JSON.parse(serialized.toString('utf8'));
  } catch {
    throw new Error('Preview manifest is missing or malformed.');
  }
  validatePullRequestPreviewIdentity({
    pullRequestNumber: manifest.pullRequestNumber,
    baseSha: manifest.git?.base,
    headSha: manifest.git?.proposedHead,
  });
  if (manifest.schemaVersion !== PR_PREVIEW_SCHEMA_VERSION
    || manifest.artifactKind !== 'pull-request-visual-preview'
    || manifest.routeRegistry?.path !== SNAPSHOT_CONFIG.routeRegistryPath
    || manifest.routeRegistry?.revision !== manifest.git.base
    || manifest.capture?.viewport?.width !== SNAPSHOT_CONFIG.viewport.width
    || manifest.capture?.viewport?.height !== SNAPSHOT_CONFIG.viewport.height
    || manifest.capture?.deviceScaleFactor !== SNAPSHOT_CONFIG.deviceScaleFactor
    || manifest.capture?.format !== SNAPSHOT_CONFIG.format
    || manifest.capture?.locale !== SNAPSHOT_CONFIG.locale
    || manifest.capture?.timezoneId !== SNAPSHOT_CONFIG.timezoneId
    || !Number.isInteger(manifest.capture?.waitMs) || manifest.capture.waitMs < 0 || manifest.capture.waitMs > SNAPSHOT_CONFIG.maximumWaitMs
    || manifest.capture?.externalNetwork !== 'container-and-browser-blocked'
    || manifest.capture?.captureMode !== SNAPSHOT_CONFIG.captureMode
    || manifest.capture?.tileHeight !== SNAPSHOT_CONFIG.tileHeight
    || manifest.capture?.maximumTileWidth !== SNAPSHOT_CONFIG.maximumTileWidth
    || manifest.capture?.maximumTilePixels !== SNAPSHOT_CONFIG.maximumTilePixels
    || manifest.capture?.maximumTileCount !== SNAPSHOT_CONFIG.maximumTileCount
    || manifest.capture?.maximumTotalScreenshotPixels !== SNAPSHOT_CONFIG.maximumTotalScreenshotPixels
    || manifest.capture?.maximumTileBytes !== SNAPSHOT_CONFIG.maximumTileBytes
    || manifest.capture?.maximumTotalScreenshotBytes !== SNAPSHOT_CONFIG.maximumTotalScreenshotBytes
    || manifest.capture?.screenshotTimeoutMs !== SNAPSHOT_CONFIG.screenshotTimeoutMs
    || !Array.isArray(manifest.canonicalRoutes) || manifest.canonicalRoutes.length === 0
    || !Array.isArray(manifest.screenshots)
    || manifest.screenshots.length !== manifest.canonicalRoutes.length
    || !Number.isFinite(Date.parse(manifest.capturedAt))) {
    throw new Error('Preview manifest metadata is malformed.');
  }
  const keys = createRouteKeyMap(manifest.canonicalRoutes);
  let bundleBytes = 0;
  for (let index = 0; index < manifest.canonicalRoutes.length; index += 1) {
    const route = manifest.canonicalRoutes[index];
    const record = manifest.screenshots[index];
    if (record?.route !== route || record.key !== keys[route]) throw new Error('Preview route metadata disagrees with screenshot records.');
    for (const [side, expectedDirectory] of [['before', 'before'], ['proposedAfter', 'proposed-after']]) {
      const screenshot = record[side];
      if (!Number.isSafeInteger(screenshot?.width) || screenshot.width < 1 || screenshot.width > SNAPSHOT_CONFIG.maximumTileWidth
        || !Number.isSafeInteger(screenshot?.height) || screenshot.height < 1 || !Array.isArray(screenshot?.tiles)
        || screenshot.tiles.length < 1 || screenshot.tiles.length > SNAPSHOT_CONFIG.maximumTileCount
        || screenshot.width * screenshot.height > SNAPSHOT_CONFIG.maximumTotalScreenshotPixels) throw new Error('Preview screenshot metadata is malformed.');
      let nextY = 0;
      let totalBytes = 0;
      for (let tileIndex = 0; tileIndex < screenshot.tiles.length; tileIndex += 1) {
        const tile = screenshot.tiles[tileIndex];
        const expectedPath = `${expectedDirectory}/${record.key}/tile-${String(tileIndex).padStart(3, '0')}.png`;
        if (tile?.index !== tileIndex || tile.y !== nextY || tile.y !== tileIndex * SNAPSHOT_CONFIG.tileHeight || tile.width !== screenshot.width || !Number.isSafeInteger(tile.height)
          || tile.height < 1 || tile.height > SNAPSHOT_CONFIG.tileHeight || (tileIndex < screenshot.tiles.length - 1 && tile.height !== SNAPSHOT_CONFIG.tileHeight) || tile.path !== expectedPath
          || !/^[0-9a-f]{64}$/.test(tile.sha256 ?? '') || !Number.isSafeInteger(tile.bytes) || tile.bytes < 1 || tile.bytes > SNAPSHOT_CONFIG.maximumTileBytes) throw new Error('Preview tile metadata is malformed.');
        nextY += tile.height;
        totalBytes += tile.bytes;
        bundleBytes += tile.bytes;
        if (totalBytes > SNAPSHOT_CONFIG.maximumTotalScreenshotBytes) throw new Error('Preview screenshot exceeds total byte bounds.');
        const file = resolve(root, tile.path);
        if (!file.startsWith(`${root}${sep}`)) throw new Error('Preview screenshot path escaped its bundle.');
        let contents;
        try { contents = await readFile(file); } catch { throw new Error(`Preview screenshot is missing: ${expectedPath}`); }
        validatePngScreenshot(contents, SNAPSHOT_CONFIG, { width: tile.width, height: tile.height });
        if (contents.length !== tile.bytes) throw new Error(`Preview screenshot byte length mismatch: ${expectedPath}`);
        if (await sha256File(file) !== tile.sha256) throw new Error(`Preview screenshot checksum mismatch: ${expectedPath}`);
      }
      if (nextY !== screenshot.height) throw new Error('Preview tiles do not continuously cover the page.');
    }
  }
  if (bundleBytes > SNAPSHOT_CONFIG.maximumBundleScreenshotBytes) throw new Error('Preview screenshots exceed total artifact bounds.');
  return manifest;
}

export async function capturePullRequestPreview(options) {
  const identity = validatePullRequestPreviewIdentity(options);
  const waitMs = options.waitMs ?? SNAPSHOT_CONFIG.defaultWaitMs;
  if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > SNAPSHOT_CONFIG.maximumWaitMs) throw new Error('Preview wait duration is invalid.');
  const baseRepository = resolve(options.baseRepository);
  const baseDistPath = resolve(options.baseDistPath);
  const proposedDistPath = resolve(options.proposedDistPath);
  const outputPath = resolve(options.outputPath);
  const stagingPath = resolve(dirname(outputPath), `.staging-${options.pullRequestNumber}`);
  if (await stat(outputPath).then(() => true).catch(() => false)) throw new Error('Preview output already exists and will not be overwritten.');
  if (await stat(stagingPath).then(() => true).catch(() => false)) throw new Error('Preview staging output already exists.');
  let browser;
  try {
    const actualBase = await resolveCommit(baseRepository, 'HEAD', options.signal);
    if (actualBase !== identity.baseSha) throw new Error('Checked-out trusted base does not match the event base SHA.');
    const routes = selectCanonicalPreviewRoutes(await readHistoricalRouteRegistry(baseRepository, identity.baseSha, options.signal));
    await validateStaticPreviewTree(baseDistPath);
    await validateStaticPreviewTree(proposedDistPath);
    const routeKeys = createRouteKeyMap(routes);
    await mkdir(join(stagingPath, 'before'), { recursive: true });
    await mkdir(join(stagingPath, 'proposed-after'), { recursive: true });
    try {
      browser = await chromium.launch({ headless: true });
    } catch (error) {
      throw new Error(`Playwright Chromium could not start: ${error.message}`);
    }
    const screenshotBudget = { bytes: 0 };
    const before = await captureRevision({ browser, side: 'before', sha: identity.baseSha, routes, routeKeys, distPath: baseDistPath, outputPath: stagingPath, waitMs, signal: options.signal, blockExternalRequests: true, screenshotBudget });
    const proposedAfter = await captureRevision({ browser, side: 'proposed-after', sha: identity.headSha, routes, routeKeys, distPath: proposedDistPath, outputPath: stagingPath, waitMs, signal: options.signal, blockExternalRequests: true, screenshotBudget });
    const manifest = buildPullRequestPreviewManifest({ ...identity, routes, waitMs, capturedAt: new Date().toISOString(), checksums: { before, proposedAfter } });
    await writeFile(join(stagingPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    await writeFile(join(stagingPath, 'index.html'), renderPullRequestReviewPage(manifest), { flag: 'wx' });
    await verifyPullRequestPreviewBundle(stagingPath);
    await mkdir(dirname(outputPath), { recursive: true });
    await rename(stagingPath, outputPath);
    return { outputPath, manifest };
  } catch (error) {
    await rm(stagingPath, { recursive: true, force: true });
    throw error;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
