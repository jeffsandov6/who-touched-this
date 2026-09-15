import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  calculateMergedCounters,
  ContributionValidationError,
  validateContributionDetails,
  validateContributionGitProvenance,
} from '../src/platform/contribution-validation.ts';
import {
  contributorInitials,
  formatContributionNumber,
  githubAvatarUrl,
  parseHistoryEvent,
  parsePublicContribution,
} from '../src/platform/history.ts';
import { snapshotHistorySummary, snapshotImageAlt } from '../src/platform/snapshots/public.ts';
import {
  buildPublicContributionDetail,
  contributionNumberFromHistoryPathname,
} from '../src/platform/history-detail.ts';

const timestamp = (milliseconds: number) => ({ toDate: () => new Date(milliseconds) });

test('contribution details trim required summary and optional message', () => {
  assert.deepEqual(validateContributionDetails('  Added a button.  ', '  Hello!  '), {
    summary: 'Added a button.', contributorMessage: 'Hello!',
  });
  assert.deepEqual(validateContributionDetails('Added a button.', '   '), {
    summary: 'Added a button.',
  });
});

test('summary is required and bounded', () => {
  for (const value of ['', '   ', 'x'.repeat(161)]) {
    assert.throws(() => validateContributionDetails(value, ''), ContributionValidationError);
  }
  assert.equal(validateContributionDetails('x'.repeat(160), '').summary.length, 160);
});

test('contributor message is optional and bounded', () => {
  assert.equal(validateContributionDetails('Summary', 'x'.repeat(280)).contributorMessage?.length, 280);
  assert.throws(
    () => validateContributionDetails('Summary', 'x'.repeat(281)),
    ContributionValidationError,
  );
});

test('merged contribution provenance requires distinct full SHAs and normalizes case', () => {
  assert.deepEqual(validateContributionGitProvenance(' A'.trim().repeat(40), 'B'.repeat(40)), {
    beforeGitSha: 'a'.repeat(40), afterGitSha: 'b'.repeat(40),
  });
  assert.throws(() => validateContributionGitProvenance('abc', 'b'.repeat(40)), ContributionValidationError);
  assert.throws(() => validateContributionGitProvenance('a'.repeat(40), 'a'.repeat(40)), ContributionValidationError);
});

test('merged counters advance exactly once and require the next target', () => {
  assert.deepEqual(calculateMergedCounters(4, 4, 5), {
    currentVersion: 5, totalContributions: 5,
  });
  assert.throws(() => calculateMergedCounters(4, 4, 6), ContributionValidationError);
});

test('public History event parser distinguishes contributions from failed turns', () => {
  const legacyOutcome = parseHistoryEvent('turn-a', {
    type: 'turn_expired', season: 1, displayName: 'Alice', githubUsername: 'alice',
    targetContributionNumber: 1, occurredAt: timestamp(1000),
  });
  assert.equal(legacyOutcome?.type, 'turn_expired');
  assert.equal(legacyOutcome && 'githubUsername' in legacyOutcome, false);
  assert.equal(parseHistoryEvent('turn-private', {
    type: 'turn_skipped', season: 1, displayName: 'Nickname',
    targetContributionNumber: 2, occurredAt: timestamp(1500),
  })?.type, 'turn_skipped');
  const contributionEvent = parseHistoryEvent('turn-b', {
    type: 'contribution', season: 1, displayName: 'Bob', githubUsername: 'bob',
    targetContributionNumber: 1, contributionNumber: 1, occurredAt: timestamp(2000),
  });
  assert.equal(
    contributionEvent?.type === 'contribution' ? contributionEvent.contributionNumber : null,
    1,
  );
});

test('public parsers reject expanded private data', () => {
  assert.equal(parseHistoryEvent('turn-a', {
    type: 'turn_skipped', season: 1, displayName: 'Alice', githubUsername: 'alice',
    targetContributionNumber: 1, occurredAt: timestamp(1000), email: 'private@example.test',
  }), null);
  assert.equal(parseHistoryEvent('turn-a', {
    type: 'turn_skipped', season: 1, displayName: 'Alice', githubUsername: 'alice',
    targetContributionNumber: 1, occurredAt: timestamp(1000), socialUrl: 'https://example.com/alice',
  }), null);
  assert.equal(parsePublicContribution({
    number: 1, season: 1, displayName: 'Alice', githubUsername: 'alice', summary: 'Summary',
    prNumber: 27, prUrl: 'https://github.com/example/repo/pull/27',
    mergedAt: timestamp(1000), createdAt: timestamp(1000), email: 'private@example.test',
  }), null);
  assert.equal(parsePublicContribution({
    number: 1, season: 1, displayName: 'Alice', githubUsername: 'alice', summary: 'Summary',
    avatarUrl: 'https://attacker.example/avatar.png', prNumber: 27,
    prUrl: 'https://github.com/example/repo/pull/27',
    mergedAt: timestamp(1000), createdAt: timestamp(1000),
  }), null);
});

