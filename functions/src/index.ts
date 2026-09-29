import { randomUUID } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
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
import { processAdminPrSubmission } from './email/admin-submission-delivery.js';
import { processInvitationCreated } from './email/invitation-delivery.js';
import {
  sendContributionCompleted,
  sendContributionCompletedFromContribution,
  sendTurnNotification,
  type LifecycleDeliveryDependencies,
} from './email/lifecycle-delivery.js';
import { FailingEmailProvider, LocalMailboxEmailProvider } from './email/local-provider.js';
import { dispatchEligibleNotifications } from './email/reminder-dispatcher.js';
import { ResendEmailProvider } from './email/resend-provider.js';
import { retryInvitationDelivery, RetryInvitationError } from './email/retry-invitation.js';
import {
  resendContributionCompletedEmail as resendContributionCompletedEmailRequest,
  ResendContributionError,
} from './email/resend-contribution-completed.js';
import { deliveryIds } from './email/notification-eligibility.js';
import type { EmailProvider } from './email/types.js';
import { handleGitHubWebhook } from './github/webhook.js';
import { finalizeSnapshotArchiveRequest, SnapshotFinalizeError } from './snapshots/finalize.js';
import { recordFounderSeedContribution, FounderSeedError } from './founder/record.js';
import { ensureFirestoreContributionEntitlement } from './wtt/firestore-entitlements.js';
import {
  issueWttClaimChallenge as issueWttClaimChallengeRequest,
  verifyWttClaimChallenge as verifyWttClaimChallengeRequest,
  WttChallengeError,
} from './wtt/challenges.js';
import { firestoreWttChallengeDependencies } from './wtt/firestore-challenges.js';
import {
  executeWttClaim,
  defaultWttClaimRandomBytes,
} from './wtt/claim-service.js';
import { WttClaimError } from './wtt/claims.js';
import { firestoreWttClaimStore } from './wtt/firestore-claims.js';
import { GoogleKmsWttMessageSigner } from './wtt/kms-signer.js';
import { MainnetWttSolanaGateway } from './wtt/solana-claims.js';
import {
  WTT_CLAIM_SERVICE_ACCOUNT,
  configuredWttSolanaRpcUrl,
} from './wtt/config.js';

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
    const entitlement = await ensureFirestoreContributionEntitlement(
      getFirestore(), String(number), contribution.data() as Record<string, unknown>,
    );
    if (entitlement.status === 'ineligible') {
      logger.error('Completion email withheld because its contribution is not WTT-eligible.', {
        sourceId: event.params.turnId,
      });
      return;
    }
    const result = await sendContributionCompleted(
      event.params.turnId, after as never, contribution.data() as never,
      randomUUID(), dependencies(),
    );
    if (result.kind === 'failed') throw new Error(result.code);
  } catch (error) {
    safeLogFailure('Completion email delivery failed and may be retried.', event.params.turnId, error);
    throw error;
  }
});

export const grantWttContributionEntitlement = onDocumentCreated({
  document: 'contributions/{contributionNumber}', region: 'us-central1', retry: true,
}, async (event) => {
  const contribution = event.data?.data();
  if (!contribution) return;
  const result = await ensureFirestoreContributionEntitlement(
    getFirestore(), event.params.contributionNumber, contribution,
  );
  if (result.status === 'ineligible') {
    logger.error('Contribution was not eligible for a WTT entitlement.', {
      sourceId: event.params.contributionNumber,
    });
    return;
  }
});

export const sendFounderContributionCompletedEmail = onDocumentCreated({
  document: 'contributions/{contributionNumber}', region: 'us-central1', retry: true,
  secrets: [resendApiKey],
}, async (event) => {
  if (event.params.contributionNumber !== '0') return;
  const contribution = event.data?.data();
  if (!contribution) return;
  try {
    const entitlement = await ensureFirestoreContributionEntitlement(
      getFirestore(), '0', contribution,
    );
    if (entitlement.status === 'ineligible') {
      logger.error('Founder completion email withheld because contribution #000 is not WTT-eligible.', {
        sourceId: '0',
      });
      return;
    }
    const result = await sendContributionCompletedFromContribution(
      '0', contribution as never, randomUUID(), dependencies(),
    );
    if (result.kind === 'failed') throw new Error(result.code);
  } catch (error) {
    safeLogFailure('Founder completion email delivery failed and may be retried.', '0', error);
    throw error;
  }
});

