export interface ContributionBoundaries {
  readonly editableAreas: readonly string[];
  readonly protectedAreas: readonly string[];
  readonly reservedPublicRoutes: readonly `/${string}`[];
}

export const CONTRIBUTION_BOUNDARIES = {
  editableAreas: ['src/canvas/**'],
  protectedAreas: [
    'src/platform/**',
    'src/pages/**',
    'src/styles/**',
    'README.md',
    'CONTRIBUTING.md',
    '.env.example',
    '.gitignore',
    '.nvmrc',
    'astro.config.*',
    '*.config.*',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'public/**',
    'firebase.json',
    '.firebaserc',
    'firestore.rules',
    'firestore.indexes.json',
    'tests/**',
    '.github/**',
    'Dockerfile*',
    'build/**',
    'deploy/**',
  ],
  reservedPublicRoutes: ['/history', '/join', '/faq', '/rules', '/admin', '/api', '/auth'],
} as const satisfies ContributionBoundaries;

export type EditableArea = (typeof CONTRIBUTION_BOUNDARIES.editableAreas)[number];
export type ProtectedArea = (typeof CONTRIBUTION_BOUNDARIES.protectedAreas)[number];
export type ReservedPublicRoute = (typeof CONTRIBUTION_BOUNDARIES.reservedPublicRoutes)[number];
