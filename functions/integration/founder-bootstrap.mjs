import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { initializeApp as initializeClientApp } from 'firebase/app';
import { connectAuthEmulator, getAuth as getClientAuth, signInWithCustomToken } from 'firebase/auth';

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST
  || process.env.GCLOUD_PROJECT !== 'who-touched-this') {
  throw new Error('Refusing to run founder integration outside the complete who-touched-this emulators.');
}
if (!getApps().length) initializeApp({ projectId: 'who-touched-this', storageBucket: 'who-touched-this.firebasestorage.app' });
const firestore = getFirestore();
const now = Timestamp.now();
await Promise.all([
  firestore.doc('admins/9001').set({ githubUserId: '9001', role: 'owner', active: true, createdAt: now }),
  firestore.doc('site/admin').set({ activeTurnId: null, pendingInvitationId: null, updatedAt: now }),
  firestore.doc('site/public').set({
    currentVersion: 0, totalContributions: 0, turnStatus: 'none', targetContributionNumber: null,
    currentContributor: null, dueAt: null, updatedAt: now,
  }),
]);

await getAuth().importUsers([{
  uid: 'founder-owner',
  providerData: [{ uid: '9001', providerId: 'github.com', email: 'emulator@example.test', displayName: 'Emulator Owner' }],
}]);
const customToken = await getAuth().createCustomToken('founder-owner');
const clientApp = initializeClientApp({ apiKey: 'demo-key', projectId: 'who-touched-this' }, 'founder-integration');
const clientAuth = getClientAuth(clientApp);
connectAuthEmulator(clientAuth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
const credential = await signInWithCustomToken(clientAuth, customToken);
const idToken = await credential.user.getIdToken();
const response = await fetch('http://127.0.0.1:5001/who-touched-this/us-central1/recordFounderContributionZero', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
  body: JSON.stringify({ data: {
    publicDisplayName: 'Founder', prNumber: 27, summary: 'Initial creative seed',
    beforeGitSha: 'a'.repeat(40), afterGitSha: 'b'.repeat(40),
  } }),
});
assert.equal(response.ok, true, await response.text());

const [contribution, history, publicSite, queue, participation, invitations, turns, emails] = await Promise.all([
  firestore.doc('contributions/0').get(), firestore.doc('historyEvents/founder_seed_000').get(),
  firestore.doc('site/public').get(), firestore.collection('queue').get(),
  firestore.collection('participation').get(), firestore.collection('invitations').get(),
  firestore.collection('turns').get(), firestore.collection('emailDeliveries').get(),
]);
assert.equal(contribution.data()?.contributionKind, 'founder_seed');
assert.equal(contribution.data()?.prUrl, 'https://github.com/JeffSandov6/who-touched-this/pull/27');
assert.equal(history.data()?.contributionNumber, 0);
assert.equal(publicSite.data()?.currentVersion, 0);
assert.equal(publicSite.data()?.totalContributions, 1);
assert.equal(publicSite.data()?.turnStatus, 'none');
for (const snapshot of [queue, participation, invitations, turns, emails]) assert.equal(snapshot.empty, true);

const duplicate = await fetch('http://127.0.0.1:5001/who-touched-this/us-central1/recordFounderContributionZero', {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
  body: JSON.stringify({ data: {
    publicDisplayName: 'Founder', prNumber: 27, summary: 'Initial creative seed',
    beforeGitSha: 'a'.repeat(40), afterGitSha: 'b'.repeat(40),
  } }),
});
assert.equal(duplicate.ok, false);
assert.equal((await firestore.doc('site/public').get()).data()?.totalContributions, 1);

const captureId = 'founder-integration-capture';
const prefix = `public/history/contributions/000/${captureId}`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const checksum = createHash('sha256').update(png).digest('hex');
const routes = ['/', '/random', '/thoughts'];
const routeKeys = ['home', 'random', 'thoughts'];
const manifest = {
  schemaVersion: 1, contributionNumber: 0, contributionLabel: '000', captureId,
  capturedAt: '2026-01-01T00:00:00.000Z', git: { before: 'a'.repeat(40), after: 'b'.repeat(40) },
  routeRegistry: { path: 'src/platform/config/editable-routes.json', revision: 'b'.repeat(40) },
  canonicalRoutes: routes, additionalRoutes: [], capturedRoutes: routes,
  capture: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, fullPage: true, format: 'png', locale: 'en-US', timezoneId: 'UTC', waitMs: 1500 },
  screenshots: routes.map((route, index) => ({
    route, key: routeKeys[index],
    before: { path: `before/${routeKeys[index]}.png`, sha256: checksum },
    after: { path: `after/${routeKeys[index]}.png`, sha256: checksum },
  })),
};
const bucket = getStorage().bucket();
const common = { contributionNumber: '0', contributionLabel: '000', captureId };
await bucket.file(`${prefix}/manifest.json`).save(Buffer.from(JSON.stringify(manifest)), {
  metadata: { contentType: 'application/json', metadata: common },
});
for (const record of manifest.screenshots) for (const side of ['before', 'after']) {
  await bucket.file(`${prefix}/${record[side].path}`).save(png, {
    metadata: { contentType: 'image/png', metadata: { ...common, routeKey: record.key, side, sha256: checksum } },
  });
}
const finalize = await fetch('http://127.0.0.1:5001/who-touched-this/us-central1/finalizeSnapshotArchive', {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
  body: JSON.stringify({ data: { contributionNumber: 0, captureId } }),
});
assert.equal(finalize.ok, true, await finalize.text());
assert.equal((await firestore.doc('contributionSnapshots/0').get()).data()?.contributionNumber, 0);
console.log('Founder #000 callable and standard 000 snapshot-finalization integration passed.');
