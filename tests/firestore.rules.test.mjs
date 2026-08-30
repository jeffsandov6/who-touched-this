import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
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
      setDoc(doc(firestore, 'site/public'), { public: true }),
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
