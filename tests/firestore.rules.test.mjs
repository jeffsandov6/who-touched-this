import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteField,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

const projectId = 'demo-who-touched-this';
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const defaultIdentity = {
  firebaseUid: 'firebase-user-1',
  githubUserId: '1001',
  githubUsername: 'octocat-one',
};
const adminIdentity = {
  firebaseUid: 'firebase-admin-1',
  githubUserId: '9001',
  githubUsername: 'project-owner',
};
const secondIdentity = {
  firebaseUid: 'firebase-user-2',
  githubUserId: '2002',
  githubUsername: 'octocat-two',
};

let testEnvironment;

function githubClaims(githubUserId) {
  return {
    firebase: {
      identities: { 'github.com': [githubUserId] },
      sign_in_provider: 'github.com',
    },
  };
}

function githubFirestore(identity = defaultIdentity) {
  return testEnvironment
    .authenticatedContext(identity.firebaseUid, githubClaims(identity.githubUserId))
    .firestore();
}

async function seedAdmin(identity = adminIdentity, overrides = {}) {
  await testEnvironment.withSecurityRulesDisabled((context) =>
    setDoc(doc(context.firestore(), `admins/${identity.githubUserId}`), {
      githubUserId: identity.githubUserId,
      role: 'owner',
      active: true,
      ...overrides,
    }),
  );
}

async function seedTurn() {
  await testEnvironment.withSecurityRulesDisabled((context) =>
    setDoc(doc(context.firestore(), 'turns/turn-1'), {
      githubUserId: defaultIdentity.githubUserId,
      season: 1,
      status: 'active',
      targetContributionNumber: 1,
      startedAt: Timestamp.now(),
      dueAt: Timestamp.fromMillis(Date.now() + 60_000),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }),
  );
}

function validContributor(identity = defaultIdentity, overrides = {}, omittedFields = []) {
  const contributor = {
    firebaseUid: identity.firebaseUid,
    githubUserId: identity.githubUserId,
    githubUsername: identity.githubUsername,
    displayName: 'Octo Contributor',
    email: 'private@example.test',
    socialUrl: 'https://example.test/octo',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };

  for (const field of omittedFields) delete contributor[field];
  return contributor;
}

function validParticipation(identity = defaultIdentity, overrides = {}) {
  return {
    githubUserId: identity.githubUserId,
    season: 1,
    status: 'waiting',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

function validQueueEntry(identity = defaultIdentity, overrides = {}) {
  return {
    githubUserId: identity.githubUserId,
    season: 1,
    status: 'waiting',
    joinedAt: serverTimestamp(),
    priority: 0,
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

function joinBatch(
  firestore,
  {
    identity = defaultIdentity,
    documentGithubUserId = identity.githubUserId,
    season = 1,
    contributorOverrides = {},
    omittedContributorFields = [],
    participationOverrides = {},
    queueOverrides = {},
    include = ['contributor', 'participation', 'queue'],
  } = {},
) {
  const batch = writeBatch(firestore);
  const deterministicId = `${season}_${documentGithubUserId}`;

  if (include.includes('contributor')) {
    batch.set(
      doc(firestore, `contributors/${documentGithubUserId}`),
      validContributor(identity, contributorOverrides, omittedContributorFields),
    );
  }
  if (include.includes('participation')) {
    batch.set(
      doc(firestore, `participation/${deterministicId}`),
      validParticipation(identity, participationOverrides),
    );
  }
  if (include.includes('queue')) {
    batch.set(
      doc(firestore, `queue/${deterministicId}`),
      validQueueEntry(identity, queueOverrides),
    );
  }

  return batch.commit();
}

function activationBatch(
  firestore,
  {
    identity = defaultIdentity,
    turnId = 'turn-activation-1',
    dueAt = Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1_000),
    targetContributionNumber = 1,
    turnOverrides = {},
    participationUpdates = {},
    queueUpdates = {},
    publicOverrides = {},
    include = ['turn', 'participation', 'queue', 'privateSite', 'publicSite'],
  } = {},
) {
  const batch = writeBatch(firestore);

  if (include.includes('turn')) {
    batch.set(doc(firestore, `turns/${turnId}`), {
      githubUserId: identity.githubUserId,
      season: 1,
      status: 'active',
      targetContributionNumber,
      startedAt: serverTimestamp(),
      dueAt,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...turnOverrides,
    });
  }
  if (include.includes('participation')) {
    batch.update(doc(firestore, `participation/1_${identity.githubUserId}`), {
      status: 'active',
      updatedAt: serverTimestamp(),
      ...participationUpdates,
    });
  }
  if (include.includes('queue')) {
    batch.update(doc(firestore, `queue/1_${identity.githubUserId}`), {
      status: 'active',
      updatedAt: serverTimestamp(),
      ...queueUpdates,
    });
  }
  if (include.includes('privateSite')) {
    batch.set(doc(firestore, 'site/admin'), {
      activeTurnId: turnId,
      updatedAt: serverTimestamp(),
    });
  }
  if (include.includes('publicSite')) {
    batch.set(doc(firestore, 'site/public'), {
      currentVersion: 0,
      totalContributions: 0,
      turnStatus: 'active',
      targetContributionNumber,
      currentContributor: {
        githubUsername: identity.githubUsername,
        displayName: 'Octo Contributor',
      },
      dueAt,
      updatedAt: serverTimestamp(),
      ...publicOverrides,
    });
  }

  return batch.commit();
}

before(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: { rules },
  });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await Promise.all([
      setDoc(doc(firestore, 'contributions/1'), { public: true }),
      setDoc(doc(firestore, 'site/public'), {
        currentVersion: 0,
        totalContributions: 0,
        turnStatus: 'none',
        targetContributionNumber: null,
        currentContributor: null,
        dueAt: null,
        updatedAt: Timestamp.now(),
      }),
    ]);
  });
});

