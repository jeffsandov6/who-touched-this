import { getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';

const requiredConfig = {
  apiKey: 'PUBLIC_FIREBASE_API_KEY',
  authDomain: 'PUBLIC_FIREBASE_AUTH_DOMAIN',
  projectId: 'PUBLIC_FIREBASE_PROJECT_ID',
  messagingSenderId: 'PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'PUBLIC_FIREBASE_APP_ID',
} as const;

function getFirebaseOptions(): FirebaseOptions {
  const environment = import.meta.env;
  const missingVariables = Object.values(requiredConfig).filter((name) => !environment[name]);

  if (missingVariables.length > 0) {
    throw new Error(`Missing Firebase configuration: ${missingVariables.join(', ')}`);
  }

  return {
    apiKey: environment.PUBLIC_FIREBASE_API_KEY,
    authDomain: environment.PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: environment.PUBLIC_FIREBASE_PROJECT_ID,
    messagingSenderId: environment.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: environment.PUBLIC_FIREBASE_APP_ID,
  };
}

/** Lazily returns the default Firebase app, initializing it at most once. */
export function getFirebaseApp(): FirebaseApp {
  const defaultApp = getApps().find((app) => app.name === '[DEFAULT]');
  return defaultApp ?? initializeApp(getFirebaseOptions());
}

/** Lazily returns Firestore. Importing this module does not initialize Firebase or make requests. */
export function getPlatformFirestore(): Firestore {
  return getFirestore(getFirebaseApp());
}
