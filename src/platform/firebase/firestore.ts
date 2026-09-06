import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { connectFirebaseEmulatorOnce, getFirebaseApp } from './client';

/** Lazily returns Firestore. Importing this module does not initialize Firebase or make requests. */
export function getPlatformFirestore(): Firestore {
  const firestore = getFirestore(getFirebaseApp());
  if (import.meta.env.DEV && import.meta.env.PUBLIC_USE_FIREBASE_EMULATORS === 'true') {
    connectFirebaseEmulatorOnce('firestore', () =>
      connectFirestoreEmulator(firestore, '127.0.0.1', 8080),
    );
  }
  return firestore;
}