test('public contribution parsing and display formatting are deterministic', () => {
  const contribution = parsePublicContribution({
    number: 1, season: 1, githubUserId: '123', displayName: 'Alice', githubUsername: 'alice', summary: 'Summary',
    contributorMessage: 'Thanks!', socialUrl: 'https://example.com/alice', prNumber: 27,
    prUrl: 'https://github.com/example/repo/pull/27',
    mergedAt: timestamp(1000), createdAt: timestamp(1000),
  });
  assert.equal(contribution?.prNumber, 27);
  assert.equal(contribution?.githubUserId, '123');
  assert.equal(contribution?.socialUrl, 'https://example.com/alice');
  assert.equal(formatContributionNumber(1), '#001');
  assert.equal(formatContributionNumber(123), '#123');
});

test('public contribution parsing remains compatible without a social link', () => {
  const contribution = parsePublicContribution({
    number: 1, season: 1, displayName: 'Alice', githubUsername: 'alice', summary: 'Summary',
    prNumber: 27, prUrl: 'https://github.com/example/repo/pull/27',
    mergedAt: timestamp(1000), createdAt: timestamp(1000),
  });
  assert.ok(contribution);
  assert.equal('socialUrl' in contribution, false);
});

test('stable numeric GitHub identity derives avatars and older records get a compact fallback', () => {
  assert.equal(githubAvatarUrl('123'), 'https://avatars.githubusercontent.com/u/123?v=4&s=96');
  assert.equal(githubAvatarUrl(undefined), null);
  assert.equal(githubAvatarUrl('octocat'), null);
  assert.equal(githubAvatarUrl('0'), null);
  assert.equal(contributorInitials('Alice Example'), 'AE');
  assert.equal(contributorInitials('prince'), 'P');
  for (const githubUserId of ['not-numeric', '0', '01', '1'.repeat(21)]) {
    assert.equal(parsePublicContribution({
      number: 1, season: 1, githubUserId, displayName: 'Alice', githubUsername: 'alice',
      summary: 'Summary', prNumber: 27, prUrl: 'https://github.com/example/repo/pull/27',
      mergedAt: timestamp(1000), createdAt: timestamp(1000),
    }), null);
  }
});

test('public contribution parser rejects unsafe social links', () => {
  assert.equal(parsePublicContribution({
    number: 1, season: 1, displayName: 'Alice', githubUsername: 'alice', summary: 'Summary',
    socialUrl: 'javascript:alert(1)', prNumber: 27,
    prUrl: 'https://github.com/example/repo/pull/27',
    mergedAt: timestamp(1000), createdAt: timestamp(1000),
  }), null);
});

test('History renders a labeled social link only in successful contribution entries', async () => {
  const source = await readFile(new URL('../src/platform/components/HistoryContributionRecord.tsx', import.meta.url), 'utf8');
  assert.match(source, /event\.socialUrl/);
  assert.match(source, /href=\{event\.socialUrl\} rel="noreferrer">social<\/a>/);
});

