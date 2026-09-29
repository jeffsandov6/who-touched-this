import { FirebaseError } from 'firebase/app';
import { collection, getDocs, query, where } from 'firebase/firestore';
import {
  parseWttEntitlement,
  type ParsedWttEntitlement,
} from '../wtt-entitlements';
import { getPlatformFirestore } from './firestore';
import { FIRESTORE_COLLECTIONS } from './paths';

export class WttEntitlementServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WttEntitlementServiceError';
  }
}

export async function loadOwnWttEntitlements(
  githubProviderId: string,
): Promise<ParsedWttEntitlement[]> {
  if (!/^[0-9]+$/.test(githubProviderId)) {
    throw new WttEntitlementServiceError('your GitHub identity could not be verified.');
  }
  try {
    const snapshot = await getDocs(query(
      collection(getPlatformFirestore(), FIRESTORE_COLLECTIONS.wttEntitlements),
      where('githubProviderId', '==', githubProviderId),
    ));
    const entitlements = snapshot.docs.map((document) => {
      const entitlement = parseWttEntitlement(
        document.id,
        document.data(),
        githubProviderId,
      );
      if (!entitlement) {
        throw new WttEntitlementServiceError('an earned WTT record contains unsupported data.');
      }
      return entitlement;
    });
    return entitlements.sort((left, right) =>
      right.earnedAt.getTime() - left.earnedAt.getTime() || left.id.localeCompare(right.id));
  } catch (error) {
    if (error instanceof WttEntitlementServiceError) throw error;
    if (error instanceof FirebaseError) {
      const messages: Record<string, string> = {
        'firestore/permission-denied': 'your WTT records could not be accessed with this GitHub account.',
        'firestore/unavailable': 'WTT records are temporarily unavailable. please try again.',
      };
      throw new WttEntitlementServiceError(
        messages[error.code] ?? 'your WTT records could not be loaded.',
      );
    }
    throw new WttEntitlementServiceError('your WTT records could not be loaded.');
  }
}
