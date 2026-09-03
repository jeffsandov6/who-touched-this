import { doc, getDoc, Timestamp } from 'firebase/firestore';
import { FirebaseError } from 'firebase/app';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { connectFirebaseEmulatorOnce, getFirebaseApp } from './client';
import { getPlatformFirestore } from './firestore';
import type { EmailDeliveryStatus } from './models';
import {
  emailDeliveryDocumentPath,
  invitationEmailDeliveryId,
} from './paths';

export interface AdminEmailDeliveryState {
  status: EmailDeliveryStatus;
  sentAt: Date | null;
}

export async function getAdminInvitationEmailDelivery(
  invitationId: string,
): Promise<AdminEmailDeliveryState | null> {
  const deliveryId = invitationEmailDeliveryId(invitationId);
  const snapshot = await getDoc(doc(
    getPlatformFirestore(),
    emailDeliveryDocumentPath(deliveryId),
  ));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  if (!['sending', 'sent', 'failed'].includes(data.status)) {
    throw new Error('Email delivery status is malformed.');
  }
  if (data.sentAt !== undefined && !(data.sentAt instanceof Timestamp)) {
    throw new Error('Email delivery timestamp is malformed.');
  }
  return {
    status: data.status as EmailDeliveryStatus,
    sentAt: data.sentAt instanceof Timestamp ? data.sentAt.toDate() : null,
  };
}

export async function retryFailedInvitationEmail(invitationId: string): Promise<void> {
  if (!invitationId || invitationId.includes('/')) throw new Error('Invitation ID is invalid.');
  const functions = getFunctions(getFirebaseApp(), 'us-central1');
  connectFirebaseEmulatorOnce('functions', () =>
    connectFunctionsEmulator(functions, '127.0.0.1', 5001),
  );
  try {
    await httpsCallable<{ invitationId: string }, { status: string }>(
      functions, 'retryInvitationEmail',
    )({ invitationId });
  } catch (error) {
    if (error instanceof FirebaseError) {
      if (error.code === 'functions/permission-denied' || error.code === 'functions/unauthenticated') {
        throw new Error('Admin authorization could not be verified.');
      }
      if (error.code === 'functions/failed-precondition') {
        throw new Error('This invitation email is no longer eligible for retry.');
      }
    }
    throw new Error('The invitation email could not be retried. Try again later.');
  }
}
