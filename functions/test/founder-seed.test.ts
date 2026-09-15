import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FounderSeedError,
  recordFounderSeedContribution,
  validateFounderSeedInput,
  type FounderSeedDependencies,
} from '../src/founder/record.js';

const before = 'a'.repeat(40);
const after = 'b'.repeat(40);
const auth = (id = '9001') => ({ firebase: { identities: { 'github.com': [id] } } });
const input = {
  publicDisplayName: 'Founder', prNumber: 27, summary: 'Initial creative seed',
  contributorMessage: 'Here we go.', beforeGitSha: before, afterGitSha: after,
};

interface State {
  admins: Map<string, Record<string, unknown>>;
  privateSite: Record<string, unknown> | null;
  publicSite: Record<string, unknown> | null;
  contributions: Map<number, Record<string, unknown>>;
  history: Map<string, Record<string, unknown>>;
  otherWrites: string[];
}

function setup(overrides: Partial<State> = {}) {
  const state: State = {
    admins: new Map([['9001', { githubUserId: '9001', active: true, role: 'owner' }]]),
    privateSite: { activeTurnId: null, pendingInvitationId: null, pendingArchiveContributionNumber: null },
    publicSite: {
      currentVersion: 0, totalContributions: 0, turnStatus: 'none',
      targetContributionNumber: null, currentContributor: null, dueAt: null,
    },
    contributions: new Map(), history: new Map(), otherWrites: [], ...overrides,
  };
  const timestamp = { serverTimestamp: true };
  const dependencies: FounderSeedDependencies = {
    canonicalRepository: 'JeffSandov6/who-touched-this',
    timestamp: () => timestamp,
    async runTransaction(operation) {
      return operation({
        loadAdmin: async (id) => state.admins.get(id) ?? null,
        loadPrivateSite: async () => state.privateSite,
        loadPublicSite: async () => state.publicSite,
        anyContributionExists: async () => state.contributions.size > 0,
        founderContributionExists: async () => state.contributions.has(0),
        founderHistoryExists: async () => state.history.has('founder_seed_000')
          || [...state.history.values()].some((record) => record.contributionNumber === 0),
        createContribution: (data) => state.contributions.set(0, data),
        createHistory: (data) => state.history.set('founder_seed_000', data),
        setPublicSite: (data) => { state.publicSite = data; },
        setPrivateSite: (data) => { state.privateSite = data; },
      });
    },
  };
  return { state, dependencies, timestamp };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error) => error instanceof FounderSeedError && error.code === code);
}

test('founder input is bounded, trimmed, normalized, and rejects unknown fields', () => {
  assert.deepEqual(validateFounderSeedInput({
    ...input, publicDisplayName: ' Founder ', summary: ' Initial creative seed ',
    contributorMessage: ' Note ', beforeGitSha: before.toUpperCase(), afterGitSha: after.toUpperCase(),
  }), { ...input, contributorMessage: 'Note' });
  for (const invalid of [
    { ...input, publicDisplayName: ' ' }, { ...input, publicDisplayName: 'x'.repeat(51) },
    { ...input, prNumber: 0 }, { ...input, prNumber: 1.5 }, { ...input, summary: '' },
    { ...input, summary: 'x'.repeat(161) }, { ...input, contributorMessage: 'x'.repeat(281) },
    { ...input, beforeGitSha: 'nope' }, { ...input, afterGitSha: 'nope' },
    { ...input, afterGitSha: before }, { ...input, contributionNumber: 0 },
  ]) assert.throws(() => validateFounderSeedInput(invalid), FounderSeedError);
});

test('recording requires authenticated stable-ID active owner authorization', async () => {
  await expectCode(recordFounderSeedContribution(null, input, setup().dependencies), 'unauthenticated');
  await expectCode(recordFounderSeedContribution({}, input, setup().dependencies), 'permission-denied');
  await expectCode(recordFounderSeedContribution(auth('JeffSandov6'), input, setup().dependencies), 'permission-denied');
  for (const admin of [
    null,
    { githubUserId: '9001', active: false, role: 'owner' },
    { githubUserId: '9001', active: true, role: 'admin' },
    { githubUserId: 'different', active: true, role: 'owner' },
  ]) {
    const state = setup({ admins: admin ? new Map([['9001', admin]]) : new Map() });
    await expectCode(recordFounderSeedContribution(auth(), input, state.dependencies), 'permission-denied');
  }
});

