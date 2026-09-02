import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch,
} from 'firebase/firestore';

const projectId = 'demo-who-touched-this-lifecycle';
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const contributor = { uid: 'user-1', id: '1001', username: 'octocat-one' };
const second = { uid: 'user-2', id: '2002', username: 'octocat-two' };
const admin = { uid: 'admin-1', id: '9001' };
let environment;

function claims(id) {
  return { firebase: { identities: { 'github.com': [id] }, sign_in_provider: 'github.com' } };
}

function firestoreFor(identity) {
  return environment.authenticatedContext(identity.uid, claims(identity.id)).firestore();
}

async function seedAdmin(active = true) {
  await environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), `admins/${admin.id}`), {
    githubUserId: admin.id, role: 'owner', active,
  }));
}

async function seedCurrent(status = 'active', dueAt = Timestamp.fromMillis(Date.now() + 60_000)) {
  const createdAt = Timestamp.fromMillis(Date.now() - 120_000);
  const submittedAt = Timestamp.fromMillis(Date.now() - 60_000);
  const reviewStartedAt = Timestamp.fromMillis(Date.now() - 30_000);
  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await Promise.all([
      setDoc(doc(firestore, `contributors/${contributor.id}`), {
        firebaseUid: contributor.uid, githubUserId: contributor.id,
        githubUsername: contributor.username, displayName: 'Octo Contributor',
        email: 'private@example.test', createdAt, updatedAt: createdAt,
      }),
      setDoc(doc(firestore, `participation/1_${contributor.id}`), {
        githubUserId: contributor.id, season: 1, status: 'active', createdAt, updatedAt: createdAt,
      }),
      setDoc(doc(firestore, `queue/1_${contributor.id}`), {
        githubUserId: contributor.id, season: 1, status: 'active', joinedAt: createdAt,
        priority: 0, updatedAt: createdAt,
      }),
      setDoc(doc(firestore, 'turns/current-turn'), {
        githubUserId: contributor.id, season: 1, status, targetContributionNumber: 1,
        startedAt: createdAt, dueAt, createdAt, updatedAt: createdAt,
        ...(status !== 'active' ? {
          prNumber: 12, prUrl: 'https://github.com/example/repo/pull/12', submittedAt,
        } : {}),
        ...(status === 'under_review' ? { reviewStartedAt } : {}),
      }),
      setDoc(doc(firestore, 'site/admin'), { activeTurnId: 'current-turn', updatedAt: createdAt }),
      setDoc(doc(firestore, 'site/public'), {
        currentVersion: 0, totalContributions: 0, turnStatus: status,
        targetContributionNumber: 1,
        currentContributor: { githubUsername: contributor.username, displayName: 'Octo Contributor' },
        dueAt, updatedAt: createdAt,
      }),
    ]);
  });
}

function submissionBatch(firestore, {
  prNumber = 12,
  prUrl = 'https://github.com/example/repo/pull/12',
  turnUpdates = {},
  includePublic = true,
} = {}) {
  const batch = writeBatch(firestore);
  batch.update(doc(firestore, 'turns/current-turn'), {
    status: 'submitted', prNumber, prUrl, submittedAt: serverTimestamp(),
    updatedAt: serverTimestamp(), ...turnUpdates,
  });
  if (includePublic) batch.update(doc(firestore, 'site/public'), {
    turnStatus: 'submitted', updatedAt: serverTimestamp(),
  });
  return batch.commit();
}

function reviewBatch(firestore, { includePublic = true, turnUpdates = {} } = {}) {
  const batch = writeBatch(firestore);
  batch.update(doc(firestore, 'turns/current-turn'), {
    status: 'under_review', reviewStartedAt: serverTimestamp(),
    updatedAt: serverTimestamp(), ...turnUpdates,
  });
  if (includePublic) batch.update(doc(firestore, 'site/public'), {
    turnStatus: 'under_review', updatedAt: serverTimestamp(),
  });
  return batch.commit();
}