after(async () => {
  await testEnvironment?.cleanup();
});

test('anonymous users can read public contribution records', async () => {
  const firestore = testEnvironment.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(firestore, 'contributions/1')));
});

test('anonymous users can read public site state', async () => {
  const firestore = testEnvironment.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(firestore, 'site/public')));
});

for (const path of [
  'contributors/1001',
  'participation/1_1001',
  'queue/1_1001',
  'turns/turn-1',
]) {
  test(`anonymous users cannot read ${path}`, async () => {
    const firestore = testEnvironment.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(firestore, path)));
  });
}

test('anonymous users cannot join', async () => {
  const firestore = testEnvironment.unauthenticatedContext().firestore();
  await assertFails(joinBatch(firestore));
});

test('authenticated non-GitHub users cannot join', async () => {
  const firestore = testEnvironment
    .authenticatedContext(defaultIdentity.firebaseUid, { email: 'person@example.test' })
    .firestore();
  await assertFails(joinBatch(firestore));
});

test('a GitHub user can atomically create one valid Season 1 join', async () => {
  await assertSucceeds(joinBatch(githubFirestore()));
});

test('a contributor display name is required', async () => {
  await assertFails(
    joinBatch(githubFirestore(), { omittedContributorFields: ['displayName'] }),
  );
});

for (const [description, displayName] of [
  ['empty', ''],
  ['whitespace-only', '   \t  '],
  ['leading whitespace', ' Octo Contributor'],
  ['trailing whitespace', 'Octo Contributor '],
  ['over-limit', 'x'.repeat(51)],
]) {
  test(`${description} contributor display name is rejected`, async () => {
    await assertFails(
      joinBatch(githubFirestore(), { contributorOverrides: { displayName } }),
    );
  });
}

test('a valid normalized contributor display name is accepted', async () => {
  await assertSucceeds(
    joinBatch(githubFirestore(), {
      contributorOverrides: { displayName: 'Octo Contributor' },
    }),
  );
});

test('an absent optional social link is accepted', async () => {
  await assertSucceeds(
    joinBatch(githubFirestore(), { omittedContributorFields: ['socialUrl'] }),
  );
});

for (const socialUrl of [
  'https://instagram.com/yourname',
  'http://example.test/profile',
]) {
  test(`normalized social link ${socialUrl} is accepted`, async () => {
    await assertSucceeds(
      joinBatch(githubFirestore(), { contributorOverrides: { socialUrl } }),
    );
  });
}

