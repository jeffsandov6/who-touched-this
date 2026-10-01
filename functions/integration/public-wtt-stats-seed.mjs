import { getApps, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

const projectId = process.env.GCLOUD_PROJECT;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const allowedEmulatorHosts = new Set(['127.0.0.1:8080', 'localhost:8080', '[::1]:8080']);

if (projectId !== 'who-touched-this' || !firestoreHost || !allowedEmulatorHosts.has(firestoreHost)) {
  throw new Error('Refusing to seed public WTT stats outside the local who-touched-this Firestore Emulator.');
}

const emulatorUrl = `http://${firestoreHost}`;
const attempts = 120;
const retryDelayMs = 500;

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    await fetch(emulatorUrl);
    break;
  } catch (error) {
    if (attempt === attempts) {
      throw new Error(`Firestore Emulator did not become available at ${firestoreHost}.`, { cause: error });
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
}

if (!getApps().length) initializeApp({ projectId });

const firestore = getFirestore();
const reference = firestore.doc('publicWttStats/current');

await reference.set({
  earned: 0,
  claimed: 0,
  holders: 0,
  supply: 0,
  updatedAt: Timestamp.now(),
});

const snapshot = await reference.get();
const data = snapshot.data();
const keys = data ? Object.keys(data).sort() : [];

if (
  !snapshot.exists
  || data?.earned !== 0
  || data?.claimed !== 0
  || data?.holders !== 0
  || data?.supply !== 0
  || !(data?.updatedAt instanceof Timestamp)
  || keys.join(',') !== 'claimed,earned,holders,supply,updatedAt'
) {
  throw new Error('Failed to verify the local publicWttStats/current fixture.');
}

console.log('Seeded and verified emulator-only publicWttStats/current.');
