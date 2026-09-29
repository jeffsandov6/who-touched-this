import { randomBytes } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
import { githubIdFromAuthToken } from '../email/retry-invitation.js';
import { WTT_MINT_ADDRESS } from './config.js';

export { WTT_MINT_ADDRESS } from './config.js';
export const WTT_CLAIM_CHALLENGE_TTL_MS = 10 * 60 * 1000;
export const WTT_CLAIM_CHALLENGE_SCHEMA_VERSION = 1 as const;

const MAX_ENTITLEMENTS_PER_CHALLENGE = 100;
const ENTITLEMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/;
const CHALLENGE_ID_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const CANONICAL_BASE64_SIGNATURE_PATTERN = /^(?:[A-Za-z0-9+/]{4}){21}[A-Za-z0-9+/]{2}==$/;

export type WttClaimChallengeStatus = 'issued' | 'verified' | 'consumed';
export type WttChallengeErrorCode =
  | 'unauthenticated'
  | 'permission-denied'
  | 'invalid-argument'
  | 'not-found'
  | 'failed-precondition';

export class WttChallengeError extends Error {
  constructor(public readonly code: WttChallengeErrorCode, message: string) {
    super(message);
    this.name = 'WttChallengeError';
  }
}

export interface WttChallengeEntitlement {
  id: string;
  githubProviderId: string;
  amount: number;
  status: unknown;
}

export interface WttClaimChallengeRecord {
  schemaVersion: typeof WTT_CLAIM_CHALLENGE_SCHEMA_VERSION;
  githubProviderId: string;
  walletAddress: string;
  entitlementIds: string[];
  amount: number;
  message: string;
  nonce: string;
  status: WttClaimChallengeStatus;
  issuedAt: Date;
  expiresAt: Date;
  verifiedAt: Date | null;
  consumedAt: Date | null;
}

export interface WttChallengeTransaction {
  loadChallenge(challengeId: string): Promise<WttClaimChallengeRecord | null>;
  loadEntitlements(entitlementIds: readonly string[]): Promise<Array<WttChallengeEntitlement | null>>;
  markVerified(challengeId: string, verifiedAt: Date): void;
}

export interface WttChallengeDependencies {
  appOrigin: string;
  now(): Date;
  randomBytes(size: number): Uint8Array;
  loadEntitlements(entitlementIds: readonly string[]): Promise<Array<WttChallengeEntitlement | null>>;
  createChallenge(challengeId: string, record: WttClaimChallengeRecord): Promise<void>;
  runTransaction<T>(operation: (transaction: WttChallengeTransaction) => Promise<T>): Promise<T>;
}

export interface IssuedWttClaimChallenge {
  challengeId: string;
  message: string;
  walletAddress: string;
  amount: number;
  expiresAt: string;
}

export interface VerifiedWttClaimChallenge {
  challengeId: string;
  status: 'verified';
  walletAddress: string;
  entitlementIds: string[];
  amount: number;
  verifiedAt: string;
}

function requireGitHubProviderId(authToken: Record<string, unknown> | null): string {
  if (!authToken) {
    throw new WttChallengeError('unauthenticated', 'authentication is required.');
  }
  const githubProviderId = githubIdFromAuthToken(authToken);
  if (!githubProviderId || !/^[0-9]+$/.test(githubProviderId)) {
    throw new WttChallengeError('permission-denied', 'a GitHub-authenticated account is required.');
  }
  return githubProviderId;
}

function requirePlainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WttChallengeError('invalid-argument', 'request data is invalid.');
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(record: Record<string, unknown>, expected: readonly string[]): void {
  const keys = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  if (keys.length !== sortedExpected.length || keys.some((key, index) => key !== sortedExpected[index])) {
    throw new WttChallengeError('invalid-argument', 'request data contains unexpected fields.');
  }
}

export function decodeSolanaPublicKey(address: string): Uint8Array {
  if (!address || address.length > 64) {
    throw new WttChallengeError('invalid-argument', 'wallet address is invalid.');
  }
  try {
    const publicKey = bs58.decode(address);
    if (publicKey.length !== 32 || bs58.encode(publicKey) !== address) throw new Error('invalid key');
    return publicKey;
  } catch {
    throw new WttChallengeError('invalid-argument', 'wallet address is invalid.');
  }
}

function parseEntitlementIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ENTITLEMENTS_PER_CHALLENGE) {
    throw new WttChallengeError('invalid-argument', 'select between 1 and 100 unclaimed entitlements.');
  }
  if (!value.every((id): id is string => typeof id === 'string' && ENTITLEMENT_ID_PATTERN.test(id))) {
    throw new WttChallengeError('invalid-argument', 'an entitlement identifier is invalid.');
  }
  if (new Set(value).size !== value.length) {
    throw new WttChallengeError('invalid-argument', 'duplicate entitlement identifiers are not allowed.');
  }
  return [...value].sort();
}

function validateEntitlements(
  entitlements: readonly (WttChallengeEntitlement | null)[],
  entitlementIds: readonly string[],
  githubProviderId: string,
): number {
  if (entitlements.length !== entitlementIds.length) {
    throw new WttChallengeError('failed-precondition', 'the selected WTT records could not be verified.');
  }
  let amount = 0;
  for (let index = 0; index < entitlementIds.length; index += 1) {
    const entitlement = entitlements[index];
    const expectedId = entitlementIds[index];
    if (!entitlement || entitlement.id !== expectedId) {
      throw new WttChallengeError('not-found', 'a selected WTT entitlement does not exist.');
    }
    if (entitlement.githubProviderId !== githubProviderId) {
      throw new WttChallengeError('permission-denied', 'a selected WTT entitlement does not belong to this GitHub account.');
    }
    if (entitlement.status !== 'unclaimed') {
      throw new WttChallengeError('failed-precondition', 'a selected WTT entitlement is no longer unclaimed.');
    }
    if (!Number.isSafeInteger(entitlement.amount) || entitlement.amount < 1
      || !Number.isSafeInteger(amount + entitlement.amount)) {
      throw new WttChallengeError('failed-precondition', 'a selected WTT entitlement has an invalid amount.');
    }
    amount += entitlement.amount;
  }
  return amount;
}

