import { FirebaseError } from 'firebase/app';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { connectFirebaseEmulatorOnce, getFirebaseApp } from './client';

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

export type WttClaimExecutionResult = {
  claimId: string;
  status: 'processing';
  amount: number;
  walletAddress: string;
  transactionSignature: string | null;
} | {
  claimId: string;
  status: 'confirmed';
  amount: number;
  walletAddress: string;
  transactionSignature: string;
  confirmedAt: string;
};

function functionsClient() {
  const functions = getFunctions(getFirebaseApp(), 'us-central1');
  if (import.meta.env.DEV && import.meta.env.PUBLIC_USE_FIREBASE_EMULATORS === 'true') {
    connectFirebaseEmulatorOnce('functions', () => connectFunctionsEmulator(functions, '127.0.0.1', 5001));
  }
  return functions;
}

function friendlyChallengeError(error: unknown): Error {
  if (error instanceof FirebaseError) {
    const message = typeof error.message === 'string' && error.message.includes(': ')
      ? error.message.slice(error.message.indexOf(': ') + 2)
      : 'wallet verification could not be completed.';
    return new Error(message);
  }
  return error instanceof Error ? error : new Error('wallet verification could not be completed.');
}

export async function issueWttClaimChallenge(input: {
  walletAddress: string;
  entitlementIds: string[];
}): Promise<IssuedWttClaimChallenge> {
  try {
    const callable = httpsCallable<typeof input, IssuedWttClaimChallenge>(
      functionsClient(),
      'issueWttClaimChallenge',
    );
    return (await callable(input)).data;
  } catch (error) {
    throw friendlyChallengeError(error);
  }
}

export async function verifyWttClaimChallenge(input: {
  challengeId: string;
  signature: string;
}): Promise<VerifiedWttClaimChallenge> {
  try {
    const callable = httpsCallable<typeof input, VerifiedWttClaimChallenge>(
      functionsClient(),
      'verifyWttClaimChallenge',
    );
    return (await callable(input)).data;
  } catch (error) {
    throw friendlyChallengeError(error);
  }
}

export async function claimWtt(challengeId: string): Promise<WttClaimExecutionResult> {
  try {
    const callable = httpsCallable<{ challengeId: string }, WttClaimExecutionResult>(
      functionsClient(),
      'claimWtt',
    );
    return (await callable({ challengeId })).data;
  } catch (error) {
    throw friendlyChallengeError(error);
  }
}

/** Encodes the Wallet Standard Ed25519 signature for callable transport. */
export function signatureBytesToBase64(signature: Uint8Array): string {
  let binary = '';
  for (const byte of signature) binary += String.fromCharCode(byte);
  return btoa(binary);
}