function endBatch(firestore, status, { include = ['turn','participation','queue','private','public','event'] } = {}) {
  const batch = writeBatch(firestore);
  if (include.includes('turn')) batch.update(doc(firestore, 'turns/current-turn'), {
    status, endedAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  if (include.includes('participation')) batch.update(doc(firestore, `participation/1_${contributor.id}`), {
    status, updatedAt: serverTimestamp(),
  });
  if (include.includes('queue')) batch.update(doc(firestore, `queue/1_${contributor.id}`), {
    status, updatedAt: serverTimestamp(),
  });
  if (include.includes('private')) batch.set(doc(firestore, 'site/admin'), {
    activeTurnId: null, updatedAt: serverTimestamp(),
  });
  if (include.includes('public')) batch.set(doc(firestore, 'site/public'), {
    currentVersion: 0, totalContributions: 0, turnStatus: 'none',
    targetContributionNumber: null, currentContributor: null, dueAt: null,
    updatedAt: serverTimestamp(),
  });
  if (include.includes('event')) batch.set(doc(firestore, 'historyEvents/current-turn'), {
    type: status === 'expired' ? 'turn_expired' : 'turn_skipped',
    season: 1,
    displayName: 'Octo Contributor',
    githubUsername: contributor.username,
    targetContributionNumber: 1,
    occurredAt: serverTimestamp(),
  });
  return batch.commit();
}

async function seedSecondWaiting() {
  const timestamp = Timestamp.now();
  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await Promise.all([
      setDoc(doc(firestore, `contributors/${second.id}`), {
        firebaseUid: second.uid, githubUserId: second.id, githubUsername: second.username,
        displayName: 'Second Contributor', email: 'second@example.test',
        createdAt: timestamp, updatedAt: timestamp,
      }),
      setDoc(doc(firestore, `participation/1_${second.id}`), {
        githubUserId: second.id, season: 1, status: 'waiting', createdAt: timestamp, updatedAt: timestamp,
      }),
      setDoc(doc(firestore, `queue/1_${second.id}`), {
        githubUserId: second.id, season: 1, status: 'waiting', joinedAt: timestamp,
        priority: 0, updatedAt: timestamp,
      }),
    ]);
  });
}

