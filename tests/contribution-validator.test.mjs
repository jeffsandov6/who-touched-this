import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  CONTRIBUTION_LIMITS,
  collectGitHubContribution,
  collectLocalContribution,
  evaluateContribution,
  isSensitiveCanvasPath,
} from '../scripts/contribution-validator.mjs';

function change({ status = 'A', paths = ['src/canvas/new.tsx'], targetPath = paths.at(-1), mode = '100644', size = 10, binaryOrMedia = false, additions = 1, deletions = 0 } = {}) {
  return { status, paths, targetPath, mode, size, binaryOrMedia, additions, deletions };
}

function evaluate(changes, totals) {
  return evaluateContribution(changes, totals);
}

test('canvas additions, modifications, and deletions pass', () => {
  const result = evaluate([
    change({ status: 'A', paths: ['src/canvas/new.tsx'] }),
    change({ status: 'M', paths: ['src/canvas/pages/Home.tsx'] }),
    change({ status: 'D', paths: ['src/canvas/old.tsx'], targetPath: null, mode: null, size: null }),
  ]);
  assert.equal(result.passed, true);
});

test('canvas-to-canvas rename passes while either protected rename direction fails', () => {
  assert.equal(evaluate([change({ status: 'R', paths: ['src/canvas/a.tsx', 'src/canvas/b.tsx'] })]).passed, true);
  assert.equal(evaluate([change({ status: 'R', paths: ['src/platform/a.tsx', 'src/canvas/a.tsx'] })]).passed, false);
  assert.equal(evaluate([change({ status: 'R', paths: ['src/canvas/a.tsx', 'src/platform/a.tsx'] })]).passed, false);
});

test('copies validate both source and destination paths', () => {
  assert.equal(evaluate([change({ status: 'C', paths: ['src/canvas/a.tsx', 'src/canvas/b.tsx'] })]).passed, true);
  assert.equal(evaluate([change({ status: 'C', paths: ['src/platform/a.tsx', 'src/canvas/a.tsx'] })]).passed, false);
  assert.equal(evaluate([change({ status: 'C', paths: ['src/canvas/a.tsx', 'src/platform/a.tsx'] })]).passed, false);
});

test('all representative protected paths fail, including deletes', () => {
  const protectedPaths = [
    'src/platform/components/SiteStatus.tsx', 'package.json', 'package-lock.json',
    'functions/src/index.ts', '.github/workflows/build.yml', 'src/pages/index.astro',
    'storage.rules', 'firestore.rules', 'README.md', 'CONTRIBUTING.md',
  ];
  for (const filePath of protectedPaths) {
    const result = evaluate([change({ status: filePath === 'README.md' ? 'D' : 'M', paths: [filePath], targetPath: filePath === 'README.md' ? null : filePath, mode: filePath === 'README.md' ? null : '100644' })]);
    assert.equal(result.passed, false, filePath);
    assert.match(result.failures.join('\n'), /Protected path modified/);
  }
});

test('normal image, audio, and video assets under canvas pass', () => {
  const result = evaluate([
    change({ paths: ['src/canvas/assets/image.png'], binaryOrMedia: true, size: 100 }),
    change({ paths: ['src/canvas/assets/audio.mp3'], binaryOrMedia: true, size: 100 }),
    change({ paths: ['src/canvas/assets/video.mp4'], binaryOrMedia: true, size: 100 }),
  ]);
  assert.equal(result.passed, true);
});

test('focused sensitive filename policy rejects environment, key, and service-account names', () => {
  const paths = [
    'src/canvas/.env', 'src/canvas/.env.local', 'src/canvas/.npmrc', 'src/canvas/.netrc',
    'src/canvas/private.pem', 'src/canvas/private.key', 'src/canvas/id_rsa',
    'src/canvas/id_ed25519', 'src/canvas/firebase-adminsdk.json',
    'src/canvas/project-service-account.json',
  ];
  for (const filePath of paths) {
    assert.equal(isSensitiveCanvasPath(filePath), true, filePath);
    assert.equal(evaluate([change({ paths: [filePath] })]).passed, false, filePath);
  }
});

