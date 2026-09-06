export const RELEASE_CONFIG = Object.freeze({
  projectId: 'who-touched-this',
  origin: 'https://whotouchedthis.website',
  repository: 'JeffSandov6/who-touched-this',
  baseBranch: 'main',
  requiredNode: Object.freeze({ major: 22, minor: 12 }),
  browserVariables: Object.freeze([
    'PUBLIC_FIREBASE_API_KEY', 'PUBLIC_FIREBASE_AUTH_DOMAIN',
    'PUBLIC_FIREBASE_PROJECT_ID', 'PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
    'PUBLIC_FIREBASE_APP_ID', 'PUBLIC_FIREBASE_STORAGE_BUCKET',
    'PUBLIC_USE_FIREBASE_EMULATORS', 'PUBLIC_SITE_INDEXING_ENABLED',
  ]),
  functionsVariables: Object.freeze([
    'EMAIL_PROVIDER_MODE', 'APP_ORIGIN', 'GITHUB_REPOSITORY', 'GITHUB_BASE_BRANCH',
  ]),
  secretNames: Object.freeze(['RESEND_API_KEY', 'GITHUB_WEBHOOK_SECRET']),
  platformSmokeRoutes: Object.freeze(['/history', '/faq', '/rules', '/join']),
});

export function firebaseDeployArguments(service) {
  if (!['firestore,storage', 'functions', 'hosting'].includes(service)) {
    throw new Error(`Unsupported deploy target: ${service}`);
  }
  return ['deploy', '--only', service, '--project', RELEASE_CONFIG.projectId];
}
