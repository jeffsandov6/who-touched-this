import {
  FieldValue,
  Timestamp,
  type Firestore,
} from 'firebase-admin/firestore';
import type { DeliveryClaim, DeliveryIdentity, DeliveryStore } from './types.js';

const CLAIM_LEASE_MILLISECONDS = 5 * 60 * 1000;

export class FirestoreDeliveryStore implements DeliveryStore {
  constructor(private readonly firestore: Firestore) {}

  async claim(identity: DeliveryIdentity): Promise<DeliveryClaim> {
    const reference = this.firestore.doc(`emailDeliveries/${identity.deliveryId}`);
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (snapshot.data()?.status === 'sent') return { kind: 'already-sent' };

      const attemptedAt = snapshot.data()?.attemptedAt;
      if (snapshot.data()?.status === 'sending' && attemptedAt instanceof Timestamp
        && attemptedAt.toMillis() > Date.now() - CLAIM_LEASE_MILLISECONDS) {
        return { kind: 'busy' };
      }

      const attemptCount = typeof snapshot.data()?.attemptCount === 'number'
        ? snapshot.data()!.attemptCount + 1
        : 1;
      transaction.set(reference, {
        type: identity.type,
        ...(identity.invitationId ? { invitationId: identity.invitationId } : {}),
        ...(identity.turnId ? { turnId: identity.turnId } : {}),
        ...(identity.contributionNumber !== undefined
          ? { contributionNumber: identity.contributionNumber }
          : {}),
        githubUserId: identity.githubUserId,
        status: 'sending',
        attemptCount,
        attemptedAt: FieldValue.serverTimestamp(),
        claimToken: identity.claimToken,
        createdAt: snapshot.exists ? snapshot.data()!.createdAt : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { kind: 'claimed' };
    });
  }

  async markSent(identity: DeliveryIdentity, providerMessageId: string): Promise<void> {
    const reference = this.firestore.doc(`emailDeliveries/${identity.deliveryId}`);
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists || snapshot.data()?.claimToken !== identity.claimToken) {
        throw new Error('Email delivery claim is no longer current.');
      }
      transaction.update(reference, {
        status: 'sent',
        sentAt: FieldValue.serverTimestamp(),
        providerMessageId: providerMessageId.slice(0, 256),
        failureCode: FieldValue.delete(),
        claimToken: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  }

  async markFailed(identity: DeliveryIdentity, failureCode: string): Promise<void> {
    const reference = this.firestore.doc(`emailDeliveries/${identity.deliveryId}`);
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists || snapshot.data()?.claimToken !== identity.claimToken) return;
      transaction.update(reference, {
        status: 'failed',
        failureCode: failureCode.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'delivery_error',
        claimToken: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  }
}
