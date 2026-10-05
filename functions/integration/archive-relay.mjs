import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { deleteApp, initializeApp as initializeClientApp } from 'firebase/app';
import { connectAuthEmulator, getAuth as getClientAuth, signInWithCustomToken } from 'firebase/auth';
import {
  connectFirestoreEmulator, doc, getFirestore as getClientFirestore,
  serverTimestamp, Timestamp as ClientTimestamp, writeBatch,
} from 'firebase/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST
  || !process.env.FIREBASE_STORAGE_EMULATOR_HOST || process.env.GCLOUD_PROJECT !== 'who-touched-this') {
  throw new Error('Refusing to run archive-relay integration outside the complete who-touched-this emulators.');
}
if (!getApps().length) initializeApp({ projectId: 'who-touched-this', storageBucket: 'who-touched-this.firebasestorage.app' });
const adminFirestore = getFirestore();
const now = Timestamp.now();
const contributor = { uid: 'archive-contributor', id: '1001', username: 'archive-one' };
const next = { uid: 'archive-next', id: '2002', username: 'archive-two' };
const owner = { uid: 'archive-owner', id: '9001' };
const beforeSha = 'a'.repeat(40);
const afterSha = 'b'.repeat(40);

await Promise.all([
  adminFirestore.doc(`admins/${owner.id}`).set({ githubUserId: owner.id, role: 'owner', active: true }),
  adminFirestore.doc(`contributors/${contributor.id}`).set({
    firebaseUid: contributor.uid, githubUserId: contributor.id, githubUsername: contributor.username,
    displayName: 'Archive Contributor', email: 'archive-one@example.test', createdAt: now, updatedAt: now,
  }),
  adminFirestore.doc(`contributors/${next.id}`).set({
    firebaseUid: next.uid, githubUserId: next.id, githubUsername: next.username,
    displayName: 'Next Contributor', email: 'archive-two@example.test', createdAt: now, updatedAt: now,
  }),
  adminFirestore.doc(`participation/1_${contributor.id}`).set({ githubUserId: contributor.id, season: 1, status: 'active', createdAt: now, updatedAt: now }),
  adminFirestore.doc(`queue/1_${contributor.id}`).set({ githubUserId: contributor.id, season: 1, status: 'active', joinedAt: now, priority: 0, updatedAt: now }),
  adminFirestore.doc(`participation/1_${next.id}`).set({ githubUserId: next.id, season: 1, status: 'waiting', createdAt: now, updatedAt: now }),
  adminFirestore.doc(`queue/1_${next.id}`).set({ githubUserId: next.id, season: 1, status: 'waiting', joinedAt: now, priority: 0, updatedAt: now }),
  adminFirestore.doc('turns/archive-turn').set({
    githubUserId: contributor.id, season: 1, status: 'under_review', targetContributionNumber: 1,
    startedAt: now, dueAt: Timestamp.fromMillis(now.toMillis() + 168 * 60 * 60 * 1000),
    prNumber: 321, prUrl: 'https://github.com/jeffsandov6/who-touched-this/pull/321',
    submittedAt: now, reviewStartedAt: now, createdAt: now, updatedAt: now,
  }),
  adminFirestore.doc('site/admin').set({ activeTurnId: 'archive-turn', pendingInvitationId: null, pendingArchiveContributionNumber: null, updatedAt: now }),
  adminFirestore.doc('site/public').set({
    currentVersion: 0, totalContributions: 0, turnStatus: 'under_review', targetContributionNumber: 1,
    currentContributor: { githubUsername: contributor.username, displayName: 'Archive Contributor' },
    dueAt: Timestamp.fromMillis(now.toMillis() + 168 * 60 * 60 * 1000), updatedAt: now,
  }),
]);

await getAuth().importUsers([owner, next].map((identity) => ({
  uid: identity.uid,
  providerData: [{ uid: identity.id, providerId: 'github.com', email: `${identity.uid}@example.test`, displayName: identity.uid }],
})));

async function clientFor(identity, name) {
  const token = await getAuth().createCustomToken(identity.uid);
  const app = initializeClientApp({ apiKey: 'demo-key', projectId: 'who-touched-this' }, name);
  const auth = getClientAuth(app);
  connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  const credential = await signInWithCustomToken(auth, token);
  const firestore = getClientFirestore(app);
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(firestore, host, Number(port));
  return { app, firestore, idToken: await credential.user.getIdToken() };
}