test('active owner atomically records public founder contribution, History, and inactive counters', async () => {
  const { state, dependencies, timestamp } = setup();
  assert.deepEqual(await recordFounderSeedContribution(auth(), input, dependencies), { status: 'recorded', contributionNumber: 0 });
  const contribution = state.contributions.get(0)!;
  assert.deepEqual(contribution, {
    number: 0, season: 1, contributionKind: 'founder_seed', githubUserId: '9001', displayName: 'Founder',
    githubUsername: 'JeffSandov6', summary: 'Initial creative seed', contributorMessage: 'Here we go.',
    prNumber: 27, prUrl: 'https://github.com/JeffSandov6/who-touched-this/pull/27',
    beforeGitSha: before, afterGitSha: after, archiveStatus: 'pending', mergedAt: timestamp, createdAt: timestamp,
  });
  assert.deepEqual(state.history.get('founder_seed_000'), {
    type: 'contribution', contributionKind: 'founder_seed', season: 1,
    displayName: 'Founder', githubUsername: 'JeffSandov6', targetContributionNumber: 0,
    contributionNumber: 0, occurredAt: timestamp,
  });
  assert.deepEqual(state.publicSite, {
    currentVersion: 0, totalContributions: 1, turnStatus: 'none', targetContributionNumber: null,
    currentContributor: null, dueAt: null, updatedAt: timestamp,
  });
  assert.equal(contribution.githubUserId, '9001');
  assert.equal('firebaseUid' in contribution, false);
  assert.deepEqual(state.otherWrites, []);
});

test('founder recording creates no operational or email records', async () => {
  const { state, dependencies } = setup();
  await recordFounderSeedContribution(auth(), { ...input, contributorMessage: undefined }, dependencies);
  assert.equal('contributorMessage' in state.contributions.get(0)!, false);
  assert.equal(state.privateSite?.activeTurnId, null);
  assert.equal(state.privateSite?.pendingInvitationId, null);
  assert.equal(state.privateSite?.pendingArchiveContributionNumber, 0);
  assert.equal(state.contributions.size, 1);
  assert.equal(state.history.size, 1);
  assert.deepEqual(state.otherWrites, []);
});

test('duplicate recording is rejected without changing counters or creating another event', async () => {
  const { state, dependencies } = setup();
  await recordFounderSeedContribution(auth(), input, dependencies);
  await expectCode(recordFounderSeedContribution(auth(), input, dependencies), 'failed-precondition');
  assert.equal(state.publicSite?.totalContributions, 1);
  assert.equal(state.contributions.size, 1);
  assert.equal(state.history.size, 1);
});

test('any existing permanent contribution prevents retroactive founder insertion', async () => {
  const state = setup({ contributions: new Map([[1, { number: 1 }]]) });
  await expectCode(recordFounderSeedContribution(auth(), input, state.dependencies), 'failed-precondition');
  assert.equal(state.state.contributions.has(0), false);
});

test('existing founder contribution or any contribution-zero History record blocks bootstrap', async () => {
  const existingZero = setup({ contributions: new Map([[0, { number: 0 }]]) });
  await expectCode(recordFounderSeedContribution(auth(), input, existingZero.dependencies), 'failed-precondition');
  const existingHistory = setup({ history: new Map([['legacy-event', { type: 'contribution', contributionNumber: 0 }]]) });
  await expectCode(recordFounderSeedContribution(auth(), input, existingHistory.dependencies), 'failed-precondition');
});

test('pending invitation, active lock, and active public projections block founder recording', async () => {
  for (const overrides of [
    { privateSite: { activeTurnId: null, pendingInvitationId: 'invitation' } },
    { privateSite: { activeTurnId: 'turn', pendingInvitationId: null } },
    { privateSite: { activeTurnId: null, pendingInvitationId: null, pendingArchiveContributionNumber: 1 } },
    { publicSite: { currentVersion: 0, totalContributions: 0, turnStatus: 'submitted', targetContributionNumber: 1, currentContributor: {}, dueAt: null } },
    { publicSite: { currentVersion: 0, totalContributions: 0, turnStatus: 'under_review', targetContributionNumber: 1, currentContributor: {}, dueAt: null } },
    { publicSite: { currentVersion: 1, totalContributions: 1, turnStatus: 'none', targetContributionNumber: null, currentContributor: null, dueAt: null } },
  ]) await expectCode(recordFounderSeedContribution(auth(), input, setup(overrides).dependencies), 'failed-precondition');
});

test('founder recording cannot overwrite an existing archive relay lock', async () => {
  const state = setup({
    privateSite: { activeTurnId: null, pendingInvitationId: null, pendingArchiveContributionNumber: 7 },
  });
  await expectCode(recordFounderSeedContribution(auth(), input, state.dependencies), 'failed-precondition');
  assert.equal(state.state.privateSite?.pendingArchiveContributionNumber, 7);
  assert.equal(state.state.contributions.has(0), false);
});

test('waiting queue state is irrelevant when locks, counters, and permanent history are empty', async () => {
  const state = setup();
  state.state.otherWrites.push('preexisting waiting queue entry');
  await recordFounderSeedContribution(auth(), input, state.dependencies);
  assert.equal(state.state.contributions.has(0), true);
  assert.deepEqual(state.state.otherWrites, ['preexisting waiting queue entry']);
});
