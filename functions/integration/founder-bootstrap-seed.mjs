import { getApps, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST || process.env.GCLOUD_PROJECT !== 'who-touched-this') {
  throw new Error('Refusing to prepare founder bootstrap outside the who-touched-this Firestore Emulator.');
}
if (!getApps().length) initializeApp({ projectId: 'who-touched-this' });
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
console.log('Prepared emulator-only active owner 9001 and empty founder bootstrap state.');
