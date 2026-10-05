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
  firestore.doc('site/admin').set({ activeTurnId: null, pendingInvitationId: null, pendingArchiveContributionNumber: null, updatedAt: now }),
  firestore.doc('site/public').set({
    currentVersion: 0, totalContributions: 0, turnStatus: 'none', targetContributionNumber: null,
    currentContributor: null, dueAt: null, updatedAt: now,
  }),
]);
assert.equal((await firestore.collection('contributors').get()).empty, true);

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
    publicDisplayName: 'Founder', contactEmail: 'founder@example.test', prNumber: 27, summary: 'Initial creative seed',
    beforeGitSha: 'a'.repeat(40), afterGitSha: 'b'.repeat(40),
  } }),
});
assert.equal(response.ok, true, await response.text());

async function waitForFounderWttDelivery() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [entitlement, delivery, mailbox] = await Promise.all([
      firestore.doc('wttEntitlements/contribution:0').get(),
      firestore.doc('emailDeliveries/contribution_completed_0').get(),
      firestore.doc('devEmailSink/contribution_completed_0').get(),
    ]);
    if (entitlement.exists && delivery.data()?.status === 'sent' && mailbox.exists) {
      return { entitlement: entitlement.data(), mailbox: mailbox.data() };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Timed out waiting for Founder #000 entitlement and completion email.');
}

const founderWtt = await waitForFounderWttDelivery();
assert.equal(founderWtt.entitlement.githubProviderId, '9001');
assert.equal(founderWtt.entitlement.amount, 1);
assert.equal(founderWtt.entitlement.status, 'unclaimed');
assert.match(founderWtt.mailbox.text, /\/wtt\/claim/);

const [contribution, history, publicSite, contributors, queue, participation, invitations, turns] = await Promise.all([
  firestore.doc('contributions/0').get(), firestore.doc('historyEvents/founder_seed_000').get(),
  firestore.doc('site/public').get(), firestore.collection('contributors').get(), firestore.collection('queue').get(),
  firestore.collection('participation').get(), firestore.collection('invitations').get(),
  firestore.collection('turns').get(),
]);
assert.equal(contribution.data()?.contributionKind, 'founder_seed');
assert.equal(contribution.data()?.githubUserId, '9001');
assert.equal(contribution.data()?.prUrl, 'https://github.com/jeffsandov6/who-touched-this/pull/27');
assert.equal(contribution.data()?.archiveStatus, 'pending');
assert.equal((await firestore.doc('site/admin').get()).data()?.pendingArchiveContributionNumber, 0);
assert.equal(history.data()?.contributionNumber, 0);
assert.equal(publicSite.data()?.currentVersion, 0);
assert.equal(publicSite.data()?.totalContributions, 1);
assert.equal(publicSite.data()?.turnStatus, 'none');
for (const snapshot of [contributors, queue, participation, invitations, turns]) assert.equal(snapshot.empty, true);
const founderAdmin = (await firestore.doc('admins/9001').get()).data();
assert.deepEqual(Object.keys(founderAdmin).sort(), [
  'active', 'createdAt', 'founderCompletionEmail', 'founderCompletionEmailUpdatedAt',
  'githubUserId', 'role',
]);
assert.equal(founderAdmin.founderCompletionEmail, 'founder@example.test');

const duplicate = await fetch('http://127.0.0.1:5001/who-touched-this/us-central1/recordFounderContributionZero', {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
  body: JSON.stringify({ data: {
    publicDisplayName: 'Founder', contactEmail: 'founder@example.test', prNumber: 27, summary: 'Initial creative seed',
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
  schemaVersion: 2, contributionNumber: 0, contributionLabel: '000', captureId,
  capturedAt: '2026-01-01T00:00:00.000Z', git: { before: 'a'.repeat(40), after: 'b'.repeat(40) },
  routeRegistry: { path: 'src/platform/config/editable-routes.json', revision: 'b'.repeat(40) },
  canonicalRoutes: routes, additionalRoutes: [], capturedRoutes: routes,
  capture: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, captureMode: 'tiled-document', tileHeight: 3600, format: 'png', locale: 'en-US', timezoneId: 'UTC', waitMs: 1500, maximumTileCount: 64, maximumTotalScreenshotPixels: 384_000_000, maximumTotalScreenshotBytes: 160 * 1024 * 1024 },
  screenshots: routes.map((route, index) => ({
    route, key: routeKeys[index],
    before: { width: 1, height: 1, tiles: [{ index: 0, y: 0, width: 1, height: 1, path: `before/${routeKeys[index]}/tile-000.png`, sha256: checksum, bytes: png.length }] },
    after: { width: 1, height: 1, tiles: [{ index: 0, y: 0, width: 1, height: 1, path: `after/${routeKeys[index]}/tile-000.png`, sha256: checksum, bytes: png.length }] },
  })),
};
const bucket = getStorage().bucket();
const common = { contributionNumber: '0', contributionLabel: '000', captureId };
await bucket.file(`${prefix}/manifest.json`).save(Buffer.from(JSON.stringify(manifest)), {
  metadata: { contentType: 'application/json', metadata: common },
});
for (const record of manifest.screenshots) for (const side of ['before', 'after']) for (const tile of record[side].tiles) {
  await bucket.file(`${prefix}/${tile.path}`).save(png, {
    metadata: { contentType: 'image/png', metadata: { ...common, routeKey: record.key, side, tileIndex: String(tile.index), sha256: checksum } },
  });
}
const finalize = await fetch('http://127.0.0.1:5001/who-touched-this/us-central1/finalizeSnapshotArchive', {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
  body: JSON.stringify({ data: { contributionNumber: 0, captureId } }),
});
assert.equal(finalize.ok, true, await finalize.text());
assert.equal((await firestore.doc('contributionSnapshots/0').get()).data()?.contributionNumber, 0);
assert.equal((await firestore.doc('contributions/0').get()).data()?.archiveStatus, 'finalized');
assert.equal((await firestore.doc('site/admin').get()).data()?.pendingArchiveContributionNumber, null);
console.log('Founder #000 callable and standard 000 snapshot-finalization integration passed.');
