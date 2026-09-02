import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

const projectId = 'demo-who-touched-this-invitations';
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const contributor = { uid: 'user-1', id: '1001', username: 'octocat-one' };
const other = { uid: 'user-2', id: '2002', username: 'octocat-two' };
const admin = { uid: 'admin-1', id: '9001' };
let environment;

function claims(id) {
  return { firebase: { identities: { 'github.com': [id] }, sign_in_provider: 'github.com' } };
}

function firestoreFor(identity) {
  return environment.authenticatedContext(identity.uid, claims(identity.id)).firestore();
}

async function seed({ adminActive = true, secondContributor = false } = {}) {
  const now = Timestamp.now();
  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    const writes = [
      setDoc(doc(firestore, `admins/${admin.id}`), {
        githubUserId: admin.id, role: 'owner', active: adminActive,
      }),
      setDoc(doc(firestore, `contributors/${contributor.id}`), {
        firebaseUid: contributor.uid, githubUserId: contributor.id,
        githubUsername: contributor.username, displayName: 'Octo Contributor',
        email: 'private@example.test', createdAt: now, updatedAt: now,
      }),
      setDoc(doc(firestore, `participation/1_${contributor.id}`), {
        githubUserId: contributor.id, season: 1, status: 'waiting',
        createdAt: now, updatedAt: now,
      }),
      setDoc(doc(firestore, `queue/1_${contributor.id}`), {
        githubUserId: contributor.id, season: 1, status: 'waiting', joinedAt: now,
        priority: 0, updatedAt: now,
      }),
      setDoc(doc(firestore, 'site/public'), {
        currentVersion: 0, totalContributions: 0, turnStatus: 'none',
        targetContributionNumber: null, currentContributor: null, dueAt: null, updatedAt: now,
      }),
      setDoc(doc(firestore, 'site/admin'), {
        activeTurnId: null, pendingInvitationId: null, updatedAt: now,
      }),
    ];
    if (secondContributor) {
      writes.push(
        setDoc(doc(firestore, `contributors/${other.id}`), {
          firebaseUid: other.uid, githubUserId: other.id,
          githubUsername: other.username, displayName: 'Other Contributor',
          email: 'other@example.test', createdAt: now, updatedAt: now,
        }),
        setDoc(doc(firestore, `participation/1_${other.id}`), {
          githubUserId: other.id, season: 1, status: 'waiting', createdAt: now, updatedAt: now,
        }),
        setDoc(doc(firestore, `queue/1_${other.id}`), {
          githubUserId: other.id, season: 1, status: 'waiting', joinedAt: now,
          priority: 0, updatedAt: now,
        }),
      );
    }
    await Promise.all(writes);
  });
}

function inviteBatch(firestore, {
  invitationId = 'invitation-1',
  identity = contributor,
  acceptBy = Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
  duration = 168,
  include = ['invitation', 'participation', 'queue', 'private'],
  invitationOverrides = {},
} = {}) {
  const batch = writeBatch(firestore);
  if (include.includes('invitation')) batch.set(doc(firestore, `invitations/${invitationId}`), {
    githubUserId: identity.id, season: 1, status: 'pending', invitedAt: serverTimestamp(),
    acceptBy, turnDurationHours: duration, createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(), ...invitationOverrides,
  });
  if (include.includes('participation')) batch.update(
    doc(firestore, `participation/1_${identity.id}`),
    { status: 'invited', invitationId, updatedAt: serverTimestamp() },
  );
  if (include.includes('queue')) batch.update(doc(firestore, `queue/1_${identity.id}`), {
    status: 'invited', updatedAt: serverTimestamp(),
  });
  if (include.includes('private')) batch.set(doc(firestore, 'site/admin'), {
    activeTurnId: null, pendingInvitationId: invitationId, updatedAt: serverTimestamp(),
  });
  return batch.commit();
}

