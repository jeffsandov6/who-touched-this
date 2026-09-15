import assert from 'node:assert/strict';
import test from 'node:test';
import {
  finalizeSnapshotArchiveRequest,
  SnapshotFinalizeError,
  type SnapshotFinalizeDependencies,
} from '../src/snapshots/finalize.js';

const captureId = '2026-01-01T00-00-00-000Z--abcdef01';
const checksum = 'c'.repeat(64);
const auth = (id = '9001') => ({ firebase: { identities: { 'github.com': [id] } } });

function fixture(number = 42, routes = ['/']) {
  const label = String(number).padStart(3, '0');
  const prefix = `public/history/contributions/${label}/${captureId}`;
  const manifest = {
    schemaVersion: 1, contributionNumber: number, contributionLabel: label, captureId,
    capturedAt: '2026-01-01T00:00:00.000Z',
    git: { before: 'a'.repeat(40), after: 'b'.repeat(40) },
    routeRegistry: { path: 'src/platform/config/editable-routes.json', revision: 'b'.repeat(40) },
    canonicalRoutes: routes, additionalRoutes: [], capturedRoutes: routes,
    capture: {
      viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, fullPage: true,
      format: 'png', locale: 'en-US', timezoneId: 'UTC', waitMs: 1500,
    },
    screenshots: routes.map((route, index) => {
      const key = index === 0 ? 'home' : `route-${index}`;
      return { route, key, before: { path: `before/${key}.png`, sha256: checksum }, after: { path: `after/${key}.png`, sha256: checksum } };
    }),
  };
  const objects = new Map<string, { metadata: { path: string; size: number; contentType: string; metadata: Record<string, string> }; contents?: Buffer }>();
  const common = { contributionNumber: String(number), contributionLabel: label, captureId };
  const manifestPath = `${prefix}/manifest.json`;
  const manifestContents = Buffer.from(JSON.stringify(manifest));
  objects.set(manifestPath, { metadata: { path: manifestPath, size: manifestContents.length, contentType: 'application/json', metadata: common }, contents: manifestContents });
  for (const record of manifest.screenshots) for (const side of ['before', 'after'] as const) {
    const path = `${prefix}/${record[side].path}`;
    objects.set(path, { metadata: { path, size: 1000, contentType: 'image/png', metadata: { ...common, routeKey: record.key, side, sha256: checksum } } });
  }
  return { manifest, objects, prefix };
}

function dependencies(options: {
  number?: number; routes?: string[]; contribution?: boolean; finalized?: boolean;
  conflicting?: boolean; wrongLock?: boolean; wrongShas?: boolean;
  admin?: Record<string, unknown> | null; mutate?: (value: ReturnType<typeof fixture>) => void;
} = {}) {
  const value = fixture(options.number ?? 42, options.routes ?? ['/']);
  options.mutate?.(value);
  const writes: Array<Record<string, unknown>> = [];
  const number = options.number ?? 42;
  const contribution = options.contribution === false ? null : {
    number, archiveStatus: options.finalized ? 'finalized' : 'pending',
    beforeGitSha: options.wrongShas ? 'd'.repeat(40) : 'a'.repeat(40),
    afterGitSha: 'b'.repeat(40),
  };
  let snapshot: Record<string, unknown> | null = options.finalized ? {
    contributionNumber: number,
    captureId: options.conflicting ? 'different-capture' : captureId,
    beforeGitSha: 'a'.repeat(40), afterGitSha: 'b'.repeat(40),
  } : null;
  const privateSite: Record<string, unknown> = {
    pendingArchiveContributionNumber: options.finalized ? null : options.wrongLock ? number + 1 : number,
  };
  const deps: SnapshotFinalizeDependencies = {
    loadAdmin: async () => options.admin === undefined ? { githubUserId: '9001', active: true, role: 'owner' } : options.admin,
    loadArchiveState: async () => ({ contribution, snapshot, privateSite }),
    loadObject: async (path) => value.objects.get(path) ?? null,
    listObjects: async () => [...value.objects.keys()],
    commitFinalization: async (input) => {
      if (snapshot) {
        if (snapshot.captureId === input.captureId && contribution?.archiveStatus === 'finalized') return 'already_finalized';
        throw new SnapshotFinalizeError('failed-precondition', 'conflicting archive');
      }
      writes.push(input.snapshot);
      snapshot = input.snapshot;
      if (contribution) contribution.archiveStatus = 'finalized';
      privateSite.pendingArchiveContributionNumber = null;
      return 'finalized';
    },
    archivedAt: () => 'server-time',
  };
  return { value, writes, deps };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error) => error instanceof SnapshotFinalizeError && error.code === code);
}

