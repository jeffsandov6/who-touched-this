import { FirebaseError } from 'firebase/app';
import {
  GithubAuthProvider,
  connectAuthEmulator,
  getAuth,
  getAdditionalUserInfo,
  getIdTokenResult,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type AdditionalUserInfo,
  type Unsubscribe,
  type User,
} from 'firebase/auth';
import { connectFirebaseEmulatorOnce, getFirebaseApp } from './client';
import {
  extractGitHubUsername,
  type GitHubIdentity,
} from './github-identity';

const GITHUB_PROVIDER_ID = 'github.com';
export type { GitHubIdentity } from './github-identity';

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

function getPlatformAuth() {
  const auth = getAuth(getFirebaseApp());
  connectFirebaseEmulatorOnce('auth', () =>
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true }),
  );
  return auth;
}

function readGitHubIdsFromClaims(claims: Record<string, unknown>): string[] {
  const firebaseClaim = claims.firebase;
  if (!firebaseClaim || typeof firebaseClaim !== 'object') return [];

  const identities = (firebaseClaim as { identities?: unknown }).identities;
  if (!identities || typeof identities !== 'object') return [];

  const githubIds = (identities as Record<string, unknown>)[GITHUB_PROVIDER_ID];
  return Array.isArray(githubIds)
    ? githubIds.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : [];
}

function safeHttpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function resolveGitHubIdentity(
  user: User,
  authenticatedUsername?: string | null,
): Promise<GitHubIdentity> {
  const tokenResult = await getIdTokenResult(user);
  const githubIds = readGitHubIdsFromClaims(tokenResult.claims);
  const providerProfile = user.providerData.find(
    (profile) => profile.providerId === GITHUB_PROVIDER_ID,
  );

  if (githubIds.length !== 1 || !providerProfile || providerProfile.uid !== githubIds[0]) {
    throw new AuthenticationError(
      'A verified GitHub identity is unavailable. Please sign out and authenticate with GitHub again.',
    );
  }

  const githubUsername = authenticatedUsername ?? null;

  return {
    firebaseUid: user.uid,
    githubUserId: githubIds[0],
    githubUsername,
    avatarUrl: safeHttpsUrl(providerProfile.photoURL),
    profileUrl: githubUsername ? `https://github.com/${githubUsername}` : null,
    suggestedEmail: user.email?.trim() || null,
  };
}

export async function signInWithGitHub(): Promise<GitHubIdentity> {
  const provider = new GithubAuthProvider();

  try {
    // No additional OAuth scopes are requested. In particular, repo and user:email are omitted.
    const result = await signInWithPopup(getPlatformAuth(), provider);
    const additionalUserInfo: AdditionalUserInfo | null = getAdditionalUserInfo(result);
    return await resolveGitHubIdentity(result.user, extractGitHubUsername(additionalUserInfo));
  } catch (error) {
    if (error instanceof AuthenticationError) throw error;

    if (error instanceof FirebaseError) {
      const messages: Record<string, string> = {
        'auth/popup-closed-by-user': 'GitHub sign-in was cancelled.',
        'auth/cancelled-popup-request': 'GitHub sign-in was cancelled.',
        'auth/popup-blocked': 'The GitHub sign-in popup was blocked. Allow popups and try again.',
        'auth/network-request-failed': 'GitHub sign-in could not reach Firebase. Check your connection.',
        'auth/unauthorized-domain': 'This domain is not authorized for Firebase Authentication.',
        'auth/operation-not-allowed': 'GitHub Authentication is not enabled for this Firebase project.',
      };
      throw new AuthenticationError(
        messages[error.code] ?? 'GitHub sign-in could not be completed. Please try again.',
      );
    }

    throw new AuthenticationError('GitHub sign-in could not be completed. Please try again.');
  }
}

export function observeAuthState(callback: (user: User | null) => void): Unsubscribe {
  return onAuthStateChanged(getPlatformAuth(), callback);
}

export async function signOutOfPlatform(): Promise<void> {
  await signOut(getPlatformAuth());
}
