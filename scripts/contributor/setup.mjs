import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export const CANONICAL_REPOSITORY = 'jeffsandov6/who-touched-this';
export const CANONICAL_HTTPS_REMOTE = `https://github.com/${CANONICAL_REPOSITORY}.git`;
export const CANONICAL_SSH_REMOTE = `git@github.com:${CANONICAL_REPOSITORY}.git`;

function cleanRepositoryPath(value) {
  return value.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
}

export function parseGitHubRemote(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const remote = value.trim();
  let repository;
  let transport;

  const scp = remote.match(/^git@github\.com:([^?#]+)$/i);
  if (scp) {
    repository = cleanRepositoryPath(scp[1]);
    transport = 'ssh';
  } else {
    let url;
    try { url = new URL(remote); } catch { return undefined; }
    if (url.hostname.toLowerCase() !== 'github.com' || url.search || url.hash) return undefined;
    if (url.protocol === 'https:' && !url.username && !url.password) transport = 'https';
    else if (url.protocol === 'ssh:' && url.username === 'git' && !url.password) transport = 'ssh';
    else return undefined;
    repository = cleanRepositoryPath(url.pathname);
  }

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) return undefined;
  const [owner, name] = repository.split('/');
  return Object.freeze({ owner, name, repository: `${owner}/${name}`, transport });
}

export function classifyOrigin(value) {
  const parsed = parseGitHubRemote(value);
  if (!parsed) return { kind: 'invalid' };
  if (parsed.repository.toLowerCase() === CANONICAL_REPOSITORY.toLowerCase()) {
    return { kind: 'canonical', ...parsed };
  }
  if (parsed.name.toLowerCase() === 'who-touched-this') return { kind: 'fork', ...parsed };
  return { kind: 'unrelated', ...parsed };
}

function parseVersion(value, label) {
  const match = String(value).trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`Unable to parse ${label} version: ${value}`);
  return match.slice(1).map(Number);
}

function minimumVersion(engine, label) {
  const match = String(engine ?? '').match(/^>=(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`${label} engine must use a simple >=major.minor.patch requirement.`);
  return match.slice(1).map(Number);
}

function atLeast(actual, minimum) {
  return actual[0] > minimum[0]
    || (actual[0] === minimum[0] && (actual[1] > minimum[1]
      || (actual[1] === minimum[1] && actual[2] >= minimum[2])));
}

export function validateRuntimeVersions({ nodeVersion, npmVersion, engines, nvmrc }) {
  const nodeMinimum = minimumVersion(engines?.node, 'Node.js');
  const npmMinimum = minimumVersion(engines?.npm, 'npm');
  const expectedNodeMajor = Number(String(nvmrc).trim());
  if (!Number.isSafeInteger(expectedNodeMajor) || expectedNodeMajor !== nodeMinimum[0]) {
    throw new Error('.nvmrc and package.json Node.js requirements disagree.');
  }
  if (!atLeast(parseVersion(nodeVersion, 'Node.js'), nodeMinimum)) {
    throw new Error(`Node.js ${nodeMinimum.join('.')} or newer is required. Run \`nvm use\` or install a supported Node.js release.`);
  }
  if (!atLeast(parseVersion(npmVersion, 'npm'), npmMinimum)) {
    throw new Error(`npm ${npmMinimum.join('.')} or newer is required.`);
  }
  return true;
}

async function command(commandName, args, options = {}) {
  return exec(commandName, args, { encoding: 'utf8', ...options });
}

async function git(cwd, args) {
  try { return (await command('git', args, { cwd })).stdout.trim(); }
  catch (error) {
    const detail = error.stderr?.trim();
    throw new Error(detail || `git ${args.join(' ')} failed.`);
  }
}

async function remoteUrl(cwd, name) {
  try { return await git(cwd, ['remote', 'get-url', name]); }
  catch { return undefined; }
}

export async function runContributorSetup({
  cwd = process.cwd(),
  install = true,
  nodeVersion = process.version,
  npmVersion,
  output = console.log,
  runCommand = command,
} = {}) {
  let root;
  try { root = await git(cwd, ['rev-parse', '--show-toplevel']); }
  catch { throw new Error('Run this command inside your cloned who-touched-this fork.'); }

  const originUrl = await remoteUrl(root, 'origin');
  const origin = classifyOrigin(originUrl);
  if (origin.kind === 'canonical') {
    throw new Error('origin points to jeffsandov6/who-touched-this. Ordinary contributors must clone their own fork and use the canonical repository as upstream.');
  }
  if (origin.kind !== 'fork') {
    throw new Error('origin must point to YOUR_GITHUB_USERNAME/who-touched-this on GitHub. No remotes were changed.');
  }

  const existingUpstream = await remoteUrl(root, 'upstream');
  if (existingUpstream) {
    const upstream = parseGitHubRemote(existingUpstream);
    if (upstream?.repository.toLowerCase() !== CANONICAL_REPOSITORY.toLowerCase()) {
      throw new Error(`upstream already points to ${existingUpstream}. It was not replaced; inspect it with \`git remote -v\`.`);
    }
    output(`✓ upstream already points to ${CANONICAL_REPOSITORY}`);
  } else {
    const canonical = origin.transport === 'ssh' ? CANONICAL_SSH_REMOTE : CANONICAL_HTTPS_REMOTE;
    await git(root, ['remote', 'add', 'upstream', canonical]);
    output(`✓ added upstream ${canonical}`);
  }

  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const nvmrc = await readFile(join(root, '.nvmrc'), 'utf8');
  let detectedNpmVersion = npmVersion;
  if (!detectedNpmVersion) detectedNpmVersion = (await runCommand(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'], { cwd: root })).stdout.trim();
  validateRuntimeVersions({ nodeVersion, npmVersion: detectedNpmVersion, engines: packageJson.engines, nvmrc });
  output(`✓ Node.js ${String(nodeVersion).replace(/^v/, '')} & npm ${detectedNpmVersion} satisfy package.json`);

  if (install) {
    output('Installing dependencies from package-lock.json with npm ci...');
    await runCommand(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci'], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
    output('✓ dependencies installed');
  }

  output('✓ contributor preview needs no .env or production credentials');
  output('\nnext: sync main, create a contribution branch, then run npm run dev:contributor');
  return { root, origin: origin.repository, upstream: CANONICAL_REPOSITORY, installed: install };
}