test('symlinks and Git submodule/gitlink objects fail', () => {
  assert.equal(evaluate([change({ paths: ['src/canvas/link'], mode: '120000' })]).passed, false);
  assert.equal(evaluate([change({ paths: ['src/canvas/vendor'], mode: '160000' })]).passed, false);
});

test('single-file 25 MiB limit is inclusive and one byte over fails numerically', () => {
  assert.equal(evaluate([change({ size: CONTRIBUTION_LIMITS.maxFileBytes })]).passed, true);
  assert.equal(evaluate([change({ size: CONTRIBUTION_LIMITS.maxFileBytes + 1 })]).passed, false);
});

test('aggregate 50 MiB binary/media limit is inclusive and one byte over fails numerically', () => {
  const half = CONTRIBUTION_LIMITS.maxAggregateMediaBytes / 2;
  assert.equal(evaluate([
    change({ paths: ['src/canvas/assets/a.mp4'], size: half, binaryOrMedia: true }),
    change({ paths: ['src/canvas/assets/b.mp4'], size: half, binaryOrMedia: true }),
  ]).passed, true);
  assert.equal(evaluate([
    change({ paths: ['src/canvas/assets/a.mp4'], size: half, binaryOrMedia: true }),
    change({ paths: ['src/canvas/assets/b.mp4'], size: half + 1, binaryOrMedia: true }),
  ]).passed, false);
});

test('scope thresholds warn without failing', () => {
  const manyFiles = Array.from({ length: 13 }, (_, index) => change({ paths: [`src/canvas/file-${index}.tsx`] }));
  const result = evaluate(manyFiles, { additions: 801, deletions: 0 });
  assert.equal(result.passed, true);
  assert.equal(result.warnings.length, 2);
});

test('an ordinary small contribution has no scope warning', () => {
  const result = evaluate([change()], { additions: 20, deletions: 3 });
  assert.equal(result.passed, true);
  assert.deepEqual(result.warnings, []);
});

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

async function createRepository() {
  const cwd = await mkdtemp(path.join(tmpdir(), 'wtt-validator-'));
  git(cwd, ['init', '--initial-branch=main']);
  git(cwd, ['config', 'user.name', 'Validator Test']);
  git(cwd, ['config', 'user.email', 'validator@example.test']);
  await mkdir(path.join(cwd, 'src/canvas/pages'), { recursive: true });
  await mkdir(path.join(cwd, 'src/platform'), { recursive: true });
  await writeFile(path.join(cwd, 'src/canvas/pages/Home.tsx'), 'export default () => null;\n');
  await writeFile(path.join(cwd, 'src/canvas/pages/Old.tsx'), 'export default () => null;\n');
  await writeFile(path.join(cwd, 'src/platform/protected.ts'), 'export const protectedValue = true;\n');
  await writeFile(path.join(cwd, 'package.json'), '{}\n');
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-m', 'base']);
  return cwd;
}

test('temporary Git repository accepts add/modify/delete and canvas rename metadata', async (t) => {
  const cwd = await createRepository();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(path.join(cwd, 'src/canvas/pages/Home.tsx'), 'export default () => <main />;\n');
  git(cwd, ['rm', 'src/canvas/pages/Old.tsx']);
  git(cwd, ['mv', 'src/canvas/pages/Home.tsx', 'src/canvas/pages/Renamed.tsx']);
  await writeFile(path.join(cwd, 'src/canvas/New.tsx'), 'export const New = true;\n');
  const collected = await collectLocalContribution('HEAD', cwd);
  assert.equal(evaluate(collected.changes, collected.totals).passed, true);
});

