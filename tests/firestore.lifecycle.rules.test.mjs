import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch,
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

function endBatch(firestore, status, { include = ['turn','participation','queue','private','public'] } = {}) {
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

function activateSecond(firestore) {
  const dueAt = Timestamp.fromMillis(Date.now() + 60_000);
  const batch = writeBatch(firestore);
  batch.set(doc(firestore, 'turns/second-turn'), {
    githubUserId: second.id, season: 1, status: 'active', targetContributionNumber: 1,
    startedAt: serverTimestamp(), dueAt, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  batch.update(doc(firestore, `participation/1_${second.id}`), { status: 'active', updatedAt: serverTimestamp() });
  batch.update(doc(firestore, `queue/1_${second.id}`), { status: 'active', updatedAt: serverTimestamp() });
  batch.set(doc(firestore, 'site/admin'), { activeTurnId: 'second-turn', updatedAt: serverTimestamp() });
  batch.set(doc(firestore, 'site/public'), {
    currentVersion: 0, totalContributions: 0, turnStatus: 'active', targetContributionNumber: 1,
    currentContributor: { githubUsername: second.username, displayName: 'Second Contributor' },
    dueAt, updatedAt: serverTimestamp(),
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
  const [turn, participation, queue, lock, publicSite, contributions] = await Promise.all([
    getDoc(doc(firestore, 'turns/current-turn')), getDoc(doc(firestore, `participation/1_${contributor.id}`)),
    getDoc(doc(firestore, `queue/1_${contributor.id}`)), getDoc(doc(firestore, 'site/admin')),
    getDoc(doc(firestore, 'site/public')), getDocs(collection(firestore, 'contributions')),
  ]);
  if (turn.data()?.status !== 'expired' || participation.data()?.status !== 'expired'
    || queue.data()?.status !== 'expired' || lock.data()?.activeTurnId !== null
    || publicSite.data()?.turnStatus !== 'none' || publicSite.data()?.currentVersion !== 0
    || publicSite.data()?.currentContributor !== null || contributions.size !== 0) {
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