for (const [description, socialUrl] of [
  ['empty', ''],
  ['bare hostname', 'instagram.com/yourname'],
  ['javascript', 'javascript:alert(1)'],
  ['FTP', 'ftp://example.com/test'],
  ['plain text', 'jeffsando'],
  ['credentials', 'https://user:password@example.com/profile'],
  ['over-limit', `https://example.com/${'x'.repeat(2048)}`],
]) {
  test(`${description} stored social link is rejected`, async () => {
    await assertFails(
      joinBatch(githubFirestore(), { contributorOverrides: { socialUrl } }),
    );
  });
}

test('a user cannot create records under another GitHub ID', async () => {
  await assertFails(
    joinBatch(githubFirestore(), {
      documentGithubUserId: '2002',
      contributorOverrides: { githubUserId: '2002' },
      participationOverrides: { githubUserId: '2002' },
      queueOverrides: { githubUserId: '2002' },
    }),
  );
});

test('matching another username is insufficient to impersonate its GitHub ID', async () => {
  await assertFails(
    joinBatch(githubFirestore(), {
      documentGithubUserId: '2002',
      contributorOverrides: { githubUserId: '2002', githubUsername: 'octocat-one' },
      participationOverrides: { githubUserId: '2002' },
      queueOverrides: { githubUserId: '2002' },
    }),
  );
});

test('a user cannot join an arbitrary season', async () => {
  await assertFails(
    joinBatch(githubFirestore(), {
      season: 2,
      participationOverrides: { season: 2 },
      queueOverrides: { season: 2 },
    }),
  );
});

for (const status of ['active', 'completed', 'invited']) {
  test(`a user cannot start participation with status ${status}`, async () => {
    await assertFails(
      joinBatch(githubFirestore(), { participationOverrides: { status } }),
    );
  });
}

test('a user cannot assign a contribution number', async () => {
  await assertFails(
    joinBatch(githubFirestore(), { participationOverrides: { contributionNumber: 42 } }),
  );
});

test('a user cannot create queue priority above zero', async () => {
  await assertFails(joinBatch(githubFirestore(), { queueOverrides: { priority: 10 } }));
});

test('a user cannot self-set promotedAt', async () => {
  await assertFails(
    joinBatch(githubFirestore(), { queueOverrides: { promotedAt: serverTimestamp() } }),
  );
});

test('a user cannot self-set privileged sortOrder', async () => {
  await assertFails(joinBatch(githubFirestore(), { queueOverrides: { sortOrder: 1 } }));
});

test('a user cannot create an active queue entry', async () => {
  await assertFails(joinBatch(githubFirestore(), { queueOverrides: { status: 'active' } }));
});

test('queue entries cannot be read, including by their owner', async () => {
  const firestore = githubFirestore();
  await assertSucceeds(joinBatch(firestore));
  await assertFails(getDoc(doc(firestore, 'queue/1_1001')));
});

test('the full queue cannot be listed', async () => {
  const firestore = githubFirestore();
  await assertSucceeds(joinBatch(firestore));
  await assertFails(getDocs(collection(firestore, 'queue')));
});

test('a user cannot read another contributor record', async () => {
  const firestore = githubFirestore();
  await testEnvironment.withSecurityRulesDisabled((context) =>
    setDoc(doc(context.firestore(), 'contributors/2002'), { private: true }),
  );
  await assertFails(getDoc(doc(firestore, 'contributors/2002')));
});

test('a user cannot read another participation record', async () => {
  const firestore = githubFirestore();
  await testEnvironment.withSecurityRulesDisabled((context) =>
    setDoc(doc(context.firestore(), 'participation/1_2002'), { private: true }),
  );
  await assertFails(getDoc(doc(firestore, 'participation/1_2002')));
});

test('a user can read their own Season 1 participation record', async () => {
  const firestore = githubFirestore();
  await assertSucceeds(joinBatch(firestore));
  await assertSucceeds(getDoc(doc(firestore, 'participation/1_1001')));
});

test('a user can read their own contributor record', async () => {
  const firestore = githubFirestore();
  await assertSucceeds(joinBatch(firestore));
  await assertSucceeds(getDoc(doc(firestore, 'contributors/1001')));
});