test('active owner finalizes a valid complete archive into one public document', async () => {
  const { deps, writes } = dependencies();
  const result = await finalizeSnapshotArchiveRequest(auth(), { contributionNumber: 42, captureId }, deps);
  assert.deepEqual(result, { status: 'finalized', contributionNumber: 42 });
  assert.equal(writes.length, 1);
  const created = writes[0];
  assert.ok(created);
  assert.equal(created.routes instanceof Array ? created.routes.length : 0, 1);
  assert.equal(created.archivedAt, 'server-time');
  assert.equal('githubUserId' in created, false);
});

test('contribution-zero archive requires a permanent founder record, then uses the normal 000 namespace', async () => {
  await expectCode(
    finalizeSnapshotArchiveRequest(auth(), { contributionNumber: 0, captureId }, dependencies({ number: 0, contribution: false }).deps),
    'not-found',
  );
  const { deps, writes } = dependencies({ number: 0, admin: { githubUserId: '9001', active: true, role: 'admin' } });
  await finalizeSnapshotArchiveRequest(auth(), { contributionNumber: 0, captureId }, deps);
  const created = writes[0];
  assert.ok(created);
  assert.equal(created.contributionNumber, 0);
  assert.match(String(created.manifestStoragePath), /contributions\/000\//);
});

test('finalization requires auth, stable matching admin ID, and active owner/admin role', async () => {
  await expectCode(finalizeSnapshotArchiveRequest(null, {}, dependencies().deps), 'unauthenticated');
  await expectCode(finalizeSnapshotArchiveRequest(auth('1001'), { contributionNumber: 42, captureId }, dependencies({ admin: null }).deps), 'permission-denied');
  await expectCode(finalizeSnapshotArchiveRequest(auth(), { contributionNumber: 42, captureId }, dependencies({ admin: { githubUserId: '9001', active: false, role: 'owner' } }).deps), 'permission-denied');
  await expectCode(finalizeSnapshotArchiveRequest(auth('7777'), { contributionNumber: 42, captureId }, dependencies({ admin: { githubUserId: '9001', active: true, role: 'owner' } }).deps), 'permission-denied');
});

test('nonexistent contribution rejects, while a same-archive retry is idempotent and a conflict rejects', async () => {
  await expectCode(finalizeSnapshotArchiveRequest(auth(), { contributionNumber: 42, captureId }, dependencies({ contribution: false }).deps), 'not-found');
  assert.deepEqual(await finalizeSnapshotArchiveRequest(auth(), { contributionNumber: 42, captureId }, dependencies({ finalized: true }).deps), {
    status: 'already_finalized', contributionNumber: 42,
  });
  await expectCode(finalizeSnapshotArchiveRequest(auth(), { contributionNumber: 42, captureId }, dependencies({ finalized: true, conflicting: true }).deps), 'failed-precondition');
});

test('pending lock and immutable contribution SHA pair must match the archive', async () => {
  await expectCode(finalizeSnapshotArchiveRequest(auth(), { contributionNumber: 42, captureId }, dependencies({ wrongLock: true }).deps), 'failed-precondition');
  await expectCode(finalizeSnapshotArchiveRequest(auth(), { contributionNumber: 42, captureId }, dependencies({ wrongShas: true }).deps), 'failed-precondition');
});

test('lost-response retry returns already finalized without another write', async () => {
  const state = dependencies();
  assert.equal((await finalizeSnapshotArchiveRequest(auth(), { contributionNumber: 42, captureId }, state.deps)).status, 'finalized');
  assert.equal((await finalizeSnapshotArchiveRequest(auth(), { contributionNumber: 42, captureId }, state.deps)).status, 'already_finalized');
  assert.equal(state.writes.length, 1);
});

test('missing or malformed manifest and identity mismatch fail closed', async () => {
  for (const mutate of [
    (value: ReturnType<typeof fixture>) => value.objects.delete(`${value.prefix}/manifest.json`),
    (value: ReturnType<typeof fixture>) => { value.objects.get(`${value.prefix}/manifest.json`)!.contents = Buffer.from('{'); },
    (value: ReturnType<typeof fixture>) => { value.manifest.schemaVersion = 2; value.objects.get(`${value.prefix}/manifest.json`)!.contents = Buffer.from(JSON.stringify(value.manifest)); },
    (value: ReturnType<typeof fixture>) => { value.manifest.contributionNumber = 41; value.objects.get(`${value.prefix}/manifest.json`)!.contents = Buffer.from(JSON.stringify(value.manifest)); },
  ]) await expectCode(finalizeSnapshotArchiveRequest(auth(), { contributionNumber: 42, captureId }, dependencies({ mutate }).deps), 'failed-precondition');
});

test('missing before or after screenshot is rejected', async () => {
  for (const side of ['before', 'after']) {
    const state = dependencies({ mutate: (value) => value.objects.delete(`${value.prefix}/${side}/home.png`) });
    await expectCode(finalizeSnapshotArchiveRequest(auth(), { contributionNumber: 42, captureId }, state.deps), 'failed-precondition');
  }
});

test('duplicate routes and unexpected archive objects are rejected', async () => {
  const duplicate = dependencies({ routes: ['/', '/'] });
  await expectCode(finalizeSnapshotArchiveRequest(auth(), { contributionNumber: 42, captureId }, duplicate.deps), 'failed-precondition');
  const extra = dependencies({ mutate: (value) => value.objects.set(`${value.prefix}/after/extra.png`, { metadata: { path: `${value.prefix}/after/extra.png`, size: 1, contentType: 'image/png', metadata: {} } }) });
  await expectCode(finalizeSnapshotArchiveRequest(auth(), { contributionNumber: 42, captureId }, extra.deps), 'failed-precondition');
});

test('wrong path, MIME, size, and checksum metadata are rejected', async () => {
  const mutations = [
    (entry: any) => { entry.metadata.path = 'private/wrong.png'; },
    (entry: any) => { entry.metadata.contentType = 'image/jpeg'; },
    (entry: any) => { entry.metadata.size = 20 * 1024 * 1024 + 1; },
    (entry: any) => { entry.metadata.metadata.sha256 = 'd'.repeat(64); },
  ];
  for (const change of mutations) {
    const state = dependencies({ mutate: (value) => change(value.objects.get(`${value.prefix}/before/home.png`)) });
    await expectCode(finalizeSnapshotArchiveRequest(auth(), { contributionNumber: 42, captureId }, state.deps), 'failed-precondition');
  }
});

test('finalization writes snapshot metadata only and never lifecycle state', async () => {
  const touched: string[] = [];
  const state = dependencies();
  state.deps.commitFinalization = async (input) => {
    touched.push(`contributionSnapshots/${input.contributionNumber}`, `contributions/${input.contributionNumber}.archiveStatus`, 'site/admin.pendingArchiveContributionNumber');
    state.writes.push(input.snapshot);
    return 'finalized';
  };
  await finalizeSnapshotArchiveRequest(auth(), { contributionNumber: 42, captureId }, state.deps);
  assert.deepEqual(touched, ['contributionSnapshots/42', 'contributions/42.archiveStatus', 'site/admin.pendingArchiveContributionNumber']);
  assert.equal(typeof state.writes[0]?.manifestSha256, 'string');
});
