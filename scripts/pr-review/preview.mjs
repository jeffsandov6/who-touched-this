import { chromium } from 'playwright';
import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { captureRevision } from '../snapshots/capture.mjs';
import { SNAPSHOT_CONFIG } from '../snapshots/config.mjs';
import { readHistoricalRouteRegistry, resolveCommit } from '../snapshots/git.mjs';
import { isPng, sha256File } from '../snapshots/integrity.mjs';
import { createRouteKeyMap } from '../snapshots/routes.mjs';

export const PR_PREVIEW_SCHEMA_VERSION = 1;
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
      fullPage: SNAPSHOT_CONFIG.fullPage,
      format: SNAPSHOT_CONFIG.format,
      locale: SNAPSHOT_CONFIG.locale,
      timezoneId: SNAPSHOT_CONFIG.timezoneId,
      waitMs: input.waitMs,
      externalNetwork: 'container-and-browser-blocked',
      maximumDocumentHeight: SNAPSHOT_CONFIG.maximumDocumentHeight,
      maximumScreenshotPixels: SNAPSHOT_CONFIG.maximumScreenshotPixels,
      screenshotTimeoutMs: SNAPSHOT_CONFIG.screenshotTimeoutMs,
    },
    screenshots: input.routes.map((route) => ({
      route,
      key: routeKeys[route],
      before: { path: `before/${routeKeys[route]}.png`, sha256: input.checksums.before[route] },
      proposedAfter: { path: `proposed-after/${routeKeys[route]}.png`, sha256: input.checksums.proposedAfter[route] },
    })),
  };
}

export function renderPullRequestReviewPage(manifest) {
  const comparisons = manifest.screenshots.map((record) => `<section><h2>${escapeHtml(record.route)}</h2><div class="comparison"><figure><figcaption>BEFORE</figcaption><img src="${escapeHtml(record.before.path)}" alt="Before ${escapeHtml(record.route)}"></figure><figure><figcaption>PROPOSED AFTER</figcaption><img src="${escapeHtml(record.proposedAfter.path)}" alt="Proposed after ${escapeHtml(record.route)}"></figure></div></section>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>PR #${manifest.pullRequestNumber} visual review</title><style>body{font:16px system-ui,sans-serif;margin:2rem;background:#f5f5f5;color:#171717}header,section{max-width:1800px;margin:0 auto 2rem}.comparison{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}figure{margin:0}figcaption{font-weight:700;margin-bottom:.5rem}img{display:block;width:100%;height:auto;background:white;border:1px solid #bbb}@media(max-width:800px){.comparison{grid-template-columns:1fr}}</style></head><body><header><h1>Pull request #${manifest.pullRequestNumber}</h1><p>Review artifact only — not a permanent History snapshot.</p><p>BASE ${manifest.git.base.slice(0, 12)} · PROPOSED HEAD ${manifest.git.proposedHead.slice(0, 12)}</p></header>${comparisons}</body></html>`;
}

export async function verifyPullRequestPreviewBundle(bundlePath) {
  const root = resolve(bundlePath);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
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
    || manifest.capture?.externalNetwork !== 'container-and-browser-blocked'
    || manifest.capture?.maximumDocumentHeight !== SNAPSHOT_CONFIG.maximumDocumentHeight
    || manifest.capture?.maximumScreenshotPixels !== SNAPSHOT_CONFIG.maximumScreenshotPixels
    || manifest.capture?.screenshotTimeoutMs !== SNAPSHOT_CONFIG.screenshotTimeoutMs
    || !Array.isArray(manifest.canonicalRoutes) || manifest.canonicalRoutes.length === 0
    || !Array.isArray(manifest.screenshots)
    || manifest.screenshots.length !== manifest.canonicalRoutes.length
    || !Number.isFinite(Date.parse(manifest.capturedAt))) {
    throw new Error('Preview manifest metadata is malformed.');
  }
  const keys = createRouteKeyMap(manifest.canonicalRoutes);
  for (let index = 0; index < manifest.canonicalRoutes.length; index += 1) {
    const route = manifest.canonicalRoutes[index];
    const record = manifest.screenshots[index];
    if (record?.route !== route || record.key !== keys[route]) throw new Error('Preview route metadata disagrees with screenshot records.');
    for (const [side, expectedDirectory] of [['before', 'before'], ['proposedAfter', 'proposed-after']]) {
      const screenshot = record[side];
      const expectedPath = `${expectedDirectory}/${record.key}.png`;
      if (screenshot?.path !== expectedPath || !/^[0-9a-f]{64}$/.test(screenshot?.sha256 ?? '')) {
        throw new Error('Preview screenshot metadata is malformed.');
      }
      const file = resolve(root, screenshot.path);
      if (!file.startsWith(`${root}${sep}`)) throw new Error('Preview screenshot path escaped its bundle.');
      let contents;
      try { contents = await readFile(file); } catch { throw new Error(`Preview screenshot is missing: ${expectedPath}`); }
      if (!isPng(contents)) throw new Error(`Preview screenshot is not PNG: ${expectedPath}`);
      if (await sha256File(file) !== screenshot.sha256) throw new Error(`Preview screenshot checksum mismatch: ${expectedPath}`);
    }
  }
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
    const before = await captureRevision({ browser, side: 'before', sha: identity.baseSha, routes, routeKeys, distPath: baseDistPath, outputPath: stagingPath, waitMs, signal: options.signal, blockExternalRequests: true });
    const proposedAfter = await captureRevision({ browser, side: 'proposed-after', sha: identity.headSha, routes, routeKeys, distPath: proposedDistPath, outputPath: stagingPath, waitMs, signal: options.signal, blockExternalRequests: true });
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
