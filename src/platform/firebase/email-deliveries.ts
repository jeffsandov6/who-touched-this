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
    throw new Error('email delivery status is malformed.');
  }
  if (data.sentAt !== undefined && !(data.sentAt instanceof Timestamp)) {
    throw new Error('email delivery timestamp is malformed.');
  }
  return {
    status: data.status as EmailDeliveryStatus,
    sentAt: data.sentAt instanceof Timestamp ? data.sentAt.toDate() : null,
  };
}

export async function retryFailedInvitationEmail(invitationId: string): Promise<void> {
  if (!invitationId || invitationId.includes('/')) throw new Error('invitation id is invalid.');
  const functions = getFunctions(getFirebaseApp(), 'us-central1');
  if (import.meta.env.DEV && import.meta.env.PUBLIC_USE_FIREBASE_EMULATORS === 'true') {
    connectFirebaseEmulatorOnce('functions', () =>
      connectFunctionsEmulator(functions, '127.0.0.1', 5001),
    );
  }
  try {
    await httpsCallable<{ invitationId: string }, { status: string }>(
      functions, 'retryInvitationEmail',
    )({ invitationId });
  } catch (error) {
    if (error instanceof FirebaseError) {
      if (error.code === 'functions/permission-denied' || error.code === 'functions/unauthenticated') {
        throw new Error('admin authorization could not be verified.');
      }
      if (error.code === 'functions/failed-precondition') {
        throw new Error('this invitation email is no longer eligible for retry.');
      }
    }
    throw new Error('the invitation email could not be retried. try again later.');
  }
}

export async function resendContributionCompletedEmail(contributionNumber: number): Promise<string> {
  if (!Number.isSafeInteger(contributionNumber) || contributionNumber < 0) {
    throw new Error('contribution number is invalid.');
  }
  const functions = getFunctions(getFirebaseApp(), 'us-central1');
  if (import.meta.env.DEV && import.meta.env.PUBLIC_USE_FIREBASE_EMULATORS === 'true') {
    connectFirebaseEmulatorOnce('functions', () =>
      connectFunctionsEmulator(functions, '127.0.0.1', 5001),
    );
  }
  try {
    const result = await httpsCallable<
      { contributionNumber: number }, { status: string }
    >(functions, 'resendContributionCompletedEmail')({ contributionNumber });
    return result.data.status;
  } catch (error) {
    if (error instanceof FirebaseError) {
      if (error.code === 'functions/permission-denied' || error.code === 'functions/unauthenticated') {
        throw new Error('admin authorization could not be verified.');
      }
      if (error.code === 'functions/failed-precondition') {
        throw new Error('the contribution or its WTT entitlement is missing or inconsistent.');
      }
    }
    throw new Error('the completion email could not be resent. try again later.');
  }
}
