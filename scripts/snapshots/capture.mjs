import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { SNAPSHOT_CONFIG } from './config.mjs';
import { validateRevisionPair, readHistoricalRouteRegistry, resolveRepositoryRoot, runGit } from './git.mjs';
import { sha256File, validatePngScreenshot } from './integrity.mjs';
import { buildSnapshotManifest, formatContributionNumber, verifySnapshotBundle } from './manifest.mjs';
import { createRouteKeyMap, mergeSnapshotRoutes } from './routes.mjs';

const execFileAsync = promisify(execFile);

function contentType(filePath) {
  return ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.woff2': 'font/woff2' })[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

export async function startStaticServer(rootDirectory) {
  const root = resolve(rootDirectory);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const decoded = decodeURIComponent(url.pathname);
      const clean = decoded.replace(/^\/+|\/+$/g, '');
      const relative = decoded === '/' ? 'index.html' : extname(clean) ? clean : `${clean}/index.html`;
      const candidate = resolve(root, relative);
      if (!candidate.startsWith(`${root}${sep}`) && candidate !== root) {
        response.writeHead(400).end('Bad request');
        return;
      }
      const file = await readFile(candidate);
      response.writeHead(200, { 'content-type': contentType(candidate), 'cache-control': 'no-store' }).end(file);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
    }
  });
  await new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error('Local snapshot server did not start before its timeout.'));
    }, SNAPSHOT_CONFIG.serverStartupTimeoutMs);
    server.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    server.listen(0, '127.0.0.1', () => {
      clearTimeout(timeout);
      resolvePromise();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate a loopback preview port.');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise())),
  };
}

async function addWorktree(repoRoot, worktreePath, sha) {
  await runGit(repoRoot, ['worktree', 'add', '--detach', worktreePath, sha]);
}

async function removeWorktree(repoRoot, worktreePath) {
  try {
    await runGit(repoRoot, ['worktree', 'remove', '--force', worktreePath]);
  } catch {
    await rm(worktreePath, { recursive: true, force: true });
    await runGit(repoRoot, ['worktree', 'prune']);
  }
}

export async function buildHistoricalRevision(worktreePath, signal) {
  const options = { cwd: worktreePath, env: { ...process.env }, signal, maxBuffer: 20 * 1024 * 1024 };
  try {
    await execFileAsync('npm', ['ci'], options);
    await execFileAsync('npm', ['run', 'build:contributor'], options);
  } catch (error) {
    const details = [error.stdout, error.stderr, error.message].filter(Boolean).join('\n').slice(-12_000);
    throw new Error(`Historical contributor-preview build failed in ${worktreePath}:\n${details}`);
  }
  const output = join(worktreePath, 'dist');
  const outputStat = await stat(output).catch(() => undefined);
  if (!outputStat?.isDirectory()) throw new Error(`Historical build did not create ${output}.`);
  return output;
}

export function validateScreenshotDimensions(dimensions, config = SNAPSHOT_CONFIG) {
  const width = Math.ceil(Number(dimensions?.width));
  const height = Math.ceil(Number(dimensions?.height));
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Error('Page reported invalid screenshot dimensions.');
  }
  const tileCount = Math.ceil(height / config.tileHeight);
  if (width > config.maximumTileWidth || tileCount > config.maximumTileCount
    || width * height > config.maximumTotalScreenshotPixels) {
    throw new Error(`Page exceeds screenshot safety bounds (${width} × ${height}).`);
  }
  return { width, height, pixels: width * height, tileCount };
}

export function createTilePlan(dimensions, config = SNAPSHOT_CONFIG) {
  const page = validateScreenshotDimensions(dimensions, config);
  return Array.from({ length: page.tileCount }, (_, index) => {
    const y = index * config.tileHeight;
    return { index, y, width: page.width, height: Math.min(config.tileHeight, page.height - y) };
  });
}