async function seedPending({ expired = false, identity = contributor, duration = 168 } = {}) {
  const now = Timestamp.now();
  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await Promise.all([
      setDoc(doc(firestore, 'invitations/invitation-1'), {
        githubUserId: identity.id, season: 1, status: 'pending', invitedAt: now,
        acceptBy: Timestamp.fromMillis(Date.now() + (expired ? -60_000 : 60 * 60 * 1000)),
        turnDurationHours: duration, createdAt: now, updatedAt: now,
      }),
      updateDoc(doc(firestore, `participation/1_${identity.id}`), {
        status: 'invited', invitationId: 'invitation-1', updatedAt: now,
      }),
      updateDoc(doc(firestore, `queue/1_${identity.id}`), { status: 'invited', updatedAt: now }),
      setDoc(doc(firestore, 'site/admin'), {
        activeTurnId: null, pendingInvitationId: 'invitation-1', updatedAt: now,
      }),
    ]);
  });
}

function acceptBatch(firestore, {
  identity = contributor,
  invitationId = 'invitation-1',
  turnId = 'turn-1',
  target = 1,
  duration = 168,
  dueAt = Timestamp.fromMillis(Date.now() + duration * 60 * 60 * 1000),
  include = ['invitation','turn','participation','queue','private','public'],
  turnOverrides = {},
  queueUpdates = {},
  publicOverrides = {},
} = {}) {
  const batch = writeBatch(firestore);
  if (include.includes('invitation')) batch.update(doc(firestore, `invitations/${invitationId}`), {
    status: 'accepted', acceptedAt: serverTimestamp(), turnId, updatedAt: serverTimestamp(),
  });
  if (include.includes('turn')) batch.set(doc(firestore, `turns/${turnId}`), {
    githubUserId: identity.id, season: 1, status: 'active', targetContributionNumber: target,
    startedAt: serverTimestamp(), dueAt, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    ...turnOverrides,
  });
  if (include.includes('participation')) batch.update(
    doc(firestore, `participation/1_${identity.id}`),
    { status: 'active', updatedAt: serverTimestamp() },
  );
  if (include.includes('queue')) batch.update(doc(firestore, `queue/1_${identity.id}`), {
    status: 'active', updatedAt: serverTimestamp(), ...queueUpdates,
  });
  if (include.includes('private')) batch.set(doc(firestore, 'site/admin'), {
    activeTurnId: turnId, pendingInvitationId: null, updatedAt: serverTimestamp(),
  });
  if (include.includes('public')) batch.set(doc(firestore, 'site/public'), {
    currentVersion: 0, totalContributions: 0, turnStatus: 'active',
    targetContributionNumber: target,
    currentContributor: { githubUsername: identity.username, displayName: 'Octo Contributor' },
    dueAt, updatedAt: serverTimestamp(), ...publicOverrides,
  });
  return batch.commit();
}