function activateSecond(firestore, { currentVersion = 0, totalContributions = 0, target = 1 } = {}) {
  const dueAt = Timestamp.fromMillis(Date.now() + 60_000);
  const batch = writeBatch(firestore);
  batch.set(doc(firestore, 'turns/second-turn'), {
    githubUserId: second.id, season: 1, status: 'active', targetContributionNumber: target,
    startedAt: serverTimestamp(), dueAt, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  batch.update(doc(firestore, `participation/1_${second.id}`), { status: 'active', updatedAt: serverTimestamp() });
  batch.update(doc(firestore, `queue/1_${second.id}`), { status: 'active', updatedAt: serverTimestamp() });
  batch.set(doc(firestore, 'site/admin'), { activeTurnId: 'second-turn', updatedAt: serverTimestamp() });
  batch.set(doc(firestore, 'site/public'), {
    currentVersion, totalContributions, turnStatus: 'active', targetContributionNumber: target,
    currentContributor: { githubUsername: second.username, displayName: 'Second Contributor' },
    dueAt, updatedAt: serverTimestamp(),
  });
  return batch.commit();
}

function mergeBatch(firestore, {
  include = ['turn','participation','queue','contribution','event','private','public'],
  summary = 'Added a test contribution.',
  contributorMessage,
  contributionUpdates = {},
  turnUpdates = {},
  participationUpdates = {},
  queueUpdates = {},
  publicUpdates = {},
  eventUpdates = {},
} = {}) {
  const batch = writeBatch(firestore);
  if (include.includes('turn')) batch.update(doc(firestore, 'turns/current-turn'), {
    status: 'merged', mergedAt: serverTimestamp(), endedAt: serverTimestamp(),
    updatedAt: serverTimestamp(), ...turnUpdates,
  });
  if (include.includes('participation')) batch.update(doc(firestore, `participation/1_${contributor.id}`), {
    status: 'completed', contributionNumber: 1, updatedAt: serverTimestamp(), ...participationUpdates,
  });
  if (include.includes('queue')) batch.update(doc(firestore, `queue/1_${contributor.id}`), {
    status: 'completed', contributionNumber: 1, updatedAt: serverTimestamp(), ...queueUpdates,
  });
  if (include.includes('contribution')) batch.set(doc(firestore, 'contributions/1'), {
    number: 1, season: 1, displayName: 'Octo Contributor', githubUsername: contributor.username,
    summary, ...(contributorMessage ? { contributorMessage } : {}),
    prNumber: 12, prUrl: 'https://github.com/example/repo/pull/12',
    mergedAt: serverTimestamp(), createdAt: serverTimestamp(), ...contributionUpdates,
  });
  if (include.includes('event')) batch.set(doc(firestore, 'historyEvents/current-turn'), {
    type: 'contribution', season: 1, displayName: 'Octo Contributor',
    githubUsername: contributor.username, targetContributionNumber: 1,
    contributionNumber: 1, occurredAt: serverTimestamp(), ...eventUpdates,
  });
  if (include.includes('private')) batch.set(doc(firestore, 'site/admin'), {
    activeTurnId: null, updatedAt: serverTimestamp(),
  });
  if (include.includes('public')) batch.set(doc(firestore, 'site/public'), {
    currentVersion: 1, totalContributions: 1, turnStatus: 'none',
    targetContributionNumber: null, currentContributor: null, dueAt: null,
    updatedAt: serverTimestamp(), ...publicUpdates,
  });
  return batch.commit();
}

before(async () => {
  environment = await initializeTestEnvironment({ projectId, firestore: { rules } });
});
beforeEach(async () => environment.clearFirestore());
after(async () => environment?.cleanup());

test('ordinary users and inactive admins cannot record submission', async () => {
  await seedCurrent();
  await assertFails(submissionBatch(firestoreFor(contributor)));
  await seedAdmin(false);
  await assertFails(submissionBatch(firestoreFor(admin)));
});

test('active admin records a valid submission while operational state and lock remain active', async () => {
  await seedAdmin(); await seedCurrent();
  const firestore = firestoreFor(admin);
  await assertSucceeds(submissionBatch(firestore));
  const [turn, participation, queue, lock, publicSite] = await Promise.all([
    getDoc(doc(firestore, 'turns/current-turn')), getDoc(doc(firestore, `participation/1_${contributor.id}`)),
    getDoc(doc(firestore, `queue/1_${contributor.id}`)), getDoc(doc(firestore, 'site/admin')),
    getDoc(doc(firestore, 'site/public')),
  ]);
  if (turn.data()?.status !== 'submitted' || turn.data()?.prNumber !== 12
    || participation.data()?.status !== 'active' || queue.data()?.status !== 'active'
    || lock.data()?.activeTurnId !== 'current-turn' || publicSite.data()?.turnStatus !== 'submitted') {
    throw new Error('Submission state was not preserved consistently.');
  }
});

for (const [name, prUrl, prNumber] of [
  ['HTTP', 'http://github.com/example/repo/pull/12', 12],
  ['non-GitHub', 'https://example.com/example/repo/pull/12', 12],
  ['number mismatch', 'https://github.com/example/repo/pull/12', 13],
]) test(`${name} PR submission is rejected by rules`, async () => {
  await seedAdmin(); await seedCurrent();
  await assertFails(submissionBatch(firestoreFor(admin), { prUrl, prNumber }));
});

test('submission cannot change target, deadline, or omit the public transition', async () => {
  await seedAdmin(); await seedCurrent();
  const firestore = firestoreFor(admin);
  await assertFails(submissionBatch(firestore, { turnUpdates: { targetContributionNumber: 2 } }));
  await assertFails(submissionBatch(firestore, { turnUpdates: { dueAt: Timestamp.fromMillis(Date.now() + 120_000) } }));
  await assertFails(submissionBatch(firestore, { includePublic: false }));
});

test('active admin advances submitted to under review while preserving PR data and lock', async () => {
  await seedAdmin(); await seedCurrent('submitted');
  const firestore = firestoreFor(admin);
  await assertSucceeds(reviewBatch(firestore));
  const [turn, lock, publicSite] = await Promise.all([
    getDoc(doc(firestore, 'turns/current-turn')), getDoc(doc(firestore, 'site/admin')),
    getDoc(doc(firestore, 'site/public')),
  ]);
  if (turn.data()?.status !== 'under_review' || turn.data()?.prNumber !== 12
    || turn.data()?.prUrl !== 'https://github.com/example/repo/pull/12'
    || lock.data()?.activeTurnId !== 'current-turn' || publicSite.data()?.turnStatus !== 'under_review') {
    throw new Error('Review transition did not preserve current-turn state.');
  }
});

test('ordinary user cannot mark under review and partial review is rejected', async () => {
  await seedAdmin(); await seedCurrent('submitted');
  await assertFails(reviewBatch(firestoreFor(contributor)));
  await assertFails(reviewBatch(firestoreFor(admin), { includePublic: false }));
});

test('active turn cannot expire before its deadline', async () => {
  await seedAdmin(); await seedCurrent('active', Timestamp.fromMillis(Date.now() + 60_000));
  await assertFails(endBatch(firestoreFor(admin), 'expired'));
});

test('expired transition after deadline is complete, inactive, and creates no contribution', async () => {
  await seedAdmin(); await seedCurrent('active', Timestamp.fromMillis(Date.now() - 1_000));
  const firestore = firestoreFor(admin);
  await assertSucceeds(endBatch(firestore, 'expired'));
  const [turn, participation, queue, lock, publicSite, contributions, historyEvent] = await Promise.all([
    getDoc(doc(firestore, 'turns/current-turn')), getDoc(doc(firestore, `participation/1_${contributor.id}`)),
    getDoc(doc(firestore, `queue/1_${contributor.id}`)), getDoc(doc(firestore, 'site/admin')),
    getDoc(doc(firestore, 'site/public')), getDocs(collection(firestore, 'contributions')),
    getDoc(doc(firestore, 'historyEvents/current-turn')),
  ]);
  if (turn.data()?.status !== 'expired' || participation.data()?.status !== 'expired'
    || queue.data()?.status !== 'expired' || lock.data()?.activeTurnId !== null
    || publicSite.data()?.turnStatus !== 'none' || publicSite.data()?.currentVersion !== 0
    || publicSite.data()?.currentContributor !== null || contributions.size !== 0
    || historyEvent.data()?.type !== 'turn_expired') {
    throw new Error('Expiration produced an inconsistent or permanent contribution state.');
  }
});

test('partial expiration is rejected', async () => {
  await seedAdmin(); await seedCurrent('active', Timestamp.fromMillis(Date.now() - 1_000));
  await assertFails(endBatch(firestoreFor(admin), 'expired', { include: ['turn','participation','queue','private'] }));
});

for (const status of ['submitted', 'under_review']) test(`${status} turn cannot expire`, async () => {
  await seedAdmin(); await seedCurrent(status, Timestamp.fromMillis(Date.now() - 1_000));
  await assertFails(endBatch(firestoreFor(admin), 'expired'));
});

for (const status of ['active', 'submitted', 'under_review']) test(`${status} turn can be skipped atomically`, async () => {
  await seedAdmin(); await seedCurrent(status);
  const firestore = firestoreFor(admin);
  await assertSucceeds(endBatch(firestore, 'skipped'));
  const [turn, lock, publicSite] = await Promise.all([
    getDoc(doc(firestore, 'turns/current-turn')), getDoc(doc(firestore, 'site/admin')),
    getDoc(doc(firestore, 'site/public')),
  ]);
  if (turn.data()?.status !== 'skipped' || lock.data()?.activeTurnId !== null
    || publicSite.data()?.turnStatus !== 'none' || publicSite.data()?.currentVersion !== 0) {
    throw new Error('Skip did not release the current turn safely.');
  }
});

test('ordinary users cannot skip and partial skip is rejected', async () => {
  await seedAdmin(); await seedCurrent();
  await assertFails(endBatch(firestoreFor(contributor), 'skipped'));
  await assertFails(endBatch(firestoreFor(admin), 'skipped', { include: ['turn','participation','queue','public'] }));
});

for (const terminalStatus of ['expired', 'skipped']) test(`${terminalStatus} turn is immutable`, async () => {
  await seedAdmin(); await seedCurrent('active', Timestamp.fromMillis(Date.now() - 1_000));
  const firestore = firestoreFor(admin);
  await assertSucceeds(endBatch(firestore, terminalStatus));
  await assertFails(updateDoc(doc(firestore, 'turns/current-turn'), { status: 'active', updatedAt: serverTimestamp() }));
});

for (const terminalStatus of ['expired', 'skipped']) test(`after ${terminalStatus}, next turn reuses the target number`, async () => {
  await seedAdmin(); await seedCurrent('active', Timestamp.fromMillis(Date.now() - 1_000));
  const firestore = firestoreFor(admin);
  await assertSucceeds(endBatch(firestore, terminalStatus));
  await seedSecondWaiting();
  await assertSucceeds(activateSecond(firestore));
  const turn = await getDoc(doc(firestore, 'turns/second-turn'));
  const publicSite = await getDoc(doc(firestore, 'site/public'));
  if (turn.data()?.targetContributionNumber !== 1 || publicSite.data()?.currentVersion !== 0) {
    throw new Error('Terminal turn consumed the proposed contribution number.');
  }
});

test('anonymous users read public lifecycle state but not private turn or lock', async () => {
  await seedCurrent('submitted');
  const firestore = environment.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(firestore, 'site/public')));
  await assertFails(getDoc(doc(firestore, 'turns/current-turn')));
  await assertFails(getDoc(doc(firestore, 'site/admin')));
});

