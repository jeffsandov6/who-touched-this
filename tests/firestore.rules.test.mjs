import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const projectId = 'demo-who-touched-this';
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

const publicDocumentPaths = ['contributions/1', 'site/public'];
const privateDocumentPaths = [
  'contributors/12345',
  'participation/season-1_12345',
  'queue/season-1_12345',
  'turns/turn-1',
];

let testEnvironment;

before(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: { rules },
  });

  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    const seedWrites = [...publicDocumentPaths, ...privateDocumentPaths].map((path) =>
      setDoc(doc(firestore, path), { seededForRulesTest: true }),
    );
    await Promise.all(seedWrites);
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

for (const path of privateDocumentPaths) {
  test(`anonymous users cannot read ${path}`, async () => {
    const firestore = testEnvironment.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(firestore, path)));
  });
}

for (const path of publicDocumentPaths) {
  test(`anonymous users cannot write ${path}`, async () => {
    const firestore = testEnvironment.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(firestore, path), { untrustedWrite: true }));
  });
}

for (const path of privateDocumentPaths) {
  test(`anonymous users cannot write ${path}`, async () => {
    const firestore = testEnvironment.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(firestore, path), { untrustedWrite: true }));
  });
}