export async function captureRevision({ browser, side, sha, routes, routeKeys, distPath, outputPath, waitMs, signal, blockExternalRequests = false, screenshotBudget = { bytes: 0 } }) {
  const server = await startStaticServer(distPath);
  const context = await browser.newContext({
    viewport: SNAPSHOT_CONFIG.viewport,
    deviceScaleFactor: SNAPSHOT_CONFIG.deviceScaleFactor,
    locale: SNAPSHOT_CONFIG.locale,
    timezoneId: SNAPSHOT_CONFIG.timezoneId,
    serviceWorkers: blockExternalRequests ? 'block' : 'allow',
  });
  const captures = {};
  try {
    if (blockExternalRequests) {
      await context.route('**/*', async (route) => {
        const requestOrigin = new URL(route.request().url()).origin;
        if (requestOrigin === server.origin) await route.continue();
        else await route.abort('blockedbyclient');
      });
      await context.routeWebSocket(/.*/, (webSocket) => webSocket.close({ code: 1008, reason: 'External network disabled in PR preview.' }));
    }
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    page.setDefaultNavigationTimeout(SNAPSHOT_CONFIG.navigationTimeoutMs);
    page.setDefaultTimeout(SNAPSHOT_CONFIG.screenshotTimeoutMs);
    for (const route of routes) {
      signal?.throwIfAborted();
      const url = new URL(route, `${server.origin}/`).href;
      let response;
      try {
        response = await page.goto(url, { waitUntil: 'load' });
        if (!response?.ok()) throw new Error(`HTTP ${response?.status() ?? 'no response'}`);
        if (new URL(page.url()).origin !== server.origin) throw new Error('route redirected away from the local preview origin');
        await page.evaluate(async () => {
          if (document.fonts) {
            await Promise.race([document.fonts.ready, new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000))]);
          }
        });
        await page.waitForTimeout(waitMs);
        const intendedDimensions = validateScreenshotDimensions(await page.evaluate(() => ({
          width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0, window.innerWidth),
          height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0, window.innerHeight),
        })));
        const routeDirectory = join(outputPath, side, routeKeys[route]);
        await mkdir(routeDirectory, { recursive: true });
        const tiles = [];
        let totalBytes = 0;
        for (const plannedTile of createTilePlan(intendedDimensions)) {
          signal?.throwIfAborted();
          const { index, y, height } = plannedTile;
          const fileName = `tile-${String(index).padStart(3, '0')}.png`;
          const filePath = join(routeDirectory, fileName);
          // Chromium captures this document-coordinate rectangle directly. We do not
          // scroll between tiles, which avoids repeating fixed/sticky viewport UI.
          let timeout;
          const screenshot = await Promise.race([
            cdp.send('Page.captureScreenshot', {
              format: 'png',
              fromSurface: true,
              captureBeyondViewport: true,
              clip: { x: 0, y, width: intendedDimensions.width, height, scale: 1 },
            }),
            new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Tile screenshot timed out.')), SNAPSHOT_CONFIG.screenshotTimeoutMs); }),
          ]).finally(() => clearTimeout(timeout));
          await writeFile(filePath, Buffer.from(screenshot.data, 'base64'), { flag: 'wx' });
          const contents = await readFile(filePath);
          validatePngScreenshot(contents, SNAPSHOT_CONFIG, { width: intendedDimensions.width, height });
          totalBytes += contents.length;
          screenshotBudget.bytes += contents.length;
          if (totalBytes > SNAPSHOT_CONFIG.maximumTotalScreenshotBytes) {
            throw new Error(`Page screenshots exceed ${SNAPSHOT_CONFIG.maximumTotalScreenshotBytes} total bytes.`);
          }
          if (screenshotBudget.bytes > SNAPSHOT_CONFIG.maximumBundleScreenshotBytes) throw new Error('Snapshot bundle screenshots exceed total artifact bounds.');
          tiles.push({
            index, y, width: intendedDimensions.width, height,
            path: `${side}/${routeKeys[route]}/${fileName}`,
            sha256: await sha256File(filePath),
            bytes: contents.length,
          });
        }
        captures[route] = {
          width: intendedDimensions.width,
          height: intendedDimensions.height,
          tiles,
        };
      } catch (error) {
        throw new Error(`${side.toUpperCase()} ${sha.slice(0, 12)} route ${route} failed: ${error.message}`);
      }
    }
    return captures;
  } finally {
    await context.close();
    await server.close();
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

export function renderReviewPage(manifest) {
  const stack = (side, label, route) => `<div class="page-stack">${side.tiles.map((tile) => `<img src="${escapeHtml(tile.path)}" alt="${label} ${escapeHtml(route)}, tile ${tile.index + 1} of ${side.tiles.length}">`).join('')}</div>`;
  const comparisons = manifest.screenshots.map((item) => `
    <section>
      <h2>${escapeHtml(item.route)}</h2>
      <div class="comparison">
        <figure><figcaption>BEFORE</figcaption>${stack(item.before, 'Before', item.route)}</figure>
        <figure><figcaption>AFTER</figcaption>${stack(item.after, 'After', item.route)}</figure>
      </div>
    </section>`).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Contribution #${escapeHtml(manifest.contributionLabel)} snapshot</title>
<style>body{font:16px system-ui,sans-serif;margin:2rem;background:#f5f5f5;color:#171717}header,section{max-width:1800px;margin:0 auto 2rem}.comparison{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}figure{margin:0}figcaption{font-weight:700;margin-bottom:.5rem}.page-stack{line-height:0;background:white;border:1px solid #bbb;overflow:hidden}.page-stack img{display:block;width:100%;height:auto;margin:0;border:0}@media(max-width:800px){.comparison{grid-template-columns:1fr}}</style>
</head><body><header><h1>Contribution #${escapeHtml(manifest.contributionLabel)}</h1><p>BEFORE ${escapeHtml(manifest.git.before.slice(0, 12))} · AFTER ${escapeHtml(manifest.git.after.slice(0, 12))}</p></header>${comparisons}</body></html>`;
}

export function createCaptureId(now = new Date(), random = randomBytes(4).toString('hex')) {
  return `${now.toISOString().replace(/[:.]/g, '-')}--${random}`;
}

export function createBundlePaths(repoRoot, contributionNumber, captureId, artifactRoot = SNAPSHOT_CONFIG.artifactRoot) {
  const contributionLabel = formatContributionNumber(contributionNumber);
  const root = resolve(repoRoot, artifactRoot);
  const contributionRoot = join(root, `contribution-${contributionLabel}`);
  return {
    artifactRoot: root,
    contributionRoot,
    finalPath: join(contributionRoot, captureId),
    stagingPath: join(contributionRoot, `.staging-${captureId}`),
  };
}

export async function captureSnapshots(options) {
  const contributionNumber = Number(options.contributionNumber);
  formatContributionNumber(contributionNumber);
  const waitMs = options.waitMs ?? SNAPSHOT_CONFIG.defaultWaitMs;
  if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > SNAPSHOT_CONFIG.maximumWaitMs) {
    throw new Error(`--wait-ms must be an integer from 0 through ${SNAPSHOT_CONFIG.maximumWaitMs}.`);
  }
  const repoRoot = options.repoRoot ?? await resolveRepositoryRoot();
  const { beforeSha, afterSha } = await validateRevisionPair(repoRoot, options.before, options.after, options.signal);
  const canonicalRoutes = await readHistoricalRouteRegistry(repoRoot, afterSha, options.signal);
  const routeSelection = mergeSnapshotRoutes(canonicalRoutes, options.additionalRoutes ?? []);
  const routeKeys = createRouteKeyMap(routeSelection.capturedRoutes);
  const captureId = options.captureId ?? createCaptureId();
  const { contributionRoot, finalPath, stagingPath } = createBundlePaths(
    repoRoot,
    contributionNumber,
    captureId,
    options.artifactRoot,
  );
  if (await stat(finalPath).then(() => true).catch(() => false)) {
    throw new Error(`Snapshot bundle already exists and will not be overwritten: ${finalPath}`);
  }
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'wtt-snapshots-'));
  const beforeWorktree = join(temporaryRoot, 'before');
  const afterWorktree = join(temporaryRoot, 'after');
  let beforeAdded = false;
  let afterAdded = false;
  let browser;
  try {
    await mkdir(join(stagingPath, 'before'), { recursive: true });
    await mkdir(join(stagingPath, 'after'), { recursive: true });
    await addWorktree(repoRoot, beforeWorktree, beforeSha);
    beforeAdded = true;
    await addWorktree(repoRoot, afterWorktree, afterSha);
    afterAdded = true;
    const buildController = new AbortController();
    const buildSignal = options.signal
      ? AbortSignal.any([options.signal, buildController.signal])
      : buildController.signal;
    const guardedBuild = (worktree) => buildHistoricalRevision(worktree, buildSignal).catch((error) => {
      buildController.abort(error);
      throw error;
    });
    const buildResults = await Promise.allSettled([
      guardedBuild(beforeWorktree),
      guardedBuild(afterWorktree),
    ]);
    const failedBuild = buildResults.find((result) => result.status === 'rejected');
    if (failedBuild) throw failedBuild.reason;
    const [beforeDist, afterDist] = buildResults.map((result) => result.value);
    try {
      browser = await chromium.launch({ headless: true });
    } catch (error) {
      throw new Error(`Playwright Chromium could not start. Run "npx playwright install chromium" once, then retry. Cause: ${error.message}`);
    }
    const screenshotBudget = { bytes: 0 };
    const beforeChecksums = await captureRevision({ browser, side: 'before', sha: beforeSha, routes: routeSelection.capturedRoutes, routeKeys, distPath: beforeDist, outputPath: stagingPath, waitMs, signal: options.signal, screenshotBudget });
    const afterChecksums = await captureRevision({ browser, side: 'after', sha: afterSha, routes: routeSelection.capturedRoutes, routeKeys, distPath: afterDist, outputPath: stagingPath, waitMs, signal: options.signal, screenshotBudget });
    const manifest = buildSnapshotManifest({
      contributionNumber,
      captureId,
      capturedAt: new Date().toISOString(),
      beforeSha,
      afterSha,
      ...routeSelection,
      waitMs,
      checksums: { before: beforeChecksums, after: afterChecksums },
    });
    const serializedManifest = `${JSON.stringify(manifest, null, 2)}\n`;
    if (Buffer.byteLength(serializedManifest) > SNAPSHOT_CONFIG.maximumManifestBytes) {
      throw new Error(`Snapshot manifest exceeds ${SNAPSHOT_CONFIG.maximumManifestBytes} bytes.`);
    }
    await writeFile(join(stagingPath, 'manifest.json'), serializedManifest, { flag: 'wx' });
    await writeFile(join(stagingPath, 'index.html'), renderReviewPage(manifest), { flag: 'wx' });
    await verifySnapshotBundle(stagingPath);
    await mkdir(contributionRoot, { recursive: true });
    await rename(stagingPath, finalPath);
    return { bundlePath: finalPath, manifest };
  } catch (error) {
    await rm(stagingPath, { recursive: true, force: true });
    throw error;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (afterAdded) await removeWorktree(repoRoot, afterWorktree);
    if (beforeAdded) await removeWorktree(repoRoot, beforeWorktree);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
