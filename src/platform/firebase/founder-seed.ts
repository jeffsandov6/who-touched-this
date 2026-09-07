import { FirebaseError } from 'firebase/app';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
import { doc, getDoc } from 'firebase/firestore';
import { connectFirebaseEmulatorOnce, getFirebaseApp } from './client';
import { getPlatformFirestore } from './firestore';
import { contributionDocumentPath } from './paths';
import { parsePublicContribution, type ParsedContribution } from '../history';
import type { FounderSeedRequest } from '../founder-seed';

function functionsClient() {
  const functions = getFunctions(getFirebaseApp(), 'us-central1');
  if (import.meta.env.DEV && import.meta.env.PUBLIC_USE_FIREBASE_EMULATORS === 'true') {
    connectFirebaseEmulatorOnce('functions', () => connectFunctionsEmulator(functions, '127.0.0.1', 5001));
  }
  return functions;
}

function friendlyError(error: unknown): Error {
  if (error instanceof FirebaseError) {
    const message = typeof error.message === 'string' && error.message.includes(': ')
      ? error.message.slice(error.message.indexOf(': ') + 2)
      : 'founder contribution #000 could not be recorded.';
    return new Error(message);
  }
  return error instanceof Error ? error : new Error('founder contribution #000 could not be recorded.');
}

export async function loadFounderSeedContribution(): Promise<ParsedContribution | null> {
  const snapshot = await getDoc(doc(getPlatformFirestore(), contributionDocumentPath(0)));
  if (!snapshot.exists()) return null;
  const contribution = parsePublicContribution(snapshot.data());
  if (!contribution || contribution.contributionKind !== 'founder_seed') {
    throw new Error('founder contribution #000 data is malformed.');
  }
  return contribution;
}

export async function recordFounderContributionZero(input: FounderSeedRequest): Promise<void> {
  try {
    const callable = httpsCallable<FounderSeedRequest, { status: string; contributionNumber: number }>(
      functionsClient(),
      'recordFounderContributionZero',
    );
    await callable(input);
  } catch (error) {
    throw friendlyError(error);
  }
}
