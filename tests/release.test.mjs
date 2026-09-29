import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import packageJson from '../package.json' with { type: 'json' };
import { startStaticServer } from '../scripts/snapshots/capture.mjs';
import { robotsMetaContent, robotsText } from '../src/platform/config/site-indexing.ts';
import { scanProductionArtifact } from '../scripts/release/artifact-scan.mjs';
import { firebaseDeployArguments, RELEASE_CONFIG } from '../scripts/release/config.mjs';
import { normalizeOrigin, validateNodeVersion, validateProductionEnvironment, validateProductionSolanaRpcUrl } from '../scripts/release/environment.mjs';
import { runReleasePreflight, validateRepositoryState } from '../scripts/release/preflight.mjs';
import { isAllowedRedirect, runReadOnlySmoke, smokeRoutes, validateSmokeOrigin } from '../scripts/release/smoke.mjs';

const browser = {
  PUBLIC_FIREBASE_API_KEY: 'synthetic-web-api-key',
  PUBLIC_FIREBASE_AUTH_DOMAIN: 'who-touched-this.firebaseapp.com',
  PUBLIC_FIREBASE_PROJECT_ID: 'who-touched-this',
  PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '1234567890',
  PUBLIC_FIREBASE_APP_ID: '1:1234567890:web:abcdef',
  PUBLIC_FIREBASE_STORAGE_BUCKET: 'who-touched-this.firebasestorage.app',
  PUBLIC_USE_FIREBASE_EMULATORS: 'false',
  PUBLIC_SITE_INDEXING_ENABLED: 'false',
  APP_ORIGIN: 'https://whotouchedthis.website',
};
const functionsConfig = {
  EMAIL_PROVIDER_MODE: 'resend', APP_ORIGIN: 'https://whotouchedthis.website',
  GITHUB_REPOSITORY: 'jeffsandov6/who-touched-this', GITHUB_BASE_BRANCH: 'main',
  WTT_SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com',
};

test('production identity contract accepts only the intended project and HTTPS origin', () => {
  assert.equal(RELEASE_CONFIG.projectId, 'who-touched-this');
  assert.doesNotThrow(() => validateProductionEnvironment(browser, functionsConfig));
  assert.equal(normalizeOrigin('https://whotouchedthis.website/'), RELEASE_CONFIG.origin);
  assert.throws(() => validateProductionEnvironment({ ...browser, PUBLIC_FIREBASE_PROJECT_ID: 'wrong-project' }, functionsConfig), /who-touched-this/);
  assert.throws(() => validateProductionEnvironment({ ...browser, PUBLIC_FIREBASE_PROJECT_ID: 'demo-who-touched-this' }, functionsConfig), /placeholder|who-touched-this/);
  assert.throws(() => validateProductionEnvironment({ ...browser, PUBLIC_USE_FIREBASE_EMULATORS: 'true' }, functionsConfig), /emulator/);
  assert.throws(() => validateProductionEnvironment({ ...browser, PUBLIC_FIREBASE_API_KEY: '' }, functionsConfig), /Missing/);
  assert.throws(() => validateProductionEnvironment({ ...browser, APP_ORIGIN: 'http://whotouchedthis.website' }, functionsConfig), /HTTPS/);
  assert.throws(() => validateProductionEnvironment({ ...browser, APP_ORIGIN: 'http://localhost:4321' }, functionsConfig), /HTTPS/);
  assert.throws(() => validateProductionEnvironment({ ...browser, PUBLIC_CONTRIBUTOR_PREVIEW: 'true' }, functionsConfig), /preview/);
});

test('repository and Node policies require clean main and Node 22.12+', () => {
  const root = '/repo';
  const valid = { topLevel: root, sha: 'a'.repeat(40), branch: 'main', clean: true };
  assert.doesNotThrow(() => validateRepositoryState(valid, root));
  assert.throws(() => validateRepositoryState({ ...valid, clean: false }, root), /clean/);
  assert.throws(() => validateRepositoryState({ ...valid, branch: 'release/test' }, root), /main/);
  assert.equal(validateNodeVersion('v22.12.0'), true);
  assert.equal(validateNodeVersion('22.99.1'), true);
  assert.throws(() => validateNodeVersion('v22.11.0'), /22\.12/);
  assert.throws(() => validateNodeVersion('v24.0.0'), /Node.js 22/);
});

test('production WTT RPC configuration rejects non-mainnet and local endpoints', () => {
  assert.equal(validateProductionSolanaRpcUrl('https://api.mainnet-beta.solana.com'), 'https://api.mainnet-beta.solana.com/');
  for (const value of [
    'http://api.mainnet-beta.solana.com', 'https://api.devnet.solana.com',
    'https://api.testnet.solana.com', 'https://localhost:8899',
    'https://127.0.0.1:8899', 'https://user:secret@rpc.example.com',
  ]) assert.throws(() => validateProductionSolanaRpcUrl(value), /mainnet|HTTPS/);
});

