import type { Firestore, Transaction } from 'firebase-admin/firestore';
import {
  type WttChallengeDependencies,
  type WttChallengeEntitlement,
  type WttClaimChallengeRecord,
  type WttClaimChallengeStatus,
  defaultWttChallengeRandomBytes,
} from './challenges.js';

const ENTITLEMENT_COLLECTION = 'wttEntitlements';
const CHALLENGE_COLLECTION = 'wttClaimChallenges';

function parseDate(value: unknown): Date | null {
  if (!value || typeof value !== 'object') return null;
  const toDate = (value as { toDate?: unknown }).toDate;
  if (typeof toDate !== 'function') return null;
  try {
    const date = toDate.call(value) as Date;
    return date instanceof Date && Number.isFinite(date.getTime()) ? date : null;
  } catch {
    return null;
  }
}

function parseEntitlement(id: string, data: Record<string, unknown> | undefined): WttChallengeEntitlement | null {
  if (!data || typeof data.githubProviderId !== 'string' || typeof data.amount !== 'number') return null;
  return {
    id,
    githubProviderId: data.githubProviderId,
    amount: data.amount,
    status: data.status,
  };
}

function parseChallenge(data: Record<string, unknown> | undefined): WttClaimChallengeRecord | null {
  if (!data
    || data.schemaVersion !== 1
    || typeof data.githubProviderId !== 'string'
    || typeof data.walletAddress !== 'string'
    || !Array.isArray(data.entitlementIds)
    || !data.entitlementIds.every((id): id is string => typeof id === 'string')
    || typeof data.amount !== 'number'
    || typeof data.message !== 'string'
    || typeof data.nonce !== 'string'
    || !['issued', 'verified', 'consumed'].includes(String(data.status))) return null;
  const issuedAt = parseDate(data.issuedAt);
  const expiresAt = parseDate(data.expiresAt);
  const verifiedAt = data.verifiedAt === null ? null : parseDate(data.verifiedAt);
  const consumedAt = data.consumedAt === null ? null : parseDate(data.consumedAt);
  if (!issuedAt || !expiresAt || (data.verifiedAt !== null && !verifiedAt)
    || (data.consumedAt !== null && !consumedAt)) return null;
  return {
    schemaVersion: 1,
    githubProviderId: data.githubProviderId,
    walletAddress: data.walletAddress,
    entitlementIds: [...data.entitlementIds],
    amount: data.amount,
    message: data.message,
    nonce: data.nonce,
    status: data.status as WttClaimChallengeStatus,
    issuedAt,
    expiresAt,
    verifiedAt,
    consumedAt,
  };
}

async function loadEntitlements(
  firestore: Firestore,
  entitlementIds: readonly string[],
  transaction?: Transaction,
): Promise<Array<WttChallengeEntitlement | null>> {
  const references = entitlementIds.map((id) => firestore.collection(ENTITLEMENT_COLLECTION).doc(id));
  const snapshots = transaction
    ? await Promise.all(references.map((reference) => transaction.get(reference)))
    : await firestore.getAll(...references);
  return snapshots.map((snapshot) => parseEntitlement(snapshot.id, snapshot.data()));
}

export function firestoreWttChallengeDependencies(
  firestore: Firestore,
  appOrigin: string,
): WttChallengeDependencies {
  return {
    appOrigin,
    now: () => new Date(),
    randomBytes: defaultWttChallengeRandomBytes,
    loadEntitlements: (entitlementIds) => loadEntitlements(firestore, entitlementIds),
    async createChallenge(challengeId, record) {
      await firestore.collection(CHALLENGE_COLLECTION).doc(challengeId).create(record);
    },
    runTransaction: (operation) => firestore.runTransaction(async (transaction) => operation({
      async loadChallenge(challengeId) {
        const snapshot = await transaction.get(firestore.collection(CHALLENGE_COLLECTION).doc(challengeId));
        return parseChallenge(snapshot.data());
      },
      loadEntitlements: (entitlementIds) => loadEntitlements(firestore, entitlementIds, transaction),
      markVerified(challengeId, verifiedAt) {
        transaction.update(firestore.collection(CHALLENGE_COLLECTION).doc(challengeId), {
          status: 'verified',
          verifiedAt,
        });
      },
    })),
  };
}