test('ordinary users and inactive admins cannot record a merged contribution', async () => {
  await seedCurrent('under_review');
  await assertFails(mergeBatch(firestoreFor(contributor)));
  await seedAdmin(false);
  await assertFails(mergeBatch(firestoreFor(admin)));
});

for (const status of ['active', 'submitted']) test(`${status} turn cannot merge directly`, async () => {
  await seedAdmin(); await seedCurrent(status);
  await assertFails(mergeBatch(firestoreFor(admin)));
});

test('valid under-review merge creates public records, completes private state, and advances once', async () => {
  await seedAdmin(); await seedCurrent('under_review');
  const firestore = firestoreFor(admin);
  await assertSucceeds(mergeBatch(firestore, { contributorMessage: 'Thanks for the turn!' }));
  const [turn, participation, queue, contribution, event, lock, publicSite] = await Promise.all([
    getDoc(doc(firestore, 'turns/current-turn')),
    getDoc(doc(firestore, `participation/1_${contributor.id}`)),
    getDoc(doc(firestore, `queue/1_${contributor.id}`)),
    getDoc(doc(firestore, 'contributions/1')),
    getDoc(doc(firestore, 'historyEvents/current-turn')),
    getDoc(doc(firestore, 'site/admin')),
    getDoc(doc(firestore, 'site/public')),
  ]);
  if (turn.data()?.status !== 'merged' || participation.data()?.status !== 'completed'
    || participation.data()?.contributionNumber !== 1 || queue.data()?.status !== 'completed'
    || queue.data()?.contributionNumber !== 1 || contribution.data()?.number !== 1
    || contribution.data()?.prNumber !== 12 || event.data()?.type !== 'contribution'
    || event.data()?.contributionNumber !== 1 || lock.data()?.activeTurnId !== null
    || publicSite.data()?.currentVersion !== 1 || publicSite.data()?.totalContributions !== 1
    || publicSite.data()?.currentContributor !== null || publicSite.data()?.targetContributionNumber !== null
    || publicSite.data()?.dueAt !== null) throw new Error('Merged state was inconsistent.');
});