function acceptTransaction(firestore) {
  const dueAt = Timestamp.fromMillis(Date.now() + 168 * 60 * 60 * 1000);
  return runTransaction(firestore, async (transaction) => {
    await Promise.all([
      transaction.get(doc(firestore, 'invitations/invitation-1')),
      transaction.get(doc(firestore, `contributors/${contributor.id}`)),
      transaction.get(doc(firestore, `participation/1_${contributor.id}`)),
      transaction.get(doc(firestore, 'site/public')),
    ]);
    transaction.update(doc(firestore, 'invitations/invitation-1'), {
      status: 'accepted', acceptedAt: serverTimestamp(), turnId: 'turn-1',
      updatedAt: serverTimestamp(),
    });
    transaction.set(doc(firestore, 'turns/turn-1'), {
      githubUserId: contributor.id, season: 1, status: 'active', targetContributionNumber: 1,
      startedAt: serverTimestamp(), dueAt, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    transaction.update(doc(firestore, `participation/1_${contributor.id}`), {
      status: 'active', updatedAt: serverTimestamp(),
    });
    transaction.update(doc(firestore, `queue/1_${contributor.id}`), {
      status: 'active', updatedAt: serverTimestamp(),
    });
    transaction.set(doc(firestore, 'site/admin'), {
      activeTurnId: 'turn-1', pendingInvitationId: null, updatedAt: serverTimestamp(),
    });
    transaction.set(doc(firestore, 'site/public'), {
      currentVersion: 0, totalContributions: 0, turnStatus: 'active', targetContributionNumber: 1,
      currentContributor: { githubUsername: contributor.username, displayName: 'Octo Contributor' },
      dueAt, updatedAt: serverTimestamp(),
    });
  });
}

function expireBatch(firestore, { include = ['invitation','participation','queue','private'] } = {}) {
  const batch = writeBatch(firestore);
  if (include.includes('invitation')) batch.update(doc(firestore, 'invitations/invitation-1'), {
    status: 'expired', expiredAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  if (include.includes('participation')) batch.update(doc(firestore, `participation/1_${contributor.id}`), {
    status: 'invitation_expired', updatedAt: serverTimestamp(),
  });
  if (include.includes('queue')) batch.update(doc(firestore, `queue/1_${contributor.id}`), {
    status: 'invitation_expired', updatedAt: serverTimestamp(),
  });
  if (include.includes('private')) batch.set(doc(firestore, 'site/admin'), {
    activeTurnId: null, pendingInvitationId: null, updatedAt: serverTimestamp(),
  });
  return batch.commit();
}

before(async () => {
  environment = await initializeTestEnvironment({ projectId, firestore: { rules } });
});
beforeEach(async () => environment.clearFirestore());
after(async () => environment?.cleanup());

test('only an active admin can create a complete invitation transaction', async () => {
  await seed();
  await assertFails(inviteBatch(firestoreFor(contributor)));
  await environment.withSecurityRulesDisabled((context) => updateDoc(
    doc(context.firestore(), `admins/${admin.id}`), { active: false },
  ));
  await assertFails(inviteBatch(firestoreFor(admin)));
  await environment.withSecurityRulesDisabled((context) => updateDoc(
    doc(context.firestore(), `admins/${admin.id}`), { active: true },
  ));
  await assertSucceeds(inviteBatch(firestoreFor(admin)));
});

test('a clean private singleton is initialized without publishing or creating a turn', async () => {
  await seed();
  await environment.withSecurityRulesDisabled((context) =>
    deleteDoc(doc(context.firestore(), 'site/admin')),
  );
  const firestore = firestoreFor(admin);
  await assertSucceeds(inviteBatch(firestore));
  const [turns, publicSite, privateSite] = await Promise.all([
    getDocs(collection(firestore, 'turns')),
    getDoc(doc(firestore, 'site/public')),
    getDoc(doc(firestore, 'site/admin')),
  ]);
  if (!turns.empty || publicSite.data()?.turnStatus !== 'none'
    || publicSite.data()?.targetContributionNumber !== null
    || privateSite.data()?.pendingInvitationId !== 'invitation-1') {
    throw new Error('Invitation improperly started or published a turn.');
  }
});

test('partial invitation and isolated invited transitions are rejected', async () => {
  await seed();
  const firestore = firestoreFor(admin);
  for (const include of [
    ['invitation'], ['queue'], ['participation'],
    ['invitation','participation','queue'],
  ]) await assertFails(inviteBatch(firestore, { include }));
});

test('an admin cannot bypass invitation acceptance by creating a turn directly', async () => {
  await seed();
  await assertFails(setDoc(doc(firestoreFor(admin), 'turns/direct-turn'), {
    githubUserId: contributor.id, season: 1, status: 'active', targetContributionNumber: 1,
    startedAt: serverTimestamp(), dueAt: Timestamp.fromMillis(Date.now() + 86_400_000),
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
});

test('invitation deadline and duration are constrained', async () => {
  await seed();
  const firestore = firestoreFor(admin);
  await assertFails(inviteBatch(firestore, { acceptBy: Timestamp.fromMillis(Date.now() - 1_000) }));
  await assertFails(inviteBatch(firestore, { duration: 0 }));
  await assertFails(inviteBatch(firestore, { duration: 721 }));
  await assertFails(inviteBatch(firestore, { invitationOverrides: { season: 2 } }));
  await assertFails(inviteBatch(firestore, { invitationOverrides: { adminNote: 'private' } }));
});

test('inviting preserves queue ordering and promotion metadata', async () => {
  await seed();
  const promotedAt = Timestamp.fromMillis(Date.now() - 30_000);
  await environment.withSecurityRulesDisabled((context) => updateDoc(
    doc(context.firestore(), `queue/1_${contributor.id}`), { priority: 4, promotedAt },
  ));
  const firestore = firestoreFor(admin);
  const before = await getDoc(doc(firestore, `queue/1_${contributor.id}`));
  await assertSucceeds(inviteBatch(firestore));
  const after = await getDoc(doc(firestore, `queue/1_${contributor.id}`));
  if (after.data()?.priority !== 4
    || after.data()?.promotedAt?.toMillis() !== promotedAt.toMillis()
    || after.data()?.joinedAt?.toMillis() !== before.data()?.joinedAt?.toMillis()) {
    throw new Error('Invitation changed queue ordering metadata.');
  }
});

test('a pending invitation or active turn prevents another invitation', async () => {
  await seed({ secondContributor: true });
  await seedPending();
  await assertFails(inviteBatch(firestoreFor(admin), {
    invitationId: 'invitation-2', identity: other,
  }));
  await environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), 'site/admin'), {
    activeTurnId: 'active-turn', pendingInvitationId: null, updatedAt: Timestamp.now(),
  }));
  await assertFails(inviteBatch(firestoreFor(admin), {
    invitationId: 'invitation-2', identity: other,
  }));
});

test('invitations are private and invited users can get only their own', async () => {
  await seed({ secondContributor: true });
  await seedPending();
  await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), 'invitations/invitation-1')));
  await assertSucceeds(getDoc(doc(firestoreFor(contributor), 'invitations/invitation-1')));
  await assertFails(getDoc(doc(firestoreFor(other), 'invitations/invitation-1')));
  await assertFails(getDocs(collection(firestoreFor(contributor), 'invitations')));
  await assertSucceeds(getDocs(collection(firestoreFor(admin), 'invitations')));
});