test('temporary Git repository catches a protected modification and both cross-boundary renames', async (t) => {
  const cases = [
    async (cwd) => writeFile(path.join(cwd, 'src/platform/protected.ts'), 'changed\n'),
    async (cwd) => git(cwd, ['mv', 'src/platform/protected.ts', 'src/canvas/protected.ts']),
    async (cwd) => git(cwd, ['mv', 'src/canvas/pages/Home.tsx', 'src/platform/moved.tsx']),
  ];
  for (const mutate of cases) {
    const cwd = await createRepository();
    t.after(() => rm(cwd, { recursive: true, force: true }));
    await mutate(cwd);
    const collected = await collectLocalContribution('HEAD', cwd);
    assert.equal(evaluate(collected.changes, collected.totals).passed, false);
  }
});

test('temporary Git repository catches an untracked canvas symlink without following it', async (t) => {
  const cwd = await createRepository();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await symlink('../../platform/protected.ts', path.join(cwd, 'src/canvas/link'));
  const collected = await collectLocalContribution('HEAD', cwd);
  const result = evaluate(collected.changes, collected.totals);
  assert.equal(result.passed, false);
  assert.match(result.failures.join('\n'), /Symbolic links/);
});

const githubHeadSha = 'a'.repeat(40);
const githubTreeSha = 'b'.repeat(40);

async function writeGitHubEvent(t, pullRequest = {}) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'wtt-github-metadata-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const eventPath = path.join(cwd, 'event.json');
  await writeFile(eventPath, JSON.stringify({
    number: 17,
    repository: { full_name: 'jeffsandov6/who-touched-this' },
    pull_request: {
      head: { sha: githubHeadSha, repo: { full_name: 'private-contributor/private-fork' } },
      ...pullRequest,
    },
  }));
  return eventPath;
}

function githubFile(overrides = {}) {
  return {
    status: 'modified', filename: 'src/canvas/page.tsx', additions: 5, deletions: 2,
    patch: '@@ safe metadata only', ...overrides,
  };
}

function githubTreeEntry(overrides = {}) {
  return { path: 'src/canvas/page.tsx', mode: '100644', type: 'blob', size: 120, ...overrides };
}

function githubEnvironment() {
  return { GITHUB_TOKEN: 'synthetic-read-token', GITHUB_API_URL: 'https://api.github.test' };
}

function githubPage(url) {
  return new URL(url).searchParams.get('page');
}

test('trusted GitHub metadata collection uses only base-repository PR and tree endpoints for a fork', async (t) => {
  const eventPath = await writeGitHubEvent(t);
  const requested = [];
  const request = async (url) => {
    requested.push(url);
    if (url.includes('/pulls/17/files')) return new Response(JSON.stringify([{
      status: 'renamed', previous_filename: 'src/canvas/old.tsx', filename: 'src/canvas/new.tsx',
      additions: 5, deletions: 2, patch: '@@ safe metadata only',
    }]));
    if (url.includes('/pulls/17/commits')) return new Response(JSON.stringify([
      { sha: githubHeadSha, commit: { tree: { sha: githubTreeSha } } },
      { sha: 'c'.repeat(40), commit: { tree: { sha: 'd'.repeat(40) } } },
    ]));
    return new Response(JSON.stringify({ truncated: false, tree: [
      { path: 'src/canvas/new.tsx', mode: '100644', type: 'blob', size: 120 },
    ] }));
  };
  const collected = await collectGitHubContribution(eventPath, githubEnvironment(), request);
  assert.equal(evaluate(collected.changes).passed, true);
  assert.equal(requested.length, 3);
  assert.equal(requested.every((url) => url.includes('/repos/jeffsandov6/who-touched-this/')), true);
  assert.equal(requested.some((url) => url.includes('/private-contributor/private-fork/')), false);
  assert.equal(requested.some((url) => url.includes('/pulls/17/commits')), true);
  assert.equal(requested.some((url) => url.includes(`/git/trees/${githubTreeSha}`)), true);
  assert.equal(requested.some((url) => url.includes('/git/commits/')), false);
});