test('History contribution presentation includes trusted avatar, optional traces, and semantic chronology', async () => {
  const pageSource = await readFile(new URL('../src/platform/pages/HistoryPage.tsx', import.meta.url), 'utf8');
  const source = await readFile(new URL('../src/platform/components/HistoryContributionRecord.tsx', import.meta.url), 'utf8');
  const contribution = pageSource.slice(pageSource.indexOf('function ContributionEntry'), pageSource.indexOf('function TurnOutcomeEntry'));
  assert.match(source, /githubAvatarUrl\(event\.githubUserId\)/);
  assert.match(source, /<strong>\{event\.displayName\}<\/strong>/);
  assert.match(source, /loading="lazy"/);
  assert.match(source, /alt=\{`\$\{event\.displayName\}'s GitHub avatar`\}/);
  assert.match(source, /history-avatar-fallback/);
  assert.match(source, /event\.contributorMessage &&/);
  assert.match(source, /event\.socialUrl &&/);
  assert.match(pageSource, /<ol className="history-timeline"/);
  assert.match(pageSource, /<article className="history-entry-card" aria-labelledby=/);
  assert.match(source, /<time dateTime=/);
  assert.match(contribution, /history-rail-marker" aria-hidden="true">\{number\}<\/span>/);
  assert.doesNotMatch(contribution, />missed turn<\/span>/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
});

test('History uses the immutable contribution summary and avoids per-event contribution reads', async () => {
  const source = await readFile(new URL('../src/platform/firebase/public-history.ts', import.meta.url), 'utf8');
  assert.match(source, /summary: contribution\.summary/);
  assert.match(source, /collection\(firestore, FIRESTORE_COLLECTIONS\.contributions\)/);
  const listLoader = source.slice(source.indexOf('export async function loadPublicHistory'));
  assert.doesNotMatch(listLoader, /getDoc\(/);
});

test('missed-turn rendering cannot reference GitHub, avatar, or social identity', async () => {
  const source = await readFile(new URL('../src/platform/pages/HistoryPage.tsx', import.meta.url), 'utf8');
  const outcome = source.slice(source.indexOf('function TurnOutcomeEntry'), source.indexOf('export function HistoryTimeline'));
  assert.match(outcome, /no shame\. life happens\./);
  assert.match(outcome, />missed turn<\/span>/);
  assert.match(outcome, /their contribution window expired/);
  assert.match(outcome, /their turn was skipped/);
  assert.match(outcome, /unwritten version \{number\}/);
  assert.doesNotMatch(outcome, /githubUsername|githubUserId|github\.com|socialUrl|ContributorAvatar/);
});

test('History list links successful contributions without inline screenshot resolution', async () => {
  const historySource = await readFile(new URL('../src/platform/pages/HistoryPage.tsx', import.meta.url), 'utf8');
  const outcome = historySource.slice(historySource.indexOf('function TurnOutcomeEntry'), historySource.indexOf('export function HistoryTimeline'));
  assert.match(historySource, /`\/history\/\$\{event\.contributionNumber\}/);
  assert.match(historySource, /see before & after/);
  assert.match(historySource, /: 'view contribution'/);
  assert.doesNotMatch(historySource, /HistorySnapshots|getPublicHistorySnapshotUrl|resolveImageUrl/);
  assert.doesNotMatch(outcome, /history-detail-link|\/history\/\$\{/);
});

test('detail snapshot presentation is complete, lazy, independently tolerant, and full-size inspectable', async () => {
  const snapshotSource = await readFile(new URL('../src/platform/components/HistorySnapshots.tsx', import.meta.url), 'utf8');
  assert.match(snapshotSource, /side: 'before' \| 'after'/);
  assert.match(snapshotSource, /onError=\{\(\) => setError\(true\)\}/);
  assert.match(snapshotSource, /screenshot unavailable\./);
  assert.match(snapshotSource, /history-snapshot-comparison/);
  assert.match(snapshotSource, /loading="lazy"/);
  assert.match(snapshotSource, /target="_blank"/);
  assert.match(snapshotSource, /rel="noreferrer"/);
  assert.match(snapshotSource, /open full size/);
  assert.equal(snapshotImageAlt('before', 12, '/random'), 'before contribution #012, /random');
  assert.equal(snapshotImageAlt('after', 12, '/random'), 'after contribution #012, /random');
  assert.equal(snapshotHistorySummary({ routes: [{}, {}, {}] } as never), 'before & after · 3 pages');
});

test('detail pathname accepts canonical numeric versions including founder zero and rejects malformed routes', () => {
  assert.equal(contributionNumberFromHistoryPathname('/history/0'), 0);
  assert.equal(contributionNumberFromHistoryPathname('/history/3'), 3);
  assert.equal(contributionNumberFromHistoryPathname('/history/123/'), 123);
  for (const pathname of ['/history', '/history/foo', '/history/03', '/history/-1', '/history/1.5', '/history/3/anything', '/admin']) {
    assert.equal(contributionNumberFromHistoryPathname(pathname), null, pathname);
  }
  assert.equal(contributionNumberFromHistoryPathname(`/history/${Number.MAX_SAFE_INTEGER + 1}`), null);
});

test('detail model uses one immutable successful contribution and remains compatible without optional data', () => {
  const full = buildPublicContributionDetail(3, {
    number: 3, season: 1, contributionKind: 'community', githubUserId: '583231',
    displayName: 'Mira', githubUsername: 'octocat', summary: 'Immutable summary.',
    contributorMessage: 'A trace.', socialUrl: 'https://example.com/mira',
    prNumber: 103, prUrl: 'https://github.com/example/repo/pull/103',
    mergedAt: timestamp(3000), createdAt: timestamp(2000),
  });
  assert.equal(full?.summary, 'Immutable summary.');
  assert.equal(full?.githubUserId, '583231');
  assert.equal(full?.contributorMessage, 'A trace.');
  assert.equal(full?.socialUrl, 'https://example.com/mira');
  assert.equal(full?.snapshot, undefined);

  const older = buildPublicContributionDetail(1, {
    number: 1, season: 1, displayName: 'Older', githubUsername: 'older', summary: 'Still complete.',
    prNumber: 101, prUrl: 'https://github.com/example/repo/pull/101',
    mergedAt: timestamp(1000), createdAt: timestamp(900),
  });
  assert.ok(older);
  assert.equal(older.githubUserId, undefined);
  assert.equal(older.contributionKind, 'community');
  assert.equal(buildPublicContributionDetail(1, {
    number: 1, season: 1, displayName: 'Older', githubUsername: 'older', summary: 'Still complete.',
    prNumber: 101, prUrl: 'https://github.com/example/repo/pull/101',
    mergedAt: timestamp(1000), createdAt: timestamp(900),
  }, { malformed: 'snapshot' })?.snapshot, undefined);
  assert.equal(buildPublicContributionDetail(2, { ...older, number: 1 }), null);
});

test('Founder contribution zero uses the same detail model', () => {
  const founder = buildPublicContributionDetail(0, {
    number: 0, season: 1, contributionKind: 'founder_seed', displayName: 'Founder',
    githubUsername: 'JeffSandov6', summary: 'Initial creative seed.', prNumber: 27,
    prUrl: 'https://github.com/JeffSandov6/who-touched-this/pull/27',
    beforeGitSha: 'a'.repeat(40), afterGitSha: 'b'.repeat(40),
    mergedAt: timestamp(1000), createdAt: timestamp(1000),
  });
  assert.equal(founder?.contributionNumber, 0);
  assert.equal(founder?.contributionKind, 'founder_seed');
});

test('detail page has complete and graceful ready, no-snapshot, and not-found states', async () => {
  const source = await readFile(new URL('../src/platform/pages/ContributionDetailPage.tsx', import.meta.url), 'utf8');
  assert.ok(source.indexOf('const contributionNumber = contributionNumberFromHistoryPathname')
    < source.indexOf('void loadPublicContributionDetail(contributionNumber)'));
  assert.match(source, /HistoryContributionRecord/);
  assert.match(source, /headingLevel="h1"/);
  assert.match(source, /<HistorySnapshots/);
  assert.match(source, /before & after wasn't archived for this version\./);
  assert.match(source, /before & after is being archived\./);
  assert.match(source, /before & after is unavailable for this version\./);
  assert.match(source, /version not found\./);
  assert.match(source, /back to history/);
  assert.doesNotMatch(source, /fixture|import\.meta\.env\.DEV|history-local/);
  assert.doesNotMatch(source, /contributors|participation|queue|turns/);
});

test('archive status distinguishes pending, finalized, and legacy public records', async () => {
  const base = {
    number: 2, season: 1, displayName: 'Archive Test', githubUsername: 'archive-test',
    summary: 'Accepted change.', prNumber: 22, prUrl: 'https://github.com/example/repo/pull/22',
    beforeGitSha: 'a'.repeat(40), afterGitSha: 'b'.repeat(40),
    mergedAt: timestamp(2000), createdAt: timestamp(2000),
  };
  assert.equal(parsePublicContribution({ ...base, archiveStatus: 'pending' })?.archiveStatus, 'pending');
  assert.equal(parsePublicContribution({ ...base, archiveStatus: 'finalized' })?.archiveStatus, 'finalized');
  assert.equal(parsePublicContribution({ ...base, archiveStatus: 'broken' }), null);
  const mismatchedSnapshot = {
    schemaVersion: 1, contributionNumber: 2, captureId: 'capture',
    beforeGitSha: 'c'.repeat(40), afterGitSha: 'd'.repeat(40),
    canonicalRoutes: ['/'], additionalRoutes: [], capturedRoutes: ['/'],
    routes: [{ route: '/', routeKey: 'home',
      before: { storagePath: 'public/history/contributions/002/capture/before/home.png', sha256: 'e'.repeat(64) },
      after: { storagePath: 'public/history/contributions/002/capture/after/home.png', sha256: 'f'.repeat(64) } }],
    manifestStoragePath: 'public/history/contributions/002/capture/manifest.json',
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1, fullPage: true }, archivedAt: timestamp(3000),
  };
  assert.equal(buildPublicContributionDetail(2, { ...base, archiveStatus: 'finalized' }, mismatchedSnapshot)?.snapshot, undefined);
  const listSource = await readFile(new URL('../src/platform/pages/HistoryPage.tsx', import.meta.url), 'utf8');
  assert.match(listSource, /event\.archiveStatus === 'pending'/);
  assert.match(listSource, /before & after is being archived\./);
});

test('admin merge recording deliberately collects exact provenance and exposes the archive relay lock', async () => {
  const [turnSource, adminSource, archiveSource] = await Promise.all([
    readFile(new URL('../src/platform/components/AdminCurrentTurn.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/platform/pages/AdminPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/platform/components/AdminSnapshotArchive.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(turnSource, /contribution-before-sha/);
  assert.match(turnSource, /contribution-after-sha/);
  assert.match(turnSource, /pattern="\[0-9A-Fa-f\]\{40\}"/);
  assert.match(adminSource, /relay paused for contribution/);
  assert.match(adminSource, /archive this accepted contribution before inviting/);
  assert.match(adminSource, /npm run snapshots:capture --/);
  assert.match(adminSource, /--contribution \$\{pendingArchive\.contributionNumber\}/);
  assert.doesNotMatch(adminSource, /\\n\+  --contribution/);
  assert.match(archiveSource, /does not match the contribution currently awaiting archival/);
});

test('detail loader reads only deterministic public contribution and snapshot documents', async () => {
  const source = await readFile(new URL('../src/platform/firebase/public-history.ts', import.meta.url), 'utf8');
  const detailLoader = source.slice(source.indexOf('export async function loadPublicContributionDetail'), source.indexOf('export async function loadPublicHistory'));
  assert.match(detailLoader, /contributionDocumentPath\(contributionNumber\)/);
  assert.match(detailLoader, /contributionSnapshotDocumentPath\(contributionNumber\)/);
  assert.doesNotMatch(detailLoader, /contributors|participation|queue|turns|historyEvents/);
});

test('Firebase Hosting rewrite is narrow to one canonical numeric History segment', async () => {
  const firebase = JSON.parse(await readFile(new URL('../firebase.json', import.meta.url), 'utf8'));
  assert.equal(firebase.hosting.rewrites.length, 1);
  const rewrite = firebase.hosting.rewrites[0];
  assert.equal(rewrite.regex, '^/history/(0|[1-9][0-9]*)/?$');
  assert.equal(rewrite.destination, '/history/detail-shell/index.html');
  const matcher = new RegExp(rewrite.regex);
  for (const path of ['/history/0', '/history/3', '/history/123', '/history/3/']) assert.equal(matcher.test(path), true, path);
  for (const path of ['/history', '/history/foo', '/history/03', '/history/3/anything', '/admin', '/random', '/thoughts']) assert.equal(matcher.test(path), false, path);
});

test('production History clients use only the public loaders and the static detail shell', async () => {
  const sources = await Promise.all([
    '../src/platform/pages/HistoryPage.tsx',
    '../src/platform/pages/ContributionDetailPage.tsx',
    '../src/pages/history/detail-shell.astro',
  ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')));
  for (const source of sources) {
    assert.doesNotMatch(source, /import\.meta\.env\.DEV|URLSearchParams|void import\(/);
  }
  assert.match(sources[0], /loadPublicHistory/);
  assert.match(sources[1], /loadPublicContributionDetail/);
  await assert.rejects(readFile(new URL('../src/pages/history/[number].astro', import.meta.url)), { code: 'ENOENT' });
});

test('History styling distinguishes outcomes and stacks visual comparisons on mobile', async () => {
  const source = await readFile(new URL('../src/styles/global.css', import.meta.url), 'utf8');
  assert.match(source, /\.history-turn-outcome \.history-entry-card \{ width: 100%; max-width: 44rem;/);
  assert.match(source, /\.history-snapshot-comparison \{ display: grid; grid-template-columns: 1fr;/);
  assert.match(source, /\.history-detail-page \{ width: min\(100% - 2rem, 78rem\);/);
});