test('the invited GitHub identity can accept in one complete transaction', async () => {
  await seed();
  await seedPending();
  const firestore = firestoreFor(contributor);
  await assertSucceeds(acceptTransaction(firestore));
  const [invitation, turn, participation, queue, privateSite, publicSite] = await Promise.all([
    getDoc(doc(firestoreFor(admin), 'invitations/invitation-1')),
    getDoc(doc(firestoreFor(admin), 'turns/turn-1')),
    getDoc(doc(firestore, `participation/1_${contributor.id}`)),
    getDoc(doc(firestoreFor(admin), `queue/1_${contributor.id}`)),
    getDoc(doc(firestoreFor(admin), 'site/admin')),
    getDoc(doc(firestore, 'site/public')),
  ]);
  if (invitation.data()?.status !== 'accepted' || invitation.data()?.turnId !== 'turn-1'
    || turn.data()?.status !== 'active' || turn.data()?.targetContributionNumber !== 1
    || participation.data()?.status !== 'active' || queue.data()?.status !== 'active'
    || privateSite.data()?.pendingInvitationId !== null
    || privateSite.data()?.activeTurnId !== 'turn-1'
    || publicSite.data()?.currentVersion !== 0 || publicSite.data()?.totalContributions !== 0
    || publicSite.data()?.turnStatus !== 'active') {
    throw new Error('Acceptance state was inconsistent.');
  }
});

test('wrong identity, expired deadline, arbitrary target, and arbitrary dueAt are rejected', async () => {
  await seed({ secondContributor: true });
  await seedPending();
  await assertFails(acceptBatch(firestoreFor(other), { identity: other }));
  await assertFails(acceptBatch(firestoreFor(contributor), { target: 2 }));
  await assertFails(acceptBatch(firestoreFor(contributor), {
    dueAt: Timestamp.fromMillis(Date.now() + 300 * 60 * 60 * 1000),
  }));
  await assertFails(acceptBatch(firestoreFor(contributor), {
    queueUpdates: { priority: 99 },
  }));
  await assertFails(acceptBatch(firestoreFor(contributor), {
    publicOverrides: { email: 'private@example.test' },
  }));
  await assertFails(acceptBatch(firestoreFor(contributor), {
    publicOverrides: { currentVersion: 1, totalContributions: 1 },
  }));
  await environment.withSecurityRulesDisabled((context) => updateDoc(
    doc(context.firestore(), 'invitations/invitation-1'),
    { acceptBy: Timestamp.fromMillis(Date.now() - 1_000) },
  ));
  await assertFails(acceptBatch(firestoreFor(contributor)));
});

