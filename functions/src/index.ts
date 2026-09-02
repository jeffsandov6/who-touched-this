import { randomUUID } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { configuredAppOrigin, emailProviderMode, resendApiKey } from './config.js';
import { FirestoreDeliveryStore } from './email/firestore-delivery-store.js';
import { processInvitationCreated } from './email/invitation-delivery.js';
import { FailingEmailProvider, LocalMailboxEmailProvider } from './email/local-provider.js';
import { ResendEmailProvider } from './email/resend-provider.js';
import type { EmailProvider } from './email/types.js';

if (getApps().length === 0) initializeApp();

function selectEmailProvider(): EmailProvider {
  const mode = emailProviderMode.value();
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    return mode === 'failure'
      ? new FailingEmailProvider()
      : new LocalMailboxEmailProvider(getFirestore());
  }
  return new ResendEmailProvider(resendApiKey.value());
}

export const sendInvitationEmail = onDocumentCreated({
  document: 'invitations/{invitationId}',
  region: 'us-central1',
  retry: true,
  secrets: [resendApiKey],
}, async (event) => {
  const invitationId = event.params.invitationId;
  const data = event.data?.data();
  if (!data) return;

  try {
    const result = await processInvitationCreated({
      invitationId,
      claimToken: randomUUID(),
      data: data as Parameters<typeof processInvitationCreated>[0]['data'],
    }, {
      appOrigin: configuredAppOrigin(),
      deliveryStore: new FirestoreDeliveryStore(getFirestore()),
      emailProvider: selectEmailProvider(),
      async loadContributor(githubUserId) {
        const snapshot = await getFirestore().doc(`contributors/${githubUserId}`).get();
        return snapshot.exists ? snapshot.data() as {
          email: unknown;
          displayName: unknown;
          githubUsername?: unknown;
        } : null;
      },
    });
    if (result.kind === 'failed') {
      logger.error('Invitation email could not be prepared.', {
        invitationId,
        failureCode: result.code,
      });
    }
  } catch (error) {
    logger.error('Invitation email delivery failed and may be retried.', {
      invitationId,
      failureCode: error instanceof Error ? error.name.slice(0, 64) : 'delivery_error',
    });
    throw error;
  }
});
