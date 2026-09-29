import type { Firestore } from 'firebase-admin/firestore';
import {
  buildContributionEntitlement,
  grantContributionEntitlement,
  validateExistingContributionEntitlement,
  type GrantContributionEntitlementResult,
} from './entitlements.js';

export class WttEntitlementConflictError extends Error {
  constructor(public readonly entitlementId: string, message: string) {
    super(message);
    this.name = 'WttEntitlementConflictError';
  }
}

export async function ensureFirestoreContributionEntitlement(
  firestore: Firestore,
  contributionId: string,
  contribution: Record<string, unknown>,
): Promise<GrantContributionEntitlementResult> {
  const expected = buildContributionEntitlement(contributionId, contribution);
  if (!expected) return { status: 'ineligible' };
  return grantContributionEntitlement(contributionId, contribution, {
    createIfAbsent: (entitlementId, record) => firestore.runTransaction(async (transaction) => {
      const reference = firestore.doc(`wttEntitlements/${entitlementId}`);
      const snapshot = await transaction.get(reference);
      if (snapshot.exists) {
        const validation = validateExistingContributionEntitlement(expected, snapshot.data());
        if (!validation.valid) {
          throw new WttEntitlementConflictError(entitlementId, validation.reason);
        }
        return 'already_exists' as const;
      }
      transaction.create(reference, record);
      return 'created' as const;
    }),
  });
}