export const resendContributionCompletedEmail = onCall({
  region: 'us-central1', secrets: [resendApiKey],
}, async (request) => {
  const firestore = getFirestore();
  try {
    return await resendContributionCompletedEmailRequest(
      request.auth?.token ?? null,
      request.data,
      {
        async loadAdmin(id) {
          const snapshot = await firestore.doc(`admins/${id}`).get();
          return snapshot.exists ? snapshot.data() ?? null : null;
        },
        async loadContribution(id) {
          const snapshot = await firestore.doc(`contributions/${id}`).get();
          return snapshot.exists ? snapshot.data() ?? null : null;
        },
        async loadEntitlement(id) {
          const snapshot = await firestore.doc(`wttEntitlements/${id}`).get();
          return snapshot.exists ? snapshot.data() ?? null : null;
        },
        async resend(contributionId, contribution, requestedByGithubUserId) {
          const requestId = randomUUID();
          const deliveryId = deliveryIds.contributionCompletedResend(
            Number(contributionId), requestId,
          );
          const result = await sendContributionCompletedFromContribution(
            contributionId, contribution as never, requestId, dependencies(), {
              deliveryId,
              type: 'contribution_completed_resend',
              requestedByGithubUserId,
            },
          );
          logger.info('WTT completion email resend processed.', {
            event: 'wtt_completion_email_resent',
            contributionNumber: Number(contributionId),
            deliveryId,
            result: result.kind,
          });
          return result;
        },
      },
    );
  } catch (error) {
    if (error instanceof ResendContributionError) {
      throw new HttpsError(error.code, error.message);
    }
    safeLogFailure('Admin WTT completion-email resend failed.', 'callable', error);
    throw new HttpsError('unavailable', 'completion email could not be resent. try again later.');
  }
});

function mapWttChallengeError(error: unknown): never {
  if (error instanceof WttChallengeError) {
    throw new HttpsError(error.code, error.message);
  }
  safeLogFailure('WTT wallet challenge operation failed.', 'callable', error);
  throw new HttpsError('internal', 'wallet verification could not be completed. try again later.');
}

export const issueWttClaimChallenge = onCall({ region: 'us-central1' }, async (request) => {
  try {
    return await issueWttClaimChallengeRequest(
      request.auth?.token ?? null,
      request.data,
      firestoreWttChallengeDependencies(getFirestore(), configuredAppOrigin()),
    );
  } catch (error) {
    return mapWttChallengeError(error);
  }
});

export const verifyWttClaimChallenge = onCall({ region: 'us-central1' }, async (request) => {
  try {
    return await verifyWttClaimChallengeRequest(
      request.auth?.token ?? null,
      request.data,
      firestoreWttChallengeDependencies(getFirestore(), configuredAppOrigin()),
    );
  } catch (error) {
    return mapWttChallengeError(error);
  }
});

export const claimWtt = onCall({
  region: 'us-central1',
  serviceAccount: WTT_CLAIM_SERVICE_ACCOUNT,
  timeoutSeconds: 120,
  memory: '512MiB',
}, async (request) => {
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    throw new HttpsError(
      'failed-precondition',
      'production WTT claim execution is disabled in the local emulator; use mocked unit tests.',
    );
  }
  try {
    const firestore = getFirestore();
    return await executeWttClaim(request.auth?.token ?? null, request.data, {
      store: firestoreWttClaimStore(firestore),
      solana: new MainnetWttSolanaGateway(
        configuredWttSolanaRpcUrl(),
        new GoogleKmsWttMessageSigner(),
        (event, fields) => logger.warn('WTT Solana operational check failed.', {
          event: `wtt_${event}`,
          ...fields,
        }),
      ),
      now: () => new Date(),
      randomBytes: defaultWttClaimRandomBytes,
      observe: (event) => {
        const level = ['transaction_failed', 'attempt_expired'].includes(event.event)
          ? logger.warn : logger.info;
        level('WTT claim lifecycle event.', { ...event, event: `wtt_${event.event}` });
      },
    });
  } catch (error) {
    if (error instanceof WttClaimError) {
      throw new HttpsError(error.code, error.message);
    }
    safeLogFailure('WTT claim execution failed.', 'callable', error);
    throw new HttpsError('internal', 'WTT claim could not be completed. resume it later.');
  }
});