test('trusted metadata requires the exact event head SHA in paginated base PR commits', async (t) => {
  const eventPath = await writeGitHubEvent(t);
  const requested = [];
  const request = async (url) => {
    requested.push(url);
    if (url.includes('/files')) return new Response(JSON.stringify([githubFile()]));
    if (url.includes('/commits') && githubPage(url) === '1') {
      return new Response(JSON.stringify(Array.from({ length: 100 }, (_, index) => ({
        sha: index.toString(16).padStart(40, '0'), commit: { tree: { sha: githubTreeSha } },
      }))));
    }
    if (url.includes('/commits')) {
      return new Response(JSON.stringify([{ sha: githubHeadSha, commit: { tree: { sha: githubTreeSha } } }]));
    }
    return new Response(JSON.stringify({ truncated: false, tree: [githubTreeEntry()] }));
  };
  const collected = await collectGitHubContribution(eventPath, githubEnvironment(), request);
  assert.equal(collected.changes.length, 1);
  assert.equal(requested.filter((url) => url.includes('/commits')).length, 2);

  await assert.rejects(collectGitHubContribution(eventPath, githubEnvironment(), async (url) => {
    if (url.includes('/files')) return new Response(JSON.stringify([githubFile()]));
    return new Response(JSON.stringify([]));
  }), /Exact pull request head SHA was not present/);

  let commitRequests = 0;
  await assert.rejects(collectGitHubContribution(eventPath, githubEnvironment(), async (url) => {
    if (url.includes('/files')) return new Response(JSON.stringify([githubFile()]));
    if (url.includes('/commits')) {
      commitRequests += 1;
      return new Response(JSON.stringify(Array.from({ length: 100 }, (_, index) => ({
        sha: `${commitRequests}${index}`.padStart(40, '0'),
        commit: { tree: { sha: githubTreeSha } },
      }))));
    }
    throw new Error('Tree metadata must not be requested after the commit-page limit is exceeded.');
  }), /exceeds GitHub commit metadata validation limits/);
  assert.equal(commitRequests, 3);
});

test('trusted metadata preserves file pagination and its hard request limit', async (t) => {
  const eventPath = await writeGitHubEvent(t);
  const firstPage = Array.from({ length: 100 }, (_, index) => githubFile({
    filename: `src/canvas/page-${index}.tsx`,
  }));
  const finalFile = githubFile({ filename: 'src/canvas/final.tsx' });
  const tree = [...firstPage, finalFile].map((file) => githubTreeEntry({ path: file.filename }));
  const requested = [];
  const collected = await collectGitHubContribution(eventPath, githubEnvironment(), async (url) => {
    requested.push(url);
    if (url.includes('/files') && githubPage(url) === '1') return new Response(JSON.stringify(firstPage));
    if (url.includes('/files')) return new Response(JSON.stringify([finalFile]));
    if (url.includes('/commits')) return new Response(JSON.stringify([{ sha: githubHeadSha, commit: { tree: { sha: githubTreeSha } } }]));
    return new Response(JSON.stringify({ truncated: false, tree }));
  });
  assert.equal(collected.changes.length, 101);
  assert.equal(requested.filter((url) => url.includes('/files')).length, 2);

  let fileRequests = 0;
  await assert.rejects(collectGitHubContribution(eventPath, githubEnvironment(), async (url) => {
    if (url.includes('/files')) {
      fileRequests += 1;
      return new Response(JSON.stringify(firstPage));
    }
    throw new Error('Commit metadata must not be requested after the file-page limit is exceeded.');
  }), /exceeds GitHub metadata validation limits/);
  assert.equal(fileRequests, 30);
});

