import type { ParticipationStatus } from './models';

const GITHUB_PROVIDER_ID = 'github.com';
const GITHUB_USERNAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

export interface GitHubIdentity {
  firebaseUid: string;
  githubUserId: string;
  githubUsername: string | null;
  avatarUrl: string | null;
  profileUrl: string | null;
  suggestedEmail: string | null;
}

interface GitHubAdditionalUserInfoLike {
  providerId: string | null;
  username?: string | null;
  profile?: Record<string, unknown> | null;
}

export type JoinIdentityView = 'signed-out' | 'participation' | 'reauthenticate' | 'form';

function normalizeGitHubUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const normalized = value.trim();
  return GITHUB_USERNAME_PATTERN.test(normalized) ? normalized : null;
}

/**
 * Reads presentation metadata only. The returned username must never be used for authorization;
 * authorization uses the stable GitHub provider ID from the Firebase token claims.
 */
export function extractGitHubUsername(info: GitHubAdditionalUserInfoLike | null): string | null {
  if (!info || info.providerId !== GITHUB_PROVIDER_ID) return null;

  const profile = info.profile ?? {};
  return (
    normalizeGitHubUsername(info.username) ??
    normalizeGitHubUsername(profile.login) ??
    // The Firebase Auth Emulator's GitHub widget currently exposes Screen name this way.
    normalizeGitHubUsername(profile.screen_name)
  );
}

/**
 * Keeps fresh popup presentation data when the observer reports the same stable identity without
 * transient provider metadata. Presentation data is never carried across different GitHub IDs.
 */
export function reconcileGitHubIdentity(
  current: GitHubIdentity | null,
  incoming: GitHubIdentity,
): GitHubIdentity {
  if (!current || current.githubUserId !== incoming.githubUserId) return incoming;

  const githubUsername = incoming.githubUsername ?? current.githubUsername;

  return {
    ...incoming,
    githubUsername,
    avatarUrl: incoming.avatarUrl ?? current.avatarUrl,
    profileUrl: githubUsername ? `https://github.com/${githubUsername}` : null,
    suggestedEmail: incoming.suggestedEmail ?? current.suggestedEmail,
  };
}

export function getJoinIdentityView(
  identity: GitHubIdentity | null,
  participationStatus: ParticipationStatus | null,
): JoinIdentityView {
  if (!identity) return 'signed-out';
  if (participationStatus) return 'participation';
  return identity.githubUsername ? 'form' : 'reauthenticate';
}