test('partial acceptance and isolated active transitions are rejected', async () => {
  await seed();
  await seedPending();
  const firestore = firestoreFor(contributor);
  for (const omitted of ['invitation','turn','participation','queue','private','public']) {
    const include = ['invitation','turn','participation','queue','private','public']
      .filter((name) => name !== omitted);
    await assertFails(acceptBatch(firestore, { include }));
  }
  await assertFails(updateDoc(doc(firestore, `participation/1_${contributor.id}`), {
    status: 'active', updatedAt: serverTimestamp(),
  }));
});

test('admin cannot expire before acceptBy and can expire completely afterward', async () => {
  await seed();
  await seedPending();
  await assertFails(expireBatch(firestoreFor(admin)));
  await environment.withSecurityRulesDisabled((context) => updateDoc(
    doc(context.firestore(), 'invitations/invitation-1'),
    { acceptBy: Timestamp.fromMillis(Date.now() - 1_000) },
  ));
  await assertFails(expireBatch(firestoreFor(contributor)));
  await assertSucceeds(expireBatch(firestoreFor(admin)));
  const firestore = firestoreFor(admin);
  const [invitation, participation, queue, privateSite, turns, history, publicSite] = await Promise.all([
    getDoc(doc(firestore, 'invitations/invitation-1')),
    getDoc(doc(firestore, `participation/1_${contributor.id}`)),
    getDoc(doc(firestore, `queue/1_${contributor.id}`)),
    getDoc(doc(firestore, 'site/admin')),
    getDocs(collection(firestore, 'turns')),
    getDocs(collection(firestore, 'historyEvents')),
    getDoc(doc(firestore, 'site/public')),
  ]);
  if (invitation.data()?.status !== 'expired'
    || participation.data()?.status !== 'invitation_expired'
    || queue.data()?.status !== 'invitation_expired'
    || privateSite.data()?.pendingInvitationId !== null
    || !turns.empty || !history.empty
    || publicSite.data()?.currentVersion !== 0 || publicSite.data()?.turnStatus !== 'none') {
    throw new Error('Invitation expiration state was inconsistent.');
  }
});

test('partial invitation expiration is rejected', async () => {
  await seed();
  await seedPending({ expired: true });
  for (const omitted of ['invitation','participation','queue','private']) {
    const include = ['invitation','participation','queue','private'].filter((name) => name !== omitted);
    await assertFails(expireBatch(firestoreFor(admin), { include }));
  }
});

test('accepted and expired invitation records are terminal and undeletable', async () => {
  await seed();
  await seedPending();
  await assertSucceeds(acceptBatch(firestoreFor(contributor)));
  await assertFails(updateDoc(doc(firestoreFor(contributor), 'invitations/invitation-1'), {
    status: 'pending', updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(firestoreFor(admin), 'invitations/invitation-1'), {
    updatedAt: serverTimestamp(),
  }));
  await assertFails(getDoc(doc(firestoreFor(contributor), 'invitations/invitation-1')));
  await assertFails(deleteDoc(doc(firestoreFor(admin), 'invitations/invitation-1')));
  await environment.clearFirestore();
  await seed();
  await seedPending({ expired: true });
  await assertSucceeds(expireBatch(firestoreFor(admin)));
  await assertFails(updateDoc(doc(firestoreFor(admin), 'invitations/invitation-1'), {
    status: 'pending', updatedAt: serverTimestamp(),
  }));
  await assertFails(deleteDoc(doc(firestoreFor(admin), 'invitations/invitation-1')));
});

test('expiration releases the lock so the next waiting contributor can be invited', async () => {
  await seed({ secondContributor: true });
  await seedPending({ expired: true });
  await assertSucceeds(expireBatch(firestoreFor(admin)));
  await assertSucceeds(inviteBatch(firestoreFor(admin), {
    invitationId: 'invitation-2', identity: other,
  }));
});