const ownerClient = await clientFor(owner, 'archive-relay-owner');
const merge = writeBatch(ownerClient.firestore);
merge.update(doc(ownerClient.firestore, 'turns/archive-turn'), { status: 'merged', mergedAt: serverTimestamp(), endedAt: serverTimestamp(), updatedAt: serverTimestamp() });
merge.update(doc(ownerClient.firestore, `participation/1_${contributor.id}`), { status: 'completed', contributionNumber: 1, updatedAt: serverTimestamp() });
merge.update(doc(ownerClient.firestore, `queue/1_${contributor.id}`), { status: 'completed', contributionNumber: 1, updatedAt: serverTimestamp() });
merge.set(doc(ownerClient.firestore, 'contributions/1'), {
  number: 1, season: 1, githubUserId: contributor.id, githubUsername: contributor.username,
  displayName: 'Archive Contributor', summary: 'Archive relay integration.', prNumber: 321,
  prUrl: 'https://github.com/jeffsandov6/who-touched-this/pull/321', beforeGitSha: beforeSha, afterGitSha: afterSha,
  archiveStatus: 'pending', mergedAt: serverTimestamp(), createdAt: serverTimestamp(),
});
merge.set(doc(ownerClient.firestore, 'historyEvents/archive-turn'), {
  type: 'contribution', season: 1, displayName: 'Archive Contributor', githubUsername: contributor.username,
  targetContributionNumber: 1, contributionNumber: 1, occurredAt: serverTimestamp(),
});
merge.set(doc(ownerClient.firestore, 'site/admin'), { activeTurnId: null, pendingInvitationId: null, pendingArchiveContributionNumber: 1, updatedAt: serverTimestamp() });
merge.set(doc(ownerClient.firestore, 'site/public'), {
  currentVersion: 1, totalContributions: 1, turnStatus: 'none', targetContributionNumber: null,
  currentContributor: null, dueAt: null, updatedAt: serverTimestamp(),
});
await merge.commit();

assert.equal((await adminFirestore.doc('contributions/1').get()).data()?.archiveStatus, 'pending');
assert.equal((await adminFirestore.doc('site/public').get()).data()?.currentVersion, 1);
assert.equal((await adminFirestore.doc('site/admin').get()).data()?.pendingArchiveContributionNumber, 1);