test('a user cannot update or delete their operational records', async () => {
  const firestore = githubFirestore();
  await assertSucceeds(joinBatch(firestore));
  await assertFails(updateDoc(doc(firestore, 'contributors/1001'), { displayName: 'Changed' }));
  await assertFails(updateDoc(doc(firestore, 'participation/1_1001'), { status: 'active' }));
  await assertFails(updateDoc(doc(firestore, 'queue/1_1001'), { priority: 99 }));
  await assertFails(deleteDoc(doc(firestore, 'contributors/1001')));
  await assertFails(deleteDoc(doc(firestore, 'participation/1_1001')));
  await assertFails(deleteDoc(doc(firestore, 'queue/1_1001')));
});

test('extra contributor privilege fields are rejected', async () => {
  await assertFails(joinBatch(githubFirestore(), { contributorOverrides: { isAdmin: true } }));
});

test('malformed contributor fields are rejected', async () => {
  await assertFails(
    joinBatch(githubFirestore(), {
      contributorOverrides: { displayName: '   ', email: 'not-an-email' },
    }),
  );
});

test('partial join writes are rejected', async () => {
  await assertFails(joinBatch(githubFirestore(), { include: ['contributor', 'participation'] }));
});

test('a second join for the same Season 1 GitHub identity is rejected', async () => {
  const firestore = githubFirestore();
  await assertSucceeds(joinBatch(firestore));
  await assertFails(joinBatch(firestore));
});

test('anonymous users cannot read admin records', async () => {
  await seedAdmin();
  const firestore = testEnvironment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(firestore, 'admins/9001')));
});

test('ordinary GitHub users cannot list admins or read another admin record', async () => {
  await seedAdmin();
  const firestore = githubFirestore();
  await assertFails(getDocs(collection(firestore, 'admins')));
  await assertFails(getDoc(doc(firestore, 'admins/9001')));
});

test('an authenticated GitHub user may get only their own admin authorization record', async () => {
  await seedAdmin();
  const firestore = githubFirestore(adminIdentity);
  await assertSucceeds(getDoc(doc(firestore, 'admins/9001')));
  await assertFails(getDoc(doc(firestore, 'admins/1001')));
});

test('clients cannot create admin records', async () => {
  const firestore = githubFirestore(adminIdentity);
  await assertFails(
    setDoc(doc(firestore, 'admins/9001'), {
      githubUserId: '9001',
      role: 'owner',
      active: true,
    }),
  );
});

test('clients cannot update or delete admin records', async () => {
  await seedAdmin();
  const firestore = githubFirestore(adminIdentity);
  await assertFails(updateDoc(doc(firestore, 'admins/9001'), { active: false }));
  await assertFails(deleteDoc(doc(firestore, 'admins/9001')));
});

test('an inactive admin is not authorized for private admin reads', async () => {
  await seedAdmin(adminIdentity, { active: false });
  await assertSucceeds(joinBatch(githubFirestore()));
  const firestore = githubFirestore(adminIdentity);
  await assertFails(getDocs(collection(firestore, 'queue')));
  await assertFails(getDocs(collection(firestore, 'contributors')));
});

test('an active allowlisted admin can read and list the private queue', async () => {
  await seedAdmin();
  await assertSucceeds(joinBatch(githubFirestore()));
  const firestore = githubFirestore(adminIdentity);
  await assertSucceeds(getDoc(doc(firestore, 'queue/1_1001')));
  await assertSucceeds(getDocs(collection(firestore, 'queue')));
});

test('matching an admin username is insufficient without the matching stable GitHub ID', async () => {
  await seedAdmin();
  await assertSucceeds(joinBatch(githubFirestore()));
  const impersonator = {
    firebaseUid: 'firebase-impersonator',
    githubUserId: '8008',
    githubUsername: adminIdentity.githubUsername,
  };
  await assertFails(getDocs(collection(githubFirestore(impersonator), 'queue')));
});

test('an active admin can read contributor and participation records', async () => {
  await seedAdmin();
  await assertSucceeds(joinBatch(githubFirestore()));
  const firestore = githubFirestore(adminIdentity);
  await assertSucceeds(getDoc(doc(firestore, 'contributors/1001')));
  await assertSucceeds(getDocs(collection(firestore, 'contributors')));
  await assertSucceeds(getDoc(doc(firestore, 'participation/1_1001')));
  await assertSucceeds(getDocs(collection(firestore, 'participation')));
});