function secureToken(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

export function buildWttClaimChallengeMessage(input: {
  appOrigin: string;
  githubProviderId: string;
  walletAddress: string;
  entitlementIds: readonly string[];
  amount: number;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
}): string {
  return [
    'Who Touched This',
    'WTT claim verification',
    '',
    'This is not a transaction. Signing does not send SOL or WTT.',
    '',
    `Origin: ${input.appOrigin}`,
    `GitHub provider ID: ${input.githubProviderId}`,
    `Wallet: ${input.walletAddress}`,
    `WTT mint: ${WTT_MINT_ADDRESS}`,
    'Entitlements:',
    ...input.entitlementIds.map((id) => `- ${id}`),
    `Amount: ${input.amount} WTT`,
    `Nonce: ${input.nonce}`,
    `Issued at: ${input.issuedAt.toISOString()}`,
    `Expires at: ${input.expiresAt.toISOString()}`,
  ].join('\n');
}

export async function issueWttClaimChallenge(
  authToken: Record<string, unknown> | null,
  input: unknown,
  dependencies: WttChallengeDependencies,
): Promise<IssuedWttClaimChallenge> {
  const githubProviderId = requireGitHubProviderId(authToken);
  const request = requirePlainObject(input);
  requireExactKeys(request, ['walletAddress', 'entitlementIds']);
  if (typeof request.walletAddress !== 'string') {
    throw new WttChallengeError('invalid-argument', 'wallet address is invalid.');
  }
  decodeSolanaPublicKey(request.walletAddress);
  const entitlementIds = parseEntitlementIds(request.entitlementIds);
  const entitlements = await dependencies.loadEntitlements(entitlementIds);
  const amount = validateEntitlements(entitlements, entitlementIds, githubProviderId);
  const issuedAt = dependencies.now();
  if (!Number.isFinite(issuedAt.getTime())) throw new Error('challenge clock returned an invalid date.');
  const expiresAt = new Date(issuedAt.getTime() + WTT_CLAIM_CHALLENGE_TTL_MS);
  const challengeId = secureToken(dependencies.randomBytes(32));
  const nonce = secureToken(dependencies.randomBytes(32));
  const message = buildWttClaimChallengeMessage({
    appOrigin: dependencies.appOrigin,
    githubProviderId,
    walletAddress: request.walletAddress,
    entitlementIds,
    amount,
    nonce,
    issuedAt,
    expiresAt,
  });
  await dependencies.createChallenge(challengeId, {
    schemaVersion: WTT_CLAIM_CHALLENGE_SCHEMA_VERSION,
    githubProviderId,
    walletAddress: request.walletAddress,
    entitlementIds,
    amount,
    message,
    nonce,
    status: 'issued',
    issuedAt,
    expiresAt,
    verifiedAt: null,
    consumedAt: null,
  });
  return {
    challengeId,
    message,
    walletAddress: request.walletAddress,
    amount,
    expiresAt: expiresAt.toISOString(),
  };
}

function decodeSignature(value: unknown): Uint8Array {
  if (typeof value !== 'string' || !CANONICAL_BASE64_SIGNATURE_PATTERN.test(value)) {
    throw new WttChallengeError('invalid-argument', 'signature must be a canonical base64 Ed25519 signature.');
  }
  const signature = Buffer.from(value, 'base64');
  if (signature.length !== 64 || signature.toString('base64') !== value) {
    throw new WttChallengeError('invalid-argument', 'signature must be a canonical base64 Ed25519 signature.');
  }
  return signature;
}

function parseVerificationInput(input: unknown): { challengeId: string; signature: Uint8Array } {
  const request = requirePlainObject(input);
  requireExactKeys(request, ['challengeId', 'signature']);
  if (typeof request.challengeId !== 'string' || !CHALLENGE_ID_PATTERN.test(request.challengeId)) {
    throw new WttChallengeError('invalid-argument', 'challenge identifier is invalid.');
  }
  return { challengeId: request.challengeId, signature: decodeSignature(request.signature) };
}

function validateChallengeRecord(record: WttClaimChallengeRecord): void {
  if (record.schemaVersion !== WTT_CLAIM_CHALLENGE_SCHEMA_VERSION
    || !/^[0-9]+$/.test(record.githubProviderId)
    || !Array.isArray(record.entitlementIds)
    || record.entitlementIds.length === 0
    || !Number.isSafeInteger(record.amount)
    || record.amount < 1
    || typeof record.message !== 'string'
    || !record.message
    || typeof record.nonce !== 'string'
    || !['issued', 'verified', 'consumed'].includes(record.status)
    || !(record.issuedAt instanceof Date)
    || !(record.expiresAt instanceof Date)) {
    throw new WttChallengeError('failed-precondition', 'the stored wallet challenge is invalid.');
  }
  decodeSolanaPublicKey(record.walletAddress);
}

export async function verifyWttClaimChallenge(
  authToken: Record<string, unknown> | null,
  input: unknown,
  dependencies: WttChallengeDependencies,
): Promise<VerifiedWttClaimChallenge> {
  const githubProviderId = requireGitHubProviderId(authToken);
  const { challengeId, signature } = parseVerificationInput(input);
  const now = dependencies.now();
  return dependencies.runTransaction(async (transaction) => {
    const challenge = await transaction.loadChallenge(challengeId);
    if (!challenge) throw new WttChallengeError('not-found', 'wallet challenge was not found.');
    validateChallengeRecord(challenge);
    if (challenge.githubProviderId !== githubProviderId) {
      throw new WttChallengeError('permission-denied', 'wallet challenge belongs to another GitHub account.');
    }
    if (challenge.status === 'consumed') {
      throw new WttChallengeError('failed-precondition', 'wallet challenge has already been consumed.');
    }
    const entitlements = await transaction.loadEntitlements(challenge.entitlementIds);
    const amount = validateEntitlements(entitlements, challenge.entitlementIds, githubProviderId);
    if (amount !== challenge.amount) {
      throw new WttChallengeError('failed-precondition', 'the selected WTT amount has changed. request a new challenge.');
    }
    if (challenge.status === 'verified') {
      if (!challenge.verifiedAt) {
        throw new WttChallengeError('failed-precondition', 'the stored wallet challenge is invalid.');
      }
      return {
        challengeId,
        status: 'verified' as const,
        walletAddress: challenge.walletAddress,
        entitlementIds: [...challenge.entitlementIds],
        amount: challenge.amount,
        verifiedAt: challenge.verifiedAt.toISOString(),
      };
    }
    if (now.getTime() >= challenge.expiresAt.getTime()) {
      throw new WttChallengeError('failed-precondition', 'wallet challenge has expired. request a new one.');
    }
    const publicKey = decodeSolanaPublicKey(challenge.walletAddress);
    const message = new TextEncoder().encode(challenge.message);
    if (!ed25519.verify(signature, message, publicKey, { zip215: false })) {
      throw new WttChallengeError('permission-denied', 'wallet signature could not be verified.');
    }
    transaction.markVerified(challengeId, now);
    return {
      challengeId,
      status: 'verified' as const,
      walletAddress: challenge.walletAddress,
      entitlementIds: [...challenge.entitlementIds],
      amount: challenge.amount,
      verifiedAt: now.toISOString(),
    };
  });
}

export function defaultWttChallengeRandomBytes(size: number): Uint8Array {
  return randomBytes(size);
}