function invitationBatch(id) {
  const batch = writeBatch(ownerClient.firestore);
  batch.set(doc(ownerClient.firestore, `invitations/${id}`), {
    githubUserId: next.id, season: 1, status: 'pending', invitedAt: serverTimestamp(),
    acceptBy: ClientTimestamp.fromMillis(Date.now() + 60 * 60 * 1000), turnDurationHours: 168,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  batch.update(doc(ownerClient.firestore, `participation/1_${next.id}`), { status: 'invited', invitationId: id, updatedAt: serverTimestamp() });
  batch.update(doc(ownerClient.firestore, `queue/1_${next.id}`), { status: 'invited', updatedAt: serverTimestamp() });
  batch.set(doc(ownerClient.firestore, 'site/admin'), { activeTurnId: null, pendingInvitationId: id, pendingArchiveContributionNumber: null, updatedAt: serverTimestamp() });
  return batch.commit();
}
await assert.rejects(invitationBatch('blocked-invitation'));
assert.equal((await adminFirestore.doc('invitations/blocked-invitation').get()).exists, false);

const captureId = 'archive-relay-integration';
const prefix = `public/history/contributions/001/${captureId}`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const checksum = createHash('sha256').update(png).digest('hex');
const routes = ['/', '/random', '/thoughts'];
const keys = ['home', 'random', 'thoughts'];
const manifest = {
  schemaVersion: 2, contributionNumber: 1, contributionLabel: '001', captureId,
  capturedAt: '2026-01-01T00:00:00.000Z', git: { before: beforeSha, after: afterSha },
  routeRegistry: { path: 'src/platform/config/editable-routes.json', revision: afterSha },
  canonicalRoutes: routes, additionalRoutes: [], capturedRoutes: routes,
  capture: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, captureMode: 'tiled-document', tileHeight: 3600, format: 'png', locale: 'en-US', timezoneId: 'UTC', waitMs: 1500, maximumTileCount: 64, maximumTotalScreenshotPixels: 384_000_000, maximumTotalScreenshotBytes: 160 * 1024 * 1024 },
  screenshots: routes.map((route, index) => ({
    route, key: keys[index],
    before: { width: 1, height: 1, tiles: [{ index: 0, y: 0, width: 1, height: 1, path: `before/${keys[index]}/tile-000.png`, sha256: checksum, bytes: png.length }] },
    after: { width: 1, height: 1, tiles: [{ index: 0, y: 0, width: 1, height: 1, path: `after/${keys[index]}/tile-000.png`, sha256: checksum, bytes: png.length }] },
  })),
};
const bucket = getStorage().bucket();
const common = { contributionNumber: '1', contributionLabel: '001', captureId };
await bucket.file(`${prefix}/manifest.json`).save(Buffer.from(JSON.stringify(manifest)), { metadata: { contentType: 'application/json', metadata: common } });
for (const record of manifest.screenshots) for (const side of ['before', 'after']) for (const tile of record[side].tiles) {
  await bucket.file(`${prefix}/${tile.path}`).save(png, { metadata: { contentType: 'image/png', metadata: { ...common, routeKey: record.key, side, tileIndex: String(tile.index), sha256: checksum } } });
}
const finalize = await fetch('http://127.0.0.1:5001/who-touched-this/us-central1/finalizeSnapshotArchive', {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${ownerClient.idToken}` },
  body: JSON.stringify({ data: { contributionNumber: 1, captureId } }),
});
assert.equal(finalize.ok, true, await finalize.text());
assert.equal((await adminFirestore.doc('contributions/1').get()).data()?.archiveStatus, 'finalized');
assert.equal((await adminFirestore.doc('site/admin').get()).data()?.pendingArchiveContributionNumber, null);
const retryFinalize = await fetch('http://127.0.0.1:5001/who-touched-this/us-central1/finalizeSnapshotArchive', {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${ownerClient.idToken}` },
  body: JSON.stringify({ data: { contributionNumber: 1, captureId } }),
});
const retryPayload = await retryFinalize.json();
assert.equal(retryFinalize.ok, true, JSON.stringify(retryPayload));
assert.equal(retryPayload.result.status, 'already_finalized');
assert.equal((await adminFirestore.doc('site/public').get()).data()?.totalContributions, 1);
assert.equal((await adminFirestore.doc('historyEvents/archive-turn').get()).data()?.contributionNumber, 1);
assert.equal((await adminFirestore.doc(`participation/1_${contributor.id}`).get()).data()?.status, 'completed');
assert.equal((await adminFirestore.doc(`queue/1_${contributor.id}`).get()).data()?.status, 'completed');
await invitationBatch('next-invitation');

const nextClient = await clientFor(next, 'archive-relay-next');
const dueAt = ClientTimestamp.fromMillis(Date.now() + 168 * 60 * 60 * 1000);
const accept = writeBatch(nextClient.firestore);
accept.update(doc(nextClient.firestore, 'invitations/next-invitation'), { status: 'accepted', acceptedAt: serverTimestamp(), turnId: 'next-turn', updatedAt: serverTimestamp() });
accept.set(doc(nextClient.firestore, 'turns/next-turn'), { githubUserId: next.id, season: 1, status: 'active', targetContributionNumber: 2, startedAt: serverTimestamp(), dueAt, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
accept.update(doc(nextClient.firestore, `participation/1_${next.id}`), { status: 'active', updatedAt: serverTimestamp() });
accept.update(doc(nextClient.firestore, `queue/1_${next.id}`), { status: 'active', updatedAt: serverTimestamp() });
accept.set(doc(nextClient.firestore, 'site/admin'), { activeTurnId: 'next-turn', pendingInvitationId: null, pendingArchiveContributionNumber: null, updatedAt: serverTimestamp() });
accept.set(doc(nextClient.firestore, 'site/public'), { currentVersion: 1, totalContributions: 1, turnStatus: 'active', targetContributionNumber: 2, currentContributor: { githubUsername: next.username, displayName: 'Next Contributor' }, dueAt, updatedAt: serverTimestamp() });
await accept.commit();

assert.equal((await adminFirestore.doc('turns/next-turn').get()).data()?.targetContributionNumber, 2);
assert.equal((await adminFirestore.doc('contributions/1').get()).data()?.archiveStatus, 'finalized');
assert.equal((await adminFirestore.doc('site/public').get()).data()?.turnStatus, 'active');
console.log('Merged publication, archive relay lock, finalization, invitation, and next-turn integration passed.');
await Promise.all([deleteApp(ownerClient.app), deleteApp(nextClient.app)]);
