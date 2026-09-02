import { doc, getDoc, Timestamp } from 'firebase/firestore';
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
