import { getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';

type FirebaseEmulatorService = 'auth' | 'firestore' | 'functions' | 'storage';

const emulatorConnectionState = globalThis as typeof globalThis & {
  __wttFirebaseEmulators?: {
    auth: boolean;
    firestore: boolean;
    functions: boolean;
    storage: boolean;
  };
};

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
    throw new Error(`missing Firebase configuration: ${missingVariables.join(', ')}`);
  }

  return {
    apiKey: environment.PUBLIC_FIREBASE_API_KEY,
    authDomain: environment.PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: environment.PUBLIC_FIREBASE_PROJECT_ID,
    messagingSenderId: environment.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: environment.PUBLIC_FIREBASE_APP_ID,
    ...(environment.PUBLIC_FIREBASE_STORAGE_BUCKET
      ? { storageBucket: environment.PUBLIC_FIREBASE_STORAGE_BUCKET }
      : {}),
  };
}

export function useContributorPreview(): boolean {
  return import.meta.env.MODE === 'contributor'
    || (import.meta.env.DEV && import.meta.env.PUBLIC_CONTRIBUTOR_PREVIEW === 'true');
}

function getEmulatorConnectionState() {
  return (emulatorConnectionState.__wttFirebaseEmulators ??= {
    auth: false,
    firestore: false,
    functions: false,
    storage: false,
  });
}

/** Lazily returns the default Firebase app, initializing it at most once. */
export function getFirebaseApp(): FirebaseApp {
  if (useContributorPreview()) {
    throw new Error('Firebase is disabled in contributor preview mode.');
  }
  const defaultApp = getApps().find((app) => app.name === '[DEFAULT]');
  return defaultApp ?? initializeApp(getFirebaseOptions());
}

export function connectFirebaseEmulatorOnce(
  service: FirebaseEmulatorService,
  connect: () => void,
): void {
  const connectionState = getEmulatorConnectionState();

  if (!connectionState[service]) {
    connect();
    connectionState[service] = true;
  }
}
