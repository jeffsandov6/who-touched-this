import { randomUUID } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  configuredAppOrigin,
  emailProviderMode,
  githubBaseBranch,
  githubRepository,
  githubWebhookSecret,
  resendApiKey,
} from './config.js';
import { FirestoreDeliveryStore } from './email/firestore-delivery-store.js';
import { processInvitationCreated } from './email/invitation-delivery.js';
import {
  sendContributionCompleted,
  sendTurnNotification,
  type LifecycleDeliveryDependencies,
} from './email/lifecycle-delivery.js';
import { FailingEmailProvider, LocalMailboxEmailProvider } from './email/local-provider.js';
import { dispatchEligibleNotifications } from './email/reminder-dispatcher.js';
import { ResendEmailProvider } from './email/resend-provider.js';
import { retryInvitationDelivery, RetryInvitationError } from './email/retry-invitation.js';
import type { EmailProvider } from './email/types.js';
import { handleGitHubWebhook } from './github/webhook.js';

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

function dependencies(): LifecycleDeliveryDependencies {
  return {
    appOrigin: configuredAppOrigin(),
    deliveryStore: new FirestoreDeliveryStore(getFirestore()),
    emailProvider: selectEmailProvider(),
    async loadContributor(githubUserId) {
      const snapshot = await getFirestore().doc(`contributors/${githubUserId}`).get();
      return snapshot.exists ? snapshot.data() as { email: unknown; displayName: unknown } : null;
    },
  };
}

function invitationDependencies() {
  return {
    ...dependencies(),
    async loadContributor(githubUserId: string) {
      const snapshot = await getFirestore().doc(`contributors/${githubUserId}`).get();
      return snapshot.exists ? snapshot.data() as {
        email: unknown; displayName: unknown; githubUsername?: unknown;
      } : null;
    },
  };
}

function safeLogFailure(message: string, sourceId: string, error: unknown): void {
  logger.error(message, {
    sourceId,
    failureCode: error instanceof Error ? error.name.slice(0, 64) : 'delivery_error',
  });
}

export const sendInvitationEmail = onDocumentCreated({
  document: 'invitations/{invitationId}', region: 'us-central1', retry: true,
  secrets: [resendApiKey],
}, async (event) => {
  const invitationId = event.params.invitationId;
  const data = event.data?.data();
  if (!data) return;
  try {
    await processInvitationCreated({
      invitationId, claimToken: randomUUID(), data: data as never,
    }, invitationDependencies());
  } catch (error) {
    safeLogFailure('Invitation email delivery failed and may be retried.', invitationId, error);
    throw error;
  }
});

export const sendTurnStartedEmail = onDocumentCreated({
  document: 'turns/{turnId}', region: 'us-central1', retry: true, secrets: [resendApiKey],
}, async (event) => {
  const data = event.data?.data();
  if (!data) return;
  try {
    await sendTurnNotification(
      'turn_started', event.params.turnId, data as never, randomUUID(), dependencies(),
    );
  } catch (error) {
    safeLogFailure('Turn-started email delivery failed and may be retried.', event.params.turnId, error);
    throw error;
  }
});

export const sendContributionCompletedEmail = onDocumentUpdated({
  document: 'turns/{turnId}', region: 'us-central1', retry: true, secrets: [resendApiKey],
}, async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after || before.status === 'merged' || after.status !== 'merged') return;
  const number = after.targetContributionNumber;
  if (!Number.isSafeInteger(number) || number < 1) return;
  const contribution = await getFirestore().doc(`contributions/${number}`).get();
  if (!contribution.exists) {
    logger.error('Merged contribution email is missing its public contribution.', {
      sourceId: event.params.turnId,
    });
    return;
  }
  try {
    await sendContributionCompleted(
      event.params.turnId, after as never, contribution.data() as never,
      randomUUID(), dependencies(),
    );
  } catch (error) {
    safeLogFailure('Completion email delivery failed and may be retried.', event.params.turnId, error);
    throw error;
  }
});

export const retryInvitationEmail = onCall({
  region: 'us-central1', secrets: [resendApiKey],
}, async (request) => {
  try {
    return await retryInvitationDelivery(
      request.auth?.token ?? null,
      request.data,
      {
        async loadAdmin(id) {
          const snapshot = await getFirestore().doc(`admins/${id}`).get();
          return snapshot.exists ? snapshot.data() ?? null : null;
        },
        async loadInvitation(id) {
          const snapshot = await getFirestore().doc(`invitations/${id}`).get();
          return snapshot.exists ? snapshot.data() ?? null : null;
        },
        async loadDelivery(id) {
          const snapshot = await getFirestore().doc(`emailDeliveries/invitation_${id}`).get();
          return snapshot.exists ? snapshot.data() ?? null : null;
        },
        async retry(id, invitation) {
          return processInvitationCreated({
            invitationId: id, claimToken: randomUUID(), data: invitation as never,
          }, invitationDependencies());
        },
      },
    );
  } catch (error) {
    if (error instanceof RetryInvitationError) {
      throw new HttpsError(error.code, error.message);
    }
    safeLogFailure('Admin invitation-email retry failed.', 'callable', error);
    throw new HttpsError('unavailable', 'Email delivery failed. Try again later.');
  }
});

export const dispatchEmailReminders = onSchedule({
  schedule: 'every 60 minutes', region: 'us-central1', secrets: [resendApiKey],
}, async () => {
  const firestore = getFirestore();
  const [invitationSnapshots, turnSnapshots] = await Promise.all([
    firestore.collection('invitations').where('status', '==', 'pending').limit(10).get(),
    firestore.collection('turns').where('status', '==', 'active').limit(10).get(),
  ]);
  try {
    await dispatchEligibleNotifications({
      now: new Date(),
      invitations: invitationSnapshots.docs.map((snapshot) => ({
        id: snapshot.id, data: snapshot.data() as never,
      })),
      turns: turnSnapshots.docs.map((snapshot) => ({
        id: snapshot.id, data: snapshot.data() as never,
      })),
      claimToken: randomUUID,
      onError: (sourceId, error) => safeLogFailure(
        'Scheduled notification delivery failed; a later hourly sweep may retry.', sourceId, error,
      ),
    }, dependencies());
  } catch (error) {
    safeLogFailure('Scheduled email dispatcher encountered a delivery failure.', 'hourly-sweep', error);
  }
});

export const githubWebhook = onRequest({
  region: 'us-central1', secrets: [githubWebhookSecret], cors: false,
}, async (request, response) => {
  try {
    await handleGitHubWebhook(request, response, {
      firestore: getFirestore(),
      secret: githubWebhookSecret.value(),
      config: {
        repository: githubRepository.value(),
        baseBranch: githubBaseBranch.value(),
      },
    });
  } catch (error) {
    safeLogFailure('GitHub webhook processing failed.', 'github-webhook', error);
    response.status(500).json({ ok: false, result: 'processing_error' });
  }
});
