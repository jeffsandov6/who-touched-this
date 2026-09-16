import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';

const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
const projectId = `wtt-founder-rules-${process.pid}`;
let environment;
const claims = { firebase: { identities: { 'github.com': ['9001'] }, sign_in_provider: 'github.com' } };

before(async () => { environment = await initializeTestEnvironment({ projectId, firestore: { rules } }); });
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const now = Timestamp.now();
    await Promise.all([
      setDoc(doc(context.firestore(), 'admins/9001'), { githubUserId: '9001', active: true, role: 'owner' }),
      setDoc(doc(context.firestore(), 'contributions/0'), {
        number: 0, season: 1, contributionKind: 'founder_seed', displayName: 'Founder',
        githubUsername: 'jeffsandov6', summary: 'Seed', prNumber: 27,
        prUrl: 'https://github.com/jeffsandov6/who-touched-this/pull/27',
        beforeGitSha: 'a'.repeat(40), afterGitSha: 'b'.repeat(40), mergedAt: now, createdAt: now,
      }),
    ]);
  });
});
after(async () => environment?.cleanup());

test('Founder Contribution #000 remains publicly readable', async () => {
  await assertSucceeds(getDoc(doc(environment.unauthenticatedContext().firestore(), 'contributions/0')));
});

test('even a browser owner cannot directly create founder contribution or History records', async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await deleteDoc(doc(context.firestore(), 'contributions/0'));
  });
  const firestore = environment.authenticatedContext('owner-uid', claims).firestore();
  await assertFails(setDoc(doc(firestore, 'contributions/0'), { number: 0 }));
  await assertFails(setDoc(doc(firestore, 'historyEvents/founder_seed_000'), {
    type: 'contribution', contributionKind: 'founder_seed', season: 1,
    displayName: 'Founder', githubUsername: 'jeffsandov6', targetContributionNumber: 0,
    contributionNumber: 0, occurredAt: Timestamp.now(),
  }));
});
