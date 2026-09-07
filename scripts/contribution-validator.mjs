import { open, lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CONTRIBUTION_BOUNDARIES } from '../src/platform/config/contribution-boundaries.ts';

export const CONTRIBUTION_LIMITS = Object.freeze({
  maxFileBytes: 25 * 1024 * 1024,
  maxAggregateMediaBytes: 50 * 1024 * 1024,
  advisoryChangedFiles: 12,
  advisoryChangedLines: 800,
});

const MEDIA_EXTENSIONS = new Set([
  '.apng', '.avif', '.bmp', '.gif', '.ico', '.jpeg', '.jpg', '.png', '.svg', '.webp',
  '.aac', '.flac', '.m4a', '.mp3', '.oga', '.ogg', '.opus', '.wav',
  '.m4v', '.mov', '.mp4', '.ogv', '.webm',
  '.eot', '.otf', '.ttf', '.woff', '.woff2',
]);

export function isEditableCanvasPath(filePath) {
  if (typeof filePath !== 'string') return false;
  return CONTRIBUTION_BOUNDARIES.editableAreas.some((pattern) => {
    const prefix = pattern.endsWith('/**') ? pattern.slice(0, -2) : pattern;
    return filePath.startsWith(prefix) && filePath.length > prefix.length;
  });
}

export function isSensitiveCanvasPath(filePath) {
  if (typeof filePath !== 'string') return true;
  const name = path.posix.basename(filePath).toLowerCase();
  return name === '.env'
    || name.startsWith('.env.')
    || name === '.npmrc'
    || name === '.netrc'
    || name === 'id_rsa'
    || name === 'id_ed25519'
    || name.endsWith('.pem')
    || name.endsWith('.key')
    || /(?:service[-_]?account|firebase[-_]?adminsdk).*(?:\.json)?$/i.test(name);
}

export function isMediaPath(filePath) {
  if (typeof filePath !== 'string') return false;
  return MEDIA_EXTENSIONS.has(path.posix.extname(filePath).toLowerCase());
}