for (const [name, options] of [
  ['wrong contribution number', { contributionUpdates: { number: 2 } }],
  ['skipped contribution number', { publicUpdates: { currentVersion: 2 } }],
  ['wrong total increment', { publicUpdates: { totalContributions: 2 } }],
  ['changed turn target', { turnUpdates: { targetContributionNumber: 2 } }],
  ['changed contribution PR', { contributionUpdates: { prNumber: 13 } }],
  ['changed contributor snapshot', { contributionUpdates: { displayName: 'Impostor' } }],
  ['private email in contribution', { contributionUpdates: { email: 'private@example.test' } }],
  ['numeric GitHub ID in contribution', { contributionUpdates: { githubUserId: contributor.id } }],
  ['private field in history event', { eventUpdates: { priority: 99 } }],
]) test(`merge rejects ${name}`, async () => {
  await seedAdmin(); await seedCurrent('under_review');
  await assertFails(mergeBatch(firestoreFor(admin), options));
});

for (const omitted of ['turn','participation','queue','contribution','event','private','public']) {
  test(`partial merge without ${omitted} is rejected`, async () => {
    await seedAdmin(); await seedCurrent('under_review');
    const include = ['turn','participation','queue','contribution','event','private','public']
      .filter((name) => name !== omitted);
    await assertFails(mergeBatch(firestoreFor(admin), { include }));
  });
}

