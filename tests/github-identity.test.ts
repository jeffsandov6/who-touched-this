import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractGitHubUsername,
  getJoinIdentityView,
  reconcileGitHubIdentity,
  type GitHubIdentity,
} from '../src/platform/firebase/github-identity.ts';

function identity(githubUserId: string, githubUsername: string | null): GitHubIdentity {
  return {
    firebaseUid: `firebase-${githubUserId}`,
    githubUserId,
    githubUsername,
    avatarUrl: null,
    profileUrl: githubUsername ? `https://github.com/${githubUsername}` : null,
    suggestedEmail: null,
  };
}

test('extracts a GitHub username from popup AdditionalUserInfo', () => {
  assert.equal(
    extractGitHubUsername({ providerId: 'github.com', username: 'jeff', profile: {} }),
    'jeff',
  );
});

test('supports the Auth Emulator screen_name profile field', () => {
  assert.equal(
    extractGitHubUsername({
      providerId: 'github.com',
      username: null,
      profile: { screen_name: 'emulator-jeff' },
    }),
    'emulator-jeff',
  );
});

test('prefers the standard GitHub profile login fallback', () => {
  assert.equal(
    extractGitHubUsername({
      providerId: 'github.com',
      username: null,
      profile: { login: 'github-jeff', screen_name: 'emulator-jeff' },
    }),
    'github-jeff',
  );
});

test('popup username survives a same-identity observer update without presentation data', () => {
  const popupIdentity = identity('1001', 'jeff');
  const observerIdentity = identity('1001', null);

  assert.deepEqual(reconcileGitHubIdentity(popupIdentity, observerIdentity), popupIdentity);
  assert.equal(getJoinIdentityView(popupIdentity, null), 'form');
});

test('reload without transient username asks an unjoined user to reauthenticate', () => {
  assert.equal(getJoinIdentityView(identity('1001', null), null), 'reauthenticate');
});

test('existing participation status takes precedence over missing transient username', () => {
  assert.equal(getJoinIdentityView(identity('1001', null), 'waiting'), 'participation');
});

test('presentation metadata is never reused for a different GitHub provider ID', () => {
  const reconciled = reconcileGitHubIdentity(identity('1001', 'jeff'), identity('2002', null));

  assert.equal(reconciled.githubUserId, '2002');
  assert.equal(reconciled.githubUsername, null);
  assert.equal(reconciled.profileUrl, null);
  assert.equal(getJoinIdentityView(reconciled, null), 'reauthenticate');
});