export function evaluateContribution(changes, totals = {}) {
  const failures = [];
  const warnings = [];
  let aggregateMediaBytes = 0;

  for (const change of changes) {
    for (const touchedPath of change.paths) {
      if (!isEditableCanvasPath(touchedPath)) {
        failures.push(`Protected path modified: ${touchedPath}`);
      }
    }

    if (!change.targetPath) continue;
    if (isSensitiveCanvasPath(change.targetPath)) {
      failures.push(`Sensitive or credential-like filename is not allowed: ${change.targetPath}`);
    }
    if (change.mode === '120000') {
      failures.push(`Symbolic links are not allowed: ${change.targetPath}`);
    } else if (change.mode === '160000') {
      failures.push(`Git submodules/gitlinks are not allowed: ${change.targetPath}`);
    } else if (change.mode && change.mode !== '100644' && change.mode !== '100755') {
      failures.push(`Unsupported Git object mode ${change.mode}: ${change.targetPath}`);
    } else if (!change.mode) {
      failures.push(`Could not verify a regular file object: ${change.targetPath}`);
    }

    if (Number.isFinite(change.size) && change.size > CONTRIBUTION_LIMITS.maxFileBytes) {
      failures.push(`File exceeds 25 MiB: ${change.targetPath}`);
    }
    if (change.binaryOrMedia && Number.isFinite(change.size)) aggregateMediaBytes += change.size;
  }

  if (aggregateMediaBytes > CONTRIBUTION_LIMITS.maxAggregateMediaBytes) {
    failures.push('Aggregate changed/added binary and media size exceeds 50 MiB.');
  }

  const additions = totals.additions ?? changes.reduce((sum, item) => sum + (item.additions ?? 0), 0);
  const deletions = totals.deletions ?? changes.reduce((sum, item) => sum + (item.deletions ?? 0), 0);
  if (changes.length > CONTRIBUTION_LIMITS.advisoryChangedFiles) {
    warnings.push(`Scope includes ${changes.length} files; consider keeping it at 12 or fewer.`);
  }
  if (additions + deletions > CONTRIBUTION_LIMITS.advisoryChangedLines) {
    warnings.push(`Scope changes ${additions + deletions} text lines; consider keeping it at 800 or fewer.`);
  }

  return {
    passed: failures.length === 0,
    failures,
    warnings,
    scope: { changedFiles: changes.length, additions, deletions, aggregateMediaBytes },
  };
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

function parseNameStatus(output) {
  const tokens = output.split('\0');
  if (tokens.at(-1) === '') tokens.pop();
  const records = [];
  for (let index = 0; index < tokens.length;) {
    const statusToken = tokens[index++];
    const status = statusToken[0];
    if (status === 'R' || status === 'C') {
      const source = tokens[index++];
      const target = tokens[index++];
      records.push({ status, paths: [source, target], targetPath: target });
    } else {
      const filePath = tokens[index++];
      records.push({ status, paths: [filePath], targetPath: status === 'D' ? null : filePath });
    }
  }
  return records;
}

function indexModes(cwd) {
  const output = git(['ls-files', '--stage', '-z'], cwd);
  const modes = new Map();
  for (const entry of output.split('\0')) {
    if (!entry) continue;
    const match = entry.match(/^(\d+) [0-9a-f]+ \d+\t([\s\S]+)$/);
    if (match) modes.set(match[2], match[1]);
  }
  return modes;
}

async function looksBinary(filePath) {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(8 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}

async function inspectLocalTarget(cwd, targetPath, modeFromIndex) {
  const absolutePath = path.join(cwd, ...targetPath.split('/'));
  const stats = await lstat(absolutePath);
  if (stats.isSymbolicLink()) return { mode: '120000', size: stats.size, binaryOrMedia: false };
  if (modeFromIndex === '160000') return { mode: '160000', size: 0, binaryOrMedia: false };
  if (!stats.isFile()) return { mode: modeFromIndex ?? null, size: stats.size, binaryOrMedia: false };
  return {
    mode: modeFromIndex === '100755' ? '100755' : '100644',
    size: stats.size,
    binaryOrMedia: isMediaPath(targetPath) || await looksBinary(absolutePath),
  };
}

function parseShortStat(output) {
  return {
    additions: Number(output.match(/(\d+) insertion/)?.[1] ?? 0),
    deletions: Number(output.match(/(\d+) deletion/)?.[1] ?? 0),
  };
}

async function countTextLines(filePath) {
  const contents = await readFile(filePath);
  if (contents.includes(0)) return 0;
  if (contents.length === 0) return 0;
  return contents.toString('utf8').split(/\r?\n/).length;
}

export async function collectLocalContribution(base, cwd = process.cwd()) {
  git(['rev-parse', '--verify', `${base}^{commit}`], cwd);
  const tracked = parseNameStatus(git([
    'diff', '--name-status', '-z', '--find-renames=50%', '--find-copies=50%', base, '--',
  ], cwd));
  const trackedPaths = new Set(tracked.flatMap((record) => record.paths));
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'], cwd)
    .split('\0')
    .filter(Boolean)
    .filter((filePath) => !trackedPaths.has(filePath))
    .map((filePath) => ({ status: 'A', paths: [filePath], targetPath: filePath, untracked: true }));
  const modes = indexModes(cwd);
  const changes = [];
  let untrackedAdditions = 0;

  for (const record of [...tracked, ...untracked]) {
    let metadata = { mode: null, size: null, binaryOrMedia: false };
    if (record.targetPath) {
      try {
        metadata = await inspectLocalTarget(cwd, record.targetPath, modes.get(record.targetPath));
        if (record.untracked && metadata.mode && metadata.mode !== '120000' && metadata.size <= CONTRIBUTION_LIMITS.maxFileBytes) {
          untrackedAdditions += await countTextLines(path.join(cwd, ...record.targetPath.split('/')));
        }
      } catch {
        // The evaluator reports an unverifiable/non-regular target as a hard failure.
      }
    }
    changes.push({ ...record, ...metadata, additions: 0, deletions: 0 });
  }

  const totals = parseShortStat(git(['diff', '--shortstat', base, '--'], cwd));
  totals.additions += untrackedAdditions;
  return { changes, totals };
}

async function githubRequest(apiUrl, token, pathname, operation, request) {
  let response;
  try {
    response = await request(`${apiUrl}${pathname}`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'who-touched-this-contribution-validator',
      },
    });
  } catch {
    throw new Error(`${operation} request failed.`);
  }
  if (!response?.ok) {
    const status = Number.isInteger(response?.status) ? ` with HTTP ${response.status}` : '';
    throw new Error(`${operation} request failed${status}.`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${operation} returned malformed JSON.`);
  }
}

export async function collectGitHubContribution(eventPath, environment = process.env, request = fetch) {
  const event = JSON.parse(await readFile(eventPath, 'utf8'));
  const repository = event.repository?.full_name;
  const number = event.pull_request?.number ?? event.number;
  const headSha = event.pull_request?.head?.sha;
  const token = environment.GITHUB_TOKEN;
  const apiUrl = environment.GITHUB_API_URL ?? 'https://api.github.com';
  if (typeof repository !== 'string' || repository.split('/').length !== 2
    || !Number.isSafeInteger(number) || number < 1
    || typeof headSha !== 'string' || !/^[0-9a-f]{40}$/.test(headSha) || !token) {
    throw new Error('Trusted GitHub pull-request metadata is incomplete.');
  }

  const encodedRepository = repository.split('/').map(encodeURIComponent).join('/');
  const files = [];
  for (let page = 1; ; page += 1) {
    const batch = await githubRequest(
      apiUrl,
      token,
      `/repos/${encodedRepository}/pulls/${number}/files?per_page=100&page=${page}`,
      'Pull request file metadata',
      request,
    );
    if (!Array.isArray(batch)) throw new Error('Pull request file metadata was malformed.');
    if (batch.length > 100) throw new Error('Pull request file metadata exceeded its page size.');
    files.push(...batch);
    if (batch.length < 100) break;
    if (page >= 30) throw new Error('Pull request exceeds GitHub metadata validation limits.');
  }

  // pull_request_target tokens belong to the base repository. The base PR endpoint exposes the
  // fork's commits without requiring direct access to the contributor's separate repository.
  let headCommit = null;
  for (let page = 1; page <= 3 && !headCommit; page += 1) {
    const commits = await githubRequest(
      apiUrl,
      token,
      `/repos/${encodedRepository}/pulls/${number}/commits?per_page=100&page=${page}`,
      'Pull request commit metadata',
      request,
    );
    if (!Array.isArray(commits)) throw new Error('Pull request commit metadata was malformed.');
    if (commits.length > 100) throw new Error('Pull request commit metadata exceeded its page size.');
    if (page === 3 && commits.length > 50) {
      throw new Error('Pull request exceeds GitHub commit metadata validation limits.');
    }
    headCommit = commits.find((commit) => commit?.sha === headSha) ?? null;
    if (headCommit || commits.length < 100) break;
    if (page === 3) throw new Error('Pull request exceeds GitHub commit metadata validation limits.');
  }
  const treeSha = headCommit?.commit?.tree?.sha;
  if (!headCommit) throw new Error('Exact pull request head SHA was not present in pull request commit metadata.');
  if (typeof treeSha !== 'string' || !/^[0-9a-f]{40}$/.test(treeSha)) {
    throw new Error('Pull request head commit tree metadata was malformed.');
  }

  const tree = await githubRequest(
    apiUrl,
    token,
    `/repos/${encodedRepository}/git/trees/${treeSha}?recursive=1`,
    'Pull request tree metadata',
    request,
  );
  if (!tree || typeof tree !== 'object' || !Array.isArray(tree.tree)) {
    throw new Error('Pull request tree metadata was malformed.');
  }
  if (tree.truncated !== false) {
    throw new Error('Pull request tree metadata was truncated; contribution cannot be validated safely.');
  }
  const treeByPath = new Map();
  for (const entry of tree.tree) {
    if (!entry || typeof entry.path !== 'string' || typeof entry.mode !== 'string'
      || treeByPath.has(entry.path)) {
      throw new Error('Pull request tree metadata was malformed.');
    }
    treeByPath.set(entry.path, entry);
  }

  const changes = files.map((file) => {
    if (!file || typeof file !== 'object' || typeof file.filename !== 'string'
      || !['added', 'modified', 'removed', 'renamed', 'copied', 'changed'].includes(file.status)
      || !Number.isSafeInteger(file.additions) || file.additions < 0
      || !Number.isSafeInteger(file.deletions) || file.deletions < 0
      || (['renamed', 'copied'].includes(file.status) && typeof file.previous_filename !== 'string')) {
      throw new Error('Pull request file metadata was malformed.');
    }
    const status = file.status === 'renamed' ? 'R' : file.status === 'copied' ? 'C' : file.status === 'removed' ? 'D' : file.status === 'added' ? 'A' : 'M';
    const paths = status === 'R' || status === 'C'
      ? [file.previous_filename, file.filename]
      : [file.filename];
    const targetPath = status === 'D' ? null : file.filename;
    const object = targetPath ? treeByPath.get(targetPath) : null;
    if (targetPath && (!object
      || !['100644', '100755', '120000', '160000'].includes(object.mode)
      || (object.mode !== '160000' && (!Number.isSafeInteger(object.size) || object.size < 0)))) {
      throw new Error(`Pull request tree metadata could not verify changed path: ${targetPath}`);
    }
    return {
      status,
      paths,
      targetPath,
      mode: object?.mode ?? null,
      size: object?.size ?? null,
      binaryOrMedia: targetPath ? isMediaPath(targetPath) || file.patch === undefined : false,
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
    };
  });
  return { changes, totals: null };
}

export function formatContributionResult(result) {
  const lines = ['Contribution validation', ''];
  lines.push(`${result.passed ? '✓' : '✗'} ${result.scope.changedFiles} changed file${result.scope.changedFiles === 1 ? '' : 's'}`);
  lines.push(result.failures.some((failure) => failure.startsWith('Protected path'))
    ? '✗ protected paths were touched'
    : '✓ all changed paths are contributor-editable');
  lines.push(result.failures.some((failure) => /Symbolic links|submodules|object mode/.test(failure))
    ? '✗ unsafe Git object type detected'
    : '✓ no symlinks or submodules');
  lines.push(result.failures.some((failure) => failure.startsWith('Sensitive'))
    ? '✗ sensitive filename detected'
    : '✓ no sensitive filenames');
  lines.push(result.failures.some((failure) => /MiB/.test(failure))
    ? '✗ file or media size limit exceeded'
    : '✓ media/file sizes are within limits');

  if (result.failures.length) {
    lines.push('', 'Hard failures:');
    for (const failure of result.failures) lines.push(`  - ${failure}`);
  }
  if (result.warnings.length) {
    lines.push('', 'Warnings:');
    for (const warning of result.warnings) lines.push(`  - ${warning}`);
  }
  lines.push('', 'Scope');
  lines.push(`${result.scope.changedFiles} files`);
  lines.push(`+${result.scope.additions} / -${result.scope.deletions} lines`);
  lines.push(`${(result.scope.aggregateMediaBytes / 1024 / 1024).toFixed(1)} MiB added/modified binary media`);
  lines.push('', result.passed ? 'PASS' : 'FAIL');
  return lines.join('\n');
}
