import { getApps, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST || process.env.GCLOUD_PROJECT !== 'who-touched-this') {
  throw new Error('Refusing to seed outside the who-touched-this Firestore Emulator.');
}
if (!getApps().length) initializeApp({ projectId: 'who-touched-this' });
const firestore = getFirestore();
const now = Timestamp.now();
await Promise.all([
  firestore.doc('admins/9001').set({ githubUserId: '9001', role: 'owner', active: true, createdAt: now }),
  firestore.doc('contributions/1').set({
    number: 1, season: 1, displayName: 'Snapshot Fixture', githubUsername: 'snapshot-fixture',
    summary: 'Synthetic emulator contribution for snapshot archive testing.',
    prNumber: 1, prUrl: 'https://github.com/JeffSandov6/who-touched-this/pull/1',
    mergedAt: now, createdAt: now,
  }),
  firestore.doc('historyEvents/emulator-snapshot-turn').set({
    type: 'contribution', season: 1, displayName: 'Snapshot Fixture', githubUsername: 'snapshot-fixture',
    targetContributionNumber: 1, contributionNumber: 1, occurredAt: now,
  }),
]);
console.log('Seeded emulator-only owner 9001 and permanent Contribution #001 History fixture.');