test('production artifact scan rejects emulator, localhost, preview, and server-secret markers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wtt-release-artifact-'));
  try {
    await writeFile(join(root, 'index.html'), '<title>Who Touched This</title>');
    assert.equal((await scanProductionArtifact(root)).filesScanned, 1);
    for (const marker of ['localhost:9099', '127.0.0.1:8080', 'demo-who-touched-this', 'Local canvas preview', 'GITHUB_WEBHOOK_SECRET']) {
      await writeFile(join(root, 'index.html'), marker);
      await assert.rejects(scanProductionArtifact(root), /forbidden/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('indexing helpers produce pre-launch noindex/disallow and launch allow behavior', () => {
  assert.equal(robotsMetaContent('false'), 'noindex, nofollow');
  assert.match(robotsText('false'), /Disallow: \//);
  assert.equal(robotsMetaContent('true'), undefined);
  assert.match(robotsText('true'), /Allow: \//);
});

test('smoke route set combines canonical editable and public platform routes', () => {
  assert.deepEqual(smokeRoutes(), ['/', '/random', '/thoughts', '/history', '/faq', '/rules', '/join', '/wtt/claim']);
  assert.throws(() => validateSmokeOrigin('https://example.com'), /must be/);
  assert.throws(() => validateSmokeOrigin('http://whotouchedthis.website'), /must be/);
  assert.equal(validateSmokeOrigin(RELEASE_CONFIG.origin), RELEASE_CONFIG.origin);
  assert.equal(isAllowedRedirect(`${RELEASE_CONFIG.origin}/`, '/faq', RELEASE_CONFIG.origin), true);
  assert.equal(isAllowedRedirect(`${RELEASE_CONFIG.origin}/`, 'https://example.com', RELEASE_CONFIG.origin), false);
});

test('read-only smoke uses only GET, validates indexing, and fails HTTP errors', async () => {
  const methods = [];
  const okFetch = async (_url, init) => {
    methods.push(init.method);
    return new Response('<!doctype html><title>Who Touched This</title><meta name="robots" content="noindex, nofollow">', { status: 200, headers: { 'content-type': 'text/html' } });
  };
  const routes = await runReadOnlySmoke({ origin: 'http://127.0.0.1:4321', expectedIndexing: 'disabled', fetchImpl: okFetch, allowLocal: true });
  assert.equal(routes.length, 8);
  assert.deepEqual(new Set(methods), new Set(['GET']));
  await assert.rejects(runReadOnlySmoke({ origin: 'http://127.0.0.1:4321', expectedIndexing: 'disabled', allowLocal: true, fetchImpl: async () => new Response('no', { status: 500, headers: { 'content-type': 'text/html' } }) }), /HTTP 500/);
});

test('read-only smoke succeeds against a local static eight-route fixture', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wtt-smoke-fixture-'));
  let server;
  try {
    const html = '<!doctype html><title>Who Touched This</title><meta name="robots" content="noindex, nofollow">';
    for (const route of smokeRoutes()) {
      const directory = route === '/' ? root : join(root, route.slice(1));
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'index.html'), html);
    }
    server = await startStaticServer(root);
    const routes = await runReadOnlySmoke({ origin: server.origin, expectedIndexing: 'disabled', allowLocal: true });
    assert.deepEqual(routes, smokeRoutes());
  } finally {
    if (server) await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('deploy commands and package scripts always pin project and hosting runs production preflight', () => {
  for (const service of ['firestore,storage', 'functions', 'hosting']) {
    assert.deepEqual(firebaseDeployArguments(service).slice(-2), ['--project', 'who-touched-this']);
  }
  for (const name of ['deploy:rules', 'deploy:functions', 'deploy:hosting']) assert.match(packageJson.scripts[name], /--project who-touched-this/);
  assert.match(packageJson.scripts['deploy:hosting'], /release:preflight/);
  assert.doesNotMatch(packageJson.scripts['deploy:hosting'], /build:contributor/);
});

test('server secret names are non-public, contributor commands remain secretless, and CI has no deploy', async () => {
  assert.ok(RELEASE_CONFIG.secretNames.every((name) => !name.startsWith('PUBLIC_')));
  assert.doesNotMatch(packageJson.scripts['dev:contributor'], /FIREBASE|RESEND|GITHUB_WEBHOOK_SECRET/);
  assert.doesNotMatch(packageJson.scripts['build:contributor'], /FIREBASE|RESEND|GITHUB_WEBHOOK_SECRET/);
  const workflows = await Promise.all(['.github/workflows/contributor-build.yml', '.github/workflows/contribution-boundary.yml'].map((path) => import('node:fs/promises').then(({ readFile }) => readFile(path, 'utf8'))));
  assert.doesNotMatch(workflows.join('\n'), /firebase deploy|deploy:hosting|RESEND_API_KEY|GITHUB_WEBHOOK_SECRET/);
  const snapshotSources = await import('node:fs/promises').then(({ readFile }) => Promise.all(['scripts/capture-snapshots.mjs', 'scripts/snapshots/capture.mjs'].map((path) => readFile(path, 'utf8'))));
  assert.doesNotMatch(snapshotSources.join('\n'), /firebase deploy|firebase-admin|historyEvents|contributions\//);
});

test('release preflight succeeds with synthetic production config and mocked commands', async () => {
  const commands = [];
  const repoRoot = resolve('.');
  const result = await runReleasePreflight({
    repoRoot, browserEnvironment: browser, functionsEnvironment: functionsConfig,
    inspectRepository: async () => ({ topLevel: repoRoot, sha: 'b'.repeat(40), branch: 'main', clean: true }),
    runCommand: async (command, args) => commands.push([command, ...args].join(' ')),
    scanArtifact: async () => ({ filesScanned: 7 }), nodeVersion: 'v22.12.0',
  });
  assert.equal(result.projectId, 'who-touched-this');
  assert.equal(result.indexingEnabled, false);
  assert.ok(commands.includes('npm run build'));
  assert.ok(!commands.some((command) => command.includes('build:contributor')));
});
