import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage';
import { connectFirebaseEmulatorOnce, getFirebaseApp } from './client';

/** Lazily returns Storage. Importing this module does not initialize Firebase or make requests. */
export function getPlatformStorage(): FirebaseStorage {
  const app = getFirebaseApp();
  if (!app.options.storageBucket) {
    throw new Error('missing Firebase storage configuration: PUBLIC_FIREBASE_STORAGE_BUCKET');
  }
  const storage = getStorage(app);
  if (import.meta.env.DEV && import.meta.env.PUBLIC_USE_FIREBASE_EMULATORS === 'true') {
    connectFirebaseEmulatorOnce('storage', () =>
      connectStorageEmulator(storage, '127.0.0.1', 9199),
    );
  }
  return storage;
}