test('an existing contribution cannot be overwritten by merge', async () => {
  await seedAdmin(); await seedCurrent('under_review');
  await environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), 'contributions/1'), {
    number: 1, season: 1, displayName: 'Existing', githubUsername: 'existing', summary: 'Existing.',
    prNumber: 1, prUrl: 'https://github.com/example/repo/pull/1',
    mergedAt: Timestamp.now(), createdAt: Timestamp.now(),
  }));
  await assertFails(mergeBatch(firestoreFor(admin)));
});

test('merged turns are immutable, undeletable, and cannot be skipped', async () => {
  await seedAdmin(); await seedCurrent('under_review');
  const firestore = firestoreFor(admin);
  await assertSucceeds(mergeBatch(firestore));
  await assertFails(updateDoc(doc(firestore, 'turns/current-turn'), {
    status: 'skipped', updatedAt: serverTimestamp(),
  }));
  await assertFails(deleteDoc(doc(firestore, 'turns/current-turn')));
});

test('contribution-only, counter-only, and arbitrary history creation are rejected', async () => {
  await seedAdmin(); await seedCurrent('under_review');
  const firestore = firestoreFor(admin);
  await assertFails(mergeBatch(firestore, { include: ['contribution'] }));
  await assertFails(mergeBatch(firestore, { include: ['public'] }));
  await assertFails(setDoc(doc(firestore, 'historyEvents/unrelated'), {
    type: 'turn_skipped', season: 1, displayName: 'Someone', githubUsername: 'someone',
    targetContributionNumber: 1, occurredAt: serverTimestamp(),
  }));
});

test('anonymous users can read contributions and History but cannot write either', async () => {
  await seedAdmin(); await seedCurrent('under_review');
  await assertSucceeds(mergeBatch(firestoreFor(admin)));
  const anonymous = environment.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(anonymous, 'contributions/1')));
  await assertSucceeds(getDoc(doc(anonymous, 'historyEvents/current-turn')));
  await assertSucceeds(getDocs(collection(anonymous, 'historyEvents')));
  await assertFails(setDoc(doc(anonymous, 'contributions/2'), { number: 2 }));
  await assertFails(setDoc(doc(anonymous, 'historyEvents/fake'), { type: 'contribution' }));
});

test('merge validates required trimmed summary and bounded optional message', async () => {
  for (const options of [
    { summary: '' },
    { summary: '   ' },
    { summary: 'x'.repeat(161) },
    { summary: 'Summary', contributorMessage: 'x'.repeat(281) },
  ]) {
    await seedAdmin(); await seedCurrent('under_review');
    await assertFails(mergeBatch(firestoreFor(admin), options));
    await environment.clearFirestore();
  }
});

test('failed terminal transactions require their public History event', async () => {
  await seedAdmin(); await seedCurrent('active', Timestamp.fromMillis(Date.now() - 1_000));
  await assertFails(endBatch(firestoreFor(admin), 'expired', {
    include: ['turn','participation','queue','private','public'],
  }));
});

test('a turn after merge targets the following contribution number', async () => {
  await seedAdmin(); await seedCurrent('under_review');
  const firestore = firestoreFor(admin);
  await assertSucceeds(mergeBatch(firestore));
  await seedSecondWaiting();
  await assertSucceeds(activateSecond(firestore, {
    currentVersion: 1, totalContributions: 1, target: 2,
  }));
  const secondTurn = await getDoc(doc(firestore, 'turns/second-turn'));
  if (secondTurn.data()?.targetContributionNumber !== 2) {
    throw new Error('The next turn did not advance to Contribution #2.');
  }
});