test('an active admin can read turns but cannot write them', async () => {
  await seedAdmin();
  await seedTurn();
  const firestore = githubFirestore(adminIdentity);
  await assertSucceeds(getDoc(doc(firestore, 'turns/turn-1')));
  await assertSucceeds(getDocs(collection(firestore, 'turns')));
  await assertFails(updateDoc(doc(firestore, 'turns/turn-1'), { status: 'merged' }));
});

test('an active admin can promote an existing waiting queue entry', async () => {
  await seedAdmin();
  await assertSucceeds(joinBatch(githubFirestore()));
  const firestore = githubFirestore(adminIdentity);
  await assertSucceeds(
    updateDoc(doc(firestore, 'queue/1_1001'), {
      priority: 1,
      promotedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
});

test('an active admin can restore natural order and remove promotedAt', async () => {
  await seedAdmin();
  await assertSucceeds(joinBatch(githubFirestore()));
  const firestore = githubFirestore(adminIdentity);
  const queueReference = doc(firestore, 'queue/1_1001');
  await assertSucceeds(
    updateDoc(queueReference, {
      priority: 1,
      promotedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
  await assertSucceeds(
    updateDoc(queueReference, {
      priority: 0,
      promotedAt: deleteField(),
      updatedAt: serverTimestamp(),
    }),
  );
});

test('ordinary users cannot alter queue priority', async () => {
  const firestore = githubFirestore();
  await assertSucceeds(joinBatch(firestore));
  await assertFails(
    updateDoc(doc(firestore, 'queue/1_1001'), {
      priority: 1,
      promotedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
});

for (const [description, updates] of [
  ['GitHub identity', { githubUserId: '2002' }],
  ['season', { season: 2 }],
  ['join timestamp', { joinedAt: serverTimestamp() }],
  ['status', { status: 'active' }],
  ['unsupported field', { contributionNumber: 42 }],
]) {
  test(`an admin cannot change queue ${description}`, async () => {
    await seedAdmin();
    await assertSucceeds(joinBatch(githubFirestore()));
    await assertFails(
      updateDoc(doc(githubFirestore(adminIdentity), 'queue/1_1001'), {
        ...updates,
        updatedAt: serverTimestamp(),
      }),
    );
  });
}

test('an admin cannot set invalid priority or promotion metadata', async () => {
  await seedAdmin();
  await assertSucceeds(joinBatch(githubFirestore()));
  const queueReference = doc(githubFirestore(adminIdentity), 'queue/1_1001');
  await assertFails(
    updateDoc(queueReference, { priority: -1, updatedAt: serverTimestamp() }),
  );
  await assertFails(
    updateDoc(queueReference, { priority: 1, updatedAt: serverTimestamp() }),
  );
  await assertFails(
    updateDoc(queueReference, {
      priority: 2147483648,
      promotedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
});

test('an admin cannot create or delete queue entries', async () => {
  await seedAdmin();
  const firestore = githubFirestore(adminIdentity);
  await assertFails(
    setDoc(doc(firestore, 'queue/1_2002'), {
      githubUserId: '2002',
      season: 1,
      status: 'waiting',
      joinedAt: serverTimestamp(),
      priority: 0,
      updatedAt: serverTimestamp(),
    }),
  );
  await assertSucceeds(joinBatch(githubFirestore()));
  await assertFails(deleteDoc(doc(firestore, 'queue/1_1001')));
});

test('ordinary and non-GitHub users cannot start a turn', async () => {
  await assertSucceeds(joinBatch(githubFirestore()));
  await assertFails(activationBatch(githubFirestore()));
  const nonGitHub = testEnvironment
    .authenticatedContext('firebase-email-user', { email: 'person@example.test' })
    .firestore();
  await assertFails(activationBatch(nonGitHub));
});

test('an inactive admin cannot start a turn', async () => {
  await seedAdmin(adminIdentity, { active: false });
  await assertSucceeds(joinBatch(githubFirestore()));
  await assertFails(activationBatch(githubFirestore(adminIdentity)));
});

test('an active admin can atomically activate one complete turn', async () => {
  await seedAdmin();
  await assertSucceeds(joinBatch(githubFirestore()));
  const firestore = githubFirestore(adminIdentity);
  await assertSucceeds(activationBatch(firestore));

  const [turn, participation, queue, privateSite, publicSite] = await Promise.all([
    getDoc(doc(firestore, 'turns/turn-activation-1')),
    getDoc(doc(firestore, 'participation/1_1001')),
    getDoc(doc(firestore, 'queue/1_1001')),
    getDoc(doc(firestore, 'site/admin')),
    getDoc(doc(firestore, 'site/public')),
  ]);
  if (
    turn.data()?.targetContributionNumber !== 1 ||
    participation.data()?.status !== 'active' ||
    queue.data()?.status !== 'active' ||
    privateSite.data()?.activeTurnId !== 'turn-activation-1' ||
    publicSite.data()?.currentVersion !== 0 ||
    publicSite.data()?.turnStatus !== 'active'
  ) {
    throw new Error('Valid activation did not produce the expected consistent state.');
  }
});

test('activation initializes site/public when the clean emulator document is absent', async () => {
  await seedAdmin();
  await assertSucceeds(joinBatch(githubFirestore()));
  await testEnvironment.withSecurityRulesDisabled((context) =>
    deleteDoc(doc(context.firestore(), 'site/public')),
  );
  await assertSucceeds(activationBatch(githubFirestore(adminIdentity)));
});

test('activation targets currentVersion plus one without incrementing the public version', async () => {
  await seedAdmin();
  await assertSucceeds(joinBatch(githubFirestore()));
  await testEnvironment.withSecurityRulesDisabled((context) =>
    setDoc(doc(context.firestore(), 'site/public'), {
      currentVersion: 11,
      totalContributions: 11,
      turnStatus: 'none',
      targetContributionNumber: null,
      currentContributor: null,
      dueAt: null,
      updatedAt: Timestamp.now(),
    }),
  );
  const firestore = githubFirestore(adminIdentity);
  await assertSucceeds(
    activationBatch(firestore, {
      targetContributionNumber: 12,
      publicOverrides: { currentVersion: 11, totalContributions: 11 },
    }),
  );
  const publicSite = await getDoc(doc(firestore, 'site/public'));
  if (
    publicSite.data()?.currentVersion !== 11 ||
    publicSite.data()?.targetContributionNumber !== 12
  ) {
    throw new Error('Activation consumed the target contribution number.');
  }
});

test('activation preserves existing queue priority and promotion metadata', async () => {
  await seedAdmin();
  await assertSucceeds(joinBatch(githubFirestore()));
  const firestore = githubFirestore(adminIdentity);
  await assertSucceeds(
    updateDoc(doc(firestore, 'queue/1_1001'), {
      priority: 1,
      promotedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
  await assertSucceeds(activationBatch(firestore));
  const queue = await getDoc(doc(firestore, 'queue/1_1001'));
  if (queue.data()?.priority !== 1 || !queue.data()?.promotedAt) {
    throw new Error('Activation did not preserve queue promotion metadata.');
  }
});

for (const include of [
  ['turn', 'participation', 'queue', 'privateSite'],
  ['turn', 'queue', 'privateSite', 'publicSite'],
  ['turn', 'participation', 'privateSite', 'publicSite'],
]) {
  test(`partial activation is rejected when ${include.length} related writes are present`, async () => {
    await seedAdmin();
    await assertSucceeds(joinBatch(githubFirestore()));
    await assertFails(activationBatch(githubFirestore(adminIdentity), { include }));
  });
}

test('queue-only and participation-only active transitions are rejected', async () => {
  await seedAdmin();
  await assertSucceeds(joinBatch(githubFirestore()));
  const firestore = githubFirestore(adminIdentity);
  await assertFails(
    updateDoc(doc(firestore, 'queue/1_1001'), {
      status: 'active',
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(
    updateDoc(doc(firestore, 'participation/1_1001'), {
      status: 'active',
      updatedAt: serverTimestamp(),
    }),
  );
});

for (const [description, options] of [
  ['mismatched GitHub identity', { turnOverrides: { githubUserId: '2002' } }],
  ['arbitrary season', { turnOverrides: { season: 2 } }],
  ['invalid turn status', { turnOverrides: { status: 'invited' } }],
  ['tampered target contribution number', { targetContributionNumber: 2 }],
  ['past deadline', { dueAt: Timestamp.fromMillis(Date.now() - 60_000) }],
]) {
  test(`${description} is rejected during activation`, async () => {
    await seedAdmin();
    await assertSucceeds(joinBatch(githubFirestore()));
    await assertFails(activationBatch(githubFirestore(adminIdentity), options));
  });
}

for (const [description, queueUpdates] of [
  ['joinedAt mutation', { joinedAt: serverTimestamp() }],
  ['priority mutation', { priority: 5 }],
  ['identity mutation', { githubUserId: '2002' }],
  ['unsupported field', { contributionNumber: 1 }],
]) {
  test(`activation rejects queue ${description}`, async () => {
    await seedAdmin();
    await assertSucceeds(joinBatch(githubFirestore()));
    await assertFails(
      activationBatch(githubFirestore(adminIdentity), { queueUpdates }),
    );
  });
}

test('activation rejects a private email or unsupported field in site/public', async () => {
  await seedAdmin();
  await assertSucceeds(joinBatch(githubFirestore()));
  const firestore = githubFirestore(adminIdentity);
  await assertFails(
    activationBatch(firestore, { publicOverrides: { email: 'private@example.test' } }),
  );
  await assertFails(
    activationBatch(firestore, {
      publicOverrides: {
        currentContributor: {
          githubUsername: defaultIdentity.githubUsername,
          displayName: 'Octo Contributor',
          email: 'private@example.test',
        },
      },
    }),
  );
});

test('activation cannot alter the contributor record', async () => {
  await seedAdmin();
  await assertSucceeds(joinBatch(githubFirestore()));
  const firestore = githubFirestore(adminIdentity);
  const batch = writeBatch(firestore);
  batch.update(doc(firestore, 'contributors/1001'), { email: 'changed@example.test' });
  await assertFails(batch.commit());
});

test('a second active turn attempt is rejected without consuming a new number', async () => {
  await seedAdmin();
  await assertSucceeds(joinBatch(githubFirestore()));
  await assertSucceeds(joinBatch(githubFirestore(secondIdentity), { identity: secondIdentity }));
  const firestore = githubFirestore(adminIdentity);
  await assertSucceeds(activationBatch(firestore));
  await assertFails(
    activationBatch(firestore, {
      identity: secondIdentity,
      turnId: 'turn-activation-2',
      targetContributionNumber: 1,
    }),
  );
});

test('anonymous users cannot read the private active-turn singleton', async () => {
  const firestore = testEnvironment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(firestore, 'site/admin')));
});

test('an admin cannot update contributors or participation records', async () => {
  await seedAdmin();
  await assertSucceeds(joinBatch(githubFirestore()));
  const firestore = githubFirestore(adminIdentity);
  await assertFails(updateDoc(doc(firestore, 'contributors/1001'), { email: 'new@example.test' }));
  await assertFails(updateDoc(doc(firestore, 'participation/1_1001'), { status: 'active' }));
});

test('an admin still cannot write public contribution history or site state', async () => {
  await seedAdmin();
  const firestore = githubFirestore(adminIdentity);
  await assertFails(setDoc(doc(firestore, 'contributions/2'), { public: false }));
  await assertFails(setDoc(doc(firestore, 'site/public'), { public: false }));
});

test('authenticated clients cannot write public contribution history', async () => {
  const firestore = githubFirestore();
  await assertFails(setDoc(doc(firestore, 'contributions/2'), { public: false }));
});

test('authenticated clients cannot write public site state', async () => {
  const firestore = githubFirestore();
  await assertFails(setDoc(doc(firestore, 'site/public'), { public: false }));
});

test('anonymous clients cannot write public records', async () => {
  const firestore = testEnvironment.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(firestore, 'contributions/2'), { public: false }));
  await assertFails(setDoc(doc(firestore, 'site/public'), { public: false }));
});
