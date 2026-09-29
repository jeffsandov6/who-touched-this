import type { GitHubIdentity } from './firebase/github-identity';
import type { ParsedWttEntitlement } from './wtt-entitlements';

export const WTT_CLAIM_PREVIEW_KINDS = [
  'no-entitlements',
  'unclaimed',
  'multiple',
  'connected',
  'verified',
  'claiming',
  'claimed',
] as const;

export type WttClaimPreviewKind = typeof WTT_CLAIM_PREVIEW_KINDS[number];

export interface WttClaimPreviewState {
  identity: GitHubIdentity;
  entitlements: ParsedWttEntitlement[];
  walletAddress: string | null;
  walletVerified: boolean;
}

export const WTT_PREVIEW_WALLET = 'LocalPreviewWallet1111111111111111111111111111';
export const WTT_PREVIEW_TRANSACTION = 'LOCAL_PREVIEW_FAKE_TRANSACTION_SIGNATURE';

export function resolveWttClaimPreview(search: string, development: boolean): WttClaimPreviewKind | null {
  if (!development) return null;
  const requested = new URLSearchParams(search).get('preview');
  return (WTT_CLAIM_PREVIEW_KINDS as readonly string[]).includes(requested ?? '')
    ? requested as WttClaimPreviewKind
    : null;
}

function entitlement(
  sourceId: string,
  status: ParsedWttEntitlement['status'],
): ParsedWttEntitlement {
  const base = {
    id: `contribution:${sourceId}`,
    sourceType: 'contribution' as const,
    sourceId,
    githubProviderId: '999999999',
    contributorId: '999999999',
    amount: 1,
    earnedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  if (status === 'claiming') {
    return {
      ...base,
      status,
      claimId: 'local-preview-claim',
      claimedAt: null,
      claimedWallet: null,
      claimTransaction: null,
    };
  }
  if (status === 'claimed') {
    return {
      ...base,
      status,
      claimId: 'local-preview-claim',
      claimedAt: new Date('2026-01-01T00:10:00.000Z'),
      claimedWallet: WTT_PREVIEW_WALLET,
      claimTransaction: WTT_PREVIEW_TRANSACTION,
    };
  }
  return {
    ...base,
    status,
    claimId: null,
    claimedAt: null,
    claimedWallet: null,
    claimTransaction: null,
  };
}

export function createWttClaimPreview(kind: WttClaimPreviewKind): WttClaimPreviewState {
  const identity: GitHubIdentity = {
    firebaseUid: 'local-preview-firebase-user',
    githubUserId: '999999999',
    githubUsername: 'local-preview',
    avatarUrl: null,
    profileUrl: null,
    suggestedEmail: null,
  };
  const walletAddress = ['connected', 'verified', 'claiming', 'claimed'].includes(kind)
    ? WTT_PREVIEW_WALLET
    : null;

  if (kind === 'no-entitlements') {
    return { identity, entitlements: [], walletAddress, walletVerified: false };
  }
  if (kind === 'multiple') {
    return {
      identity,
      entitlements: [entitlement('0', 'unclaimed'), entitlement('12', 'unclaimed'), entitlement('47', 'unclaimed')],
      walletAddress,
      walletVerified: false,
    };
  }
  if (kind === 'claiming') {
    return { identity, entitlements: [entitlement('0', 'claiming')], walletAddress, walletVerified: true };
  }
  if (kind === 'claimed') {
    return { identity, entitlements: [entitlement('0', 'claimed')], walletAddress, walletVerified: true };
  }
  return {
    identity,
    entitlements: [entitlement('0', 'unclaimed')],
    walletAddress,
    walletVerified: kind === 'verified',
  };
}
