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
import { sha256File } from './integrity.mjs';
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

async function buildHistoricalRevision(worktreePath, signal) {
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

async function captureRevision({ browser, side, sha, routes, routeKeys, distPath, outputPath, waitMs, signal }) {
  const server = await startStaticServer(distPath);
  const context = await browser.newContext({
    viewport: SNAPSHOT_CONFIG.viewport,
    deviceScaleFactor: SNAPSHOT_CONFIG.deviceScaleFactor,
    locale: SNAPSHOT_CONFIG.locale,
    timezoneId: SNAPSHOT_CONFIG.timezoneId,
  });
  const checksums = {};
  try {
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(SNAPSHOT_CONFIG.navigationTimeoutMs);
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
        const filePath = join(outputPath, side, `${routeKeys[route]}.png`);
        await page.screenshot({ path: filePath, fullPage: SNAPSHOT_CONFIG.fullPage, type: 'png' });
        checksums[route] = await sha256File(filePath);
      } catch (error) {
        throw new Error(`${side.toUpperCase()} ${sha.slice(0, 12)} route ${route} failed: ${error.message}`);
      }
    }
    return checksums;
  } finally {
    await context.close();
    await server.close();
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

export function renderReviewPage(manifest) {
  const comparisons = manifest.screenshots.map((item) => `
    <section>
      <h2>${escapeHtml(item.route)}</h2>
      <div class="comparison">
        <figure><figcaption>BEFORE</figcaption><img src="${escapeHtml(item.before.path)}" alt="Before ${escapeHtml(item.route)}"></figure>
        <figure><figcaption>AFTER</figcaption><img src="${escapeHtml(item.after.path)}" alt="After ${escapeHtml(item.route)}"></figure>
      </div>
    </section>`).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Contribution #${escapeHtml(manifest.contributionLabel)} snapshot</title>
<style>body{font:16px system-ui,sans-serif;margin:2rem;background:#f5f5f5;color:#171717}header,section{max-width:1800px;margin:0 auto 2rem}.comparison{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}figure{margin:0}figcaption{font-weight:700;margin-bottom:.5rem}img{display:block;width:100%;height:auto;background:white;border:1px solid #bbb}@media(max-width:800px){.comparison{grid-template-columns:1fr}}</style>
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
    const beforeChecksums = await captureRevision({ browser, side: 'before', sha: beforeSha, routes: routeSelection.capturedRoutes, routeKeys, distPath: beforeDist, outputPath: stagingPath, waitMs, signal: options.signal });
    const afterChecksums = await captureRevision({ browser, side: 'after', sha: afterSha, routes: routeSelection.capturedRoutes, routeKeys, distPath: afterDist, outputPath: stagingPath, waitMs, signal: options.signal });
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
    await writeFile(join(stagingPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
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