export const sendAdminPrSubmittedEmail = onDocumentUpdated({
  document: 'turns/{turnId}', region: 'us-central1', retry: true, secrets: [resendApiKey],
}, async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after || before.status !== 'active' || after.status !== 'submitted') return;
  try {
    await processAdminPrSubmission(
      event.params.turnId, before as never, after as never, randomUUID(), {
        appOrigin: configuredAppOrigin(),
        expectedRepository: githubRepository.value(),
        deliveryStore: new FirestoreDeliveryStore(getFirestore()),
        emailProvider: selectEmailProvider(),
        async loadContributor(githubUserId) {
          const snapshot = await getFirestore().doc(`contributors/${githubUserId}`).get();
          return snapshot.exists ? snapshot.data() as {
            displayName: unknown; githubUsername?: unknown;
          } : null;
        },
      },
    );
  } catch (error) {
    safeLogFailure('Admin PR-submission email failed and may be retried.', event.params.turnId, error);
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
    throw new HttpsError('unavailable', 'email delivery failed. try again later.');
  }
});

export const finalizeSnapshotArchive = onCall({ region: 'us-central1' }, async (request) => {
  const firestore = getFirestore();
  const bucket = getStorage().bucket();
  try {
    return await finalizeSnapshotArchiveRequest(request.auth?.token ?? null, request.data, {
      async loadAdmin(id) {
        const snapshot = await firestore.doc(`admins/${id}`).get();
        return snapshot.exists ? snapshot.data() ?? null : null;
      },
      async loadArchiveState(number) {
        const [contribution, snapshot, privateSite] = await Promise.all([
          firestore.doc(`contributions/${number}`).get(),
          firestore.doc(`contributionSnapshots/${number}`).get(),
          firestore.doc('site/admin').get(),
        ]);
        return {
          contribution: contribution.exists ? contribution.data() ?? null : null,
          snapshot: snapshot.exists ? snapshot.data() ?? null : null,
          privateSite: privateSite.exists ? privateSite.data() ?? null : null,
        };
      },
      async loadObject(path) {
        const file = bucket.file(path);
        const [exists] = await file.exists();
        if (!exists) return null;
        const [metadata] = await file.getMetadata();
        const base = {
          metadata: {
            path,
            size: Number(metadata.size),
            contentType: metadata.contentType ?? '',
            metadata: metadata.metadata as Record<string, string> ?? {},
          },
        };
        if (!path.endsWith('/manifest.json')) return base;
        const [contents] = await file.download();
        return { ...base, contents };
      },
      async listObjects(prefix) {
        const [files] = await bucket.getFiles({ prefix: `${prefix}/` });
        return files.map((file) => file.name);
      },
      async commitFinalization(input) {
        return firestore.runTransaction(async (transaction) => {
          const contributionReference = firestore.doc(`contributions/${input.contributionNumber}`);
          const snapshotReference = firestore.doc(`contributionSnapshots/${input.contributionNumber}`);
          const privateSiteReference = firestore.doc('site/admin');
          const [contribution, snapshot, privateSite] = await Promise.all([
            transaction.get(contributionReference),
            transaction.get(snapshotReference),
            transaction.get(privateSiteReference),
          ]);
          const contributionData = contribution.exists ? contribution.data() : null;
          const snapshotData = snapshot.exists ? snapshot.data() : null;
          const privateSiteData = privateSite.exists ? privateSite.data() : null;
          if (snapshotData) {
            if (contributionData?.archiveStatus === 'finalized'
              && snapshotData.captureId === input.captureId
              && snapshotData.contributionNumber === input.contributionNumber
              && snapshotData.beforeGitSha === input.beforeGitSha
              && snapshotData.afterGitSha === input.afterGitSha
              && (privateSiteData?.pendingArchiveContributionNumber ?? null) !== input.contributionNumber) {
              return 'already_finalized' as const;
            }
            throw new SnapshotFinalizeError('failed-precondition', 'this contribution already has a different finalized snapshot archive.');
          }
          if (!contributionData || contributionData.archiveStatus !== 'pending'
            || contributionData.beforeGitSha !== input.beforeGitSha
            || contributionData.afterGitSha !== input.afterGitSha
            || privateSiteData?.pendingArchiveContributionNumber !== input.contributionNumber) {
            throw new SnapshotFinalizeError('failed-precondition', 'archive state changed before finalization.');
          }
          transaction.create(snapshotReference, input.snapshot);
          transaction.update(contributionReference, { archiveStatus: 'finalized' });
          transaction.update(privateSiteReference, {
            pendingArchiveContributionNumber: null,
            updatedAt: FieldValue.serverTimestamp(),
          });
          return 'finalized' as const;
        });
      },
      archivedAt: () => FieldValue.serverTimestamp(),
    });
  } catch (error) {
    if (error instanceof SnapshotFinalizeError) throw new HttpsError(error.code, error.message);
    safeLogFailure('Snapshot archive finalization failed.', 'snapshot-archive', error);
    throw new HttpsError('failed-precondition', 'snapshot archive could not be finalized.');
  }
});

