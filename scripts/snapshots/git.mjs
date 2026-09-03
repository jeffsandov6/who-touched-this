import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SNAPSHOT_CONFIG } from './config.mjs';
import { validateCanonicalRouteRegistry } from './routes.mjs';

const execFileAsync = promisify(execFile);

export async function runGit(repoRoot, args, options = {}) {
  try {
    const result = await execFileAsync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      signal: options.signal,
    });
    return result.stdout.trim();
  } catch (error) {
    const detail = error.stderr?.trim() || error.message;
    throw new Error(`git ${args.join(' ')} failed: ${detail}`);
  }
}

export async function resolveRepositoryRoot(cwd = process.cwd()) {
  return runGit(cwd, ['rev-parse', '--show-toplevel']);
}

export async function resolveCommit(repoRoot, revision, signal) {
  if (typeof revision !== 'string' || revision.trim() === '') {
    throw new Error('A Git revision is required.');
  }
  return runGit(repoRoot, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`], { signal });
}

export async function validateRevisionPair(repoRoot, beforeRevision, afterRevision, signal) {
  const [beforeSha, afterSha] = await Promise.all([
    resolveCommit(repoRoot, beforeRevision, signal),
    resolveCommit(repoRoot, afterRevision, signal),
  ]);
  if (beforeSha === afterSha) throw new Error('BEFORE and AFTER must resolve to different commits.');
  try {
    await execFileAsync('git', ['merge-base', '--is-ancestor', beforeSha, afterSha], {
      cwd: repoRoot,
      signal,
    });
  } catch (error) {
    if (error.code === 1) throw new Error('BEFORE must be an ancestor of AFTER.');
    throw error;
  }
  return { beforeSha, afterSha };
}

export async function readHistoricalRouteRegistry(repoRoot, afterSha, signal) {
  let raw;
  try {
    raw = await runGit(repoRoot, ['show', `${afterSha}:${SNAPSHOT_CONFIG.routeRegistryPath}`], { signal });
  } catch (error) {
    throw new Error(`AFTER revision ${afterSha} does not contain ${SNAPSHOT_CONFIG.routeRegistryPath}. Fetch the required canonical commit or use a post-Milestone-14 revision. Cause: ${error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Historical route registry in AFTER revision ${afterSha} is not valid JSON.`);
  }
  return validateCanonicalRouteRegistry(parsed, `${SNAPSHOT_CONFIG.routeRegistryPath} at ${afterSha}`);
}
