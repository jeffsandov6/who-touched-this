import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, Timestamp, updateDoc } from 'firebase/firestore';

const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
const projectId = `wtt-snapshot-rules-${process.pid}`;
const admin = { uid: 'admin-uid', id: '9001' };
const contributor = { uid: 'contributor-uid', id: '1001' };
let environment;

function claims(id) {
  return { firebase: { identities: { 'github.com': [id] }, sign_in_provider: 'github.com' } };
}

before(async () => { environment = await initializeTestEnvironment({ projectId, firestore: { rules } }); });
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    await Promise.all([
      setDoc(doc(context.firestore(), `admins/${admin.id}`), { githubUserId: admin.id, active: true, role: 'owner' }),
      setDoc(doc(context.firestore(), 'contributors/1001'), { email: 'private@example.test' }),
      setDoc(doc(context.firestore(), 'contributionSnapshots/42'), {
        schemaVersion: 1, contributionNumber: 42, captureId: 'capture', beforeGitSha: 'a'.repeat(40), afterGitSha: 'b'.repeat(40),
        canonicalRoutes: ['/'], additionalRoutes: [], capturedRoutes: ['/'], routes: [],
        manifestStoragePath: 'public/history/contributions/042/capture/manifest.json',
        viewport: { width: 1440, height: 900, deviceScaleFactor: 1, fullPage: true }, archivedAt: Timestamp.now(),
      }),
      setDoc(doc(context.firestore(), 'contributionSnapshots/43'), {
        schemaVersion: 2, contributionNumber: 43, captureId: 'tiled-capture', beforeGitSha: 'c'.repeat(40), afterGitSha: 'd'.repeat(40),
        canonicalRoutes: ['/'], additionalRoutes: [], capturedRoutes: ['/'],
        routes: [{ route: '/', routeKey: 'home', before: { width: 1440, height: 900, tiles: [{ index: 0, y: 0, width: 1440, height: 900, storagePath: 'public/history/contributions/043/tiled-capture/before/home/tile-000.png', sha256: 'e'.repeat(64) }] }, after: { width: 1440, height: 900, tiles: [{ index: 0, y: 0, width: 1440, height: 900, storagePath: 'public/history/contributions/043/tiled-capture/after/home/tile-000.png', sha256: 'f'.repeat(64) }] } }],
        manifestStoragePath: 'public/history/contributions/043/tiled-capture/manifest.json',
        viewport: { width: 1440, height: 900, deviceScaleFactor: 1, captureMode: 'tiled-document', tileHeight: 3600 }, archivedAt: Timestamp.now(),
      }),
    ]);
  });
});
after(async () => environment?.cleanup());

test('public and authenticated clients can get and list finalized snapshot metadata', async () => {
  for (const firestore of [
    environment.unauthenticatedContext().firestore(),
    environment.authenticatedContext(contributor.uid, claims(contributor.id)).firestore(),
  ]) {
    await assertSucceeds(getDoc(doc(firestore, 'contributionSnapshots/42')));
    await assertSucceeds(getDoc(doc(firestore, 'contributionSnapshots/43')));
    const snapshots = await assertSucceeds(getDocs(collection(firestore, 'contributionSnapshots')));
    assert.equal(snapshots.size, 2);
  }
});

test('no browser role can create, update, or delete snapshot metadata', async () => {
  for (const firestore of [
    environment.unauthenticatedContext().firestore(),
    environment.authenticatedContext(contributor.uid, claims(contributor.id)).firestore(),
    environment.authenticatedContext(admin.uid, claims(admin.id)).firestore(),
  ]) {
    await assertFails(setDoc(doc(firestore, 'contributionSnapshots/44'), { schemaVersion: 2 }));
    await assertFails(updateDoc(doc(firestore, 'contributionSnapshots/42'), { captureId: 'replacement' }));
    await assertFails(deleteDoc(doc(firestore, 'contributionSnapshots/42')));
  }
});

test('snapshot public reads do not expose unrelated private contributor records', async () => {
  await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), 'contributors/1001')));
});
