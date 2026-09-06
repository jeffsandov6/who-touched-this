import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { scanProductionArtifact } from './artifact-scan.mjs';
import { RELEASE_CONFIG } from './config.mjs';
import { validateNodeVersion, validateProductionEnvironment } from './environment.mjs';

const exec = promisify(execFile);

export async function inspectReleaseRepository(repoRoot) {
  const git = async (args) => (await exec('git', args, { cwd: repoRoot, encoding: 'utf8' })).stdout.trim();
  const [topLevel, sha, branch, status] = await Promise.all([
    git(['rev-parse', '--show-toplevel']), git(['rev-parse', 'HEAD']),
    git(['branch', '--show-current']), git(['status', '--porcelain']),
  ]);
  return { topLevel, sha, branch, clean: status === '' };
}

export function validateRepositoryState(state, repoRoot) {
  if (state.topLevel !== repoRoot) throw new Error('Release preflight is not running at the expected repository root.');
  if (!/^[0-9a-f]{40}$/.test(state.sha)) throw new Error('Current HEAD does not resolve to a full commit SHA.');
  if (!state.clean) throw new Error('Release preflight requires a clean working tree.');
  if (state.branch !== 'main') throw new Error('Production releases must run from main.');
}

export async function validateFirebaseFiles(repoRoot) {
  const aliases = JSON.parse(await readFile(join(repoRoot, '.firebaserc'), 'utf8'));
  const firebase = JSON.parse(await readFile(join(repoRoot, 'firebase.json'), 'utf8'));
  if (aliases.projects?.default !== RELEASE_CONFIG.projectId) throw new Error(`.firebaserc must target ${RELEASE_CONFIG.projectId}.`);
  if (!firebase.firestore?.rules || !firebase.firestore?.indexes || !firebase.storage?.rules
    || firebase.functions?.runtime !== 'nodejs22' || firebase.hosting?.public !== 'dist') {
    throw new Error('firebase.json does not contain the expected Firestore, Storage, Functions, and Hosting contract.');
  }
}

export async function validateSecretBindings(repoRoot) {
  const source = await readFile(join(repoRoot, 'functions/src/config.ts'), 'utf8');
  for (const name of RELEASE_CONFIG.secretNames) {
    if (!source.includes(`defineSecret('${name}')`)) throw new Error(`Functions source is missing the ${name} Secret Manager binding.`);
    if (name.startsWith('PUBLIC_')) throw new Error('Server secret names must never use PUBLIC_.');
  }
}

export async function runReleasePreflight(options) {
  validateNodeVersion(options.nodeVersion ?? process.version);
  const environment = validateProductionEnvironment(options.browserEnvironment, options.functionsEnvironment);
  const state = await (options.inspectRepository ?? inspectReleaseRepository)(options.repoRoot);
  validateRepositoryState(state, options.repoRoot);
  await validateFirebaseFiles(options.repoRoot);
  await validateSecretBindings(options.repoRoot);
  const run = options.runCommand ?? (async (command, args) => exec(command, args, { cwd: options.repoRoot, env: { ...process.env, ...options.browserEnvironment }, maxBuffer: 30 * 1024 * 1024 }));
  const commands = [
    ['npm', ['run', 'check']], ['npm', ['run', 'build']],
    ['npm', ['run', 'functions:check']], ['npm', ['run', 'functions:build']],
    ['npm', ['run', 'test:contributor']], ['npm', ['run', 'functions:test']],
    ['npm', ['run', 'test:contribution-validator']], ['npm', ['run', 'test:snapshots']],
    ['npm', ['run', 'test:release']],
  ];
  for (const [command, args] of commands) await run(command, args);
  const artifact = await (options.scanArtifact ?? scanProductionArtifact)(join(options.repoRoot, 'dist'));
  return { projectId: RELEASE_CONFIG.projectId, origin: RELEASE_CONFIG.origin, sha: state.sha, branch: state.branch, indexingEnabled: environment.indexingEnabled, artifact };
}