export const recordFounderContributionZero = onCall({ region: 'us-central1' }, async (request) => {
  const firestore = getFirestore();
  try {
    return await recordFounderSeedContribution(request.auth?.token ?? null, request.data, {
      canonicalRepository: githubRepository.value(),
      timestamp: () => FieldValue.serverTimestamp(),
      runTransaction: (operation) => firestore.runTransaction(async (transaction) => operation({
        async loadAdmin(id) {
          const snapshot = await transaction.get(firestore.doc(`admins/${id}`));
          return snapshot.exists ? snapshot.data() ?? null : null;
        },
        async loadPrivateSite() {
          const snapshot = await transaction.get(firestore.doc('site/admin'));
          return snapshot.exists ? snapshot.data() ?? null : null;
        },
        async loadPublicSite() {
          const snapshot = await transaction.get(firestore.doc('site/public'));
          return snapshot.exists ? snapshot.data() ?? null : null;
        },
        async anyContributionExists() {
          return !(await transaction.get(firestore.collection('contributions').limit(1))).empty;
        },
        async founderContributionExists() {
          return (await transaction.get(firestore.doc('contributions/0'))).exists;
        },
        async founderHistoryExists() {
          const [deterministic, anyZero] = await Promise.all([
            transaction.get(firestore.doc('historyEvents/founder_seed_000')),
            transaction.get(firestore.collection('historyEvents').where('contributionNumber', '==', 0).limit(1)),
          ]);
          return deterministic.exists || !anyZero.empty;
        },
        createContribution(data) {
          transaction.create(firestore.doc('contributions/0'), data);
        },
        createHistory(data) {
          transaction.create(firestore.doc('historyEvents/founder_seed_000'), data);
        },
        setPublicSite(data) {
          transaction.set(firestore.doc('site/public'), data);
        },
        setPrivateSite(data) {
          transaction.set(firestore.doc('site/admin'), data);
        },
      })),
    });
  } catch (error) {
    if (error instanceof FounderSeedError) throw new HttpsError(error.code, error.message);
    safeLogFailure('Founder Contribution #000 recording failed.', 'founder-seed', error);
    throw new HttpsError('failed-precondition', 'founder contribution #000 could not be recorded.');
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