test('trusted metadata retains symlink detection and file-size enforcement', async (t) => {
  const eventPath = await writeGitHubEvent(t);
  async function collectWithTree(entry) {
    return collectGitHubContribution(eventPath, githubEnvironment(), async (url) => {
      if (url.includes('/files')) return new Response(JSON.stringify([githubFile()]));
      if (url.includes('/commits')) return new Response(JSON.stringify([{ sha: githubHeadSha, commit: { tree: { sha: githubTreeSha } } }]));
      return new Response(JSON.stringify({ truncated: false, tree: [entry] }));
    });
  }
  const symlink = await collectWithTree(githubTreeEntry({ mode: '120000', size: 18 }));
  assert.match(evaluate(symlink.changes).failures.join('\n'), /Symbolic links/);
  const gitlink = await collectWithTree(githubTreeEntry({ mode: '160000', type: 'commit', size: undefined }));
  assert.match(evaluate(gitlink.changes).failures.join('\n'), /submodules\/gitlinks/);
  const oversized = await collectWithTree(githubTreeEntry({ size: CONTRIBUTION_LIMITS.maxFileBytes + 1 }));
  assert.match(evaluate(oversized.changes).failures.join('\n'), /File exceeds 25 MiB/);
});

test('trusted metadata fails closed for malformed, truncated, or unverifiable API data', async (t) => {
  const eventPath = await writeGitHubEvent(t);
  const scenarios = [
    {
      pattern: /file metadata was malformed/,
      request: async (url) => new Response(JSON.stringify(url.includes('/files') ? {} : [])),
    },
    {
      pattern: /commit metadata was malformed/,
      request: async (url) => new Response(JSON.stringify(url.includes('/files') ? [githubFile()] : {})),
    },
    {
      pattern: /tree metadata was truncated/,
      request: async (url) => {
        if (url.includes('/files')) return new Response(JSON.stringify([githubFile()]));
        if (url.includes('/commits')) return new Response(JSON.stringify([{ sha: githubHeadSha, commit: { tree: { sha: githubTreeSha } } }]));
        return new Response(JSON.stringify({ truncated: true, tree: [githubTreeEntry()] }));
      },
    },
    {
      pattern: /could not verify changed path/,
      request: async (url) => {
        if (url.includes('/files')) return new Response(JSON.stringify([githubFile()]));
        if (url.includes('/commits')) return new Response(JSON.stringify([{ sha: githubHeadSha, commit: { tree: { sha: githubTreeSha } } }]));
        return new Response(JSON.stringify({ truncated: false, tree: [githubTreeEntry({ size: undefined })] }));
      },
    },
  ];
  for (const scenario of scenarios) {
    await assert.rejects(collectGitHubContribution(eventPath, githubEnvironment(), scenario.request), scenario.pattern);
  }
});

test('GitHub request failures identify the safe metadata operation without exposing the token', async (t) => {
  const eventPath = await writeGitHubEvent(t);
  const operations = [
    { failAt: 'files', pattern: /Pull request file metadata request failed with HTTP 404/ },
    { failAt: 'commits', pattern: /Pull request commit metadata request failed with HTTP 404/ },
    { failAt: 'trees', pattern: /Pull request tree metadata request failed with HTTP 404/ },
  ];
  for (const { failAt, pattern } of operations) {
    let message = '';
    await assert.rejects(collectGitHubContribution(eventPath, githubEnvironment(), async (url) => {
      if (url.includes(`/${failAt}`)) return new Response('{}', { status: 404 });
      if (url.includes('/files')) return new Response(JSON.stringify([githubFile()]));
      if (url.includes('/commits')) return new Response(JSON.stringify([{ sha: githubHeadSha, commit: { tree: { sha: githubTreeSha } } }]));
      return new Response(JSON.stringify({ truncated: false, tree: [githubTreeEntry()] }));
    }), (error) => {
      message = error.message;
      return pattern.test(error.message);
    });
    assert.doesNotMatch(message, /synthetic-read-token/);
  }
});
