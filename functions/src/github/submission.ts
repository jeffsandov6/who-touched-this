import {
  FieldValue,
  Timestamp,
  type Firestore,
} from 'firebase-admin/firestore';
import type { PullRequestQualification, QualifiedPullRequest } from './qualification.js';

export interface WebhookDeliveryMetadata {
  deliveryId: string;
  event: string;
  action: string;
  repository: string;
}

export type WebhookProcessingResult =
  | 'submitted'
  | 'duplicate_delivery'
  | 'draft_opened'
  | 'unsupported_action'
  | 'unsupported_event'
  | 'wrong_repository'
  | 'wrong_base_repository'
  | 'wrong_base_branch'
  | 'invalid_pr_identity'
  | 'invalid_pr_url'
  | 'malformed_payload'
  | 'not_ready'
  | 'no_active_turn'
  | 'missing_turn'
  | 'wrong_contributor'
  | 'already_submitted_same_pr'
  | 'submission_conflict'
  | 'turn_not_active'
  | 'inconsistent_public_state';

function validateMetadata(metadata: WebhookDeliveryMetadata): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(metadata.deliveryId)) {
    throw new Error('GitHub delivery ID is invalid.');
  }
  if (!metadata.event || metadata.event.length > 50 || metadata.action.length > 50
    || metadata.repository.length > 200) throw new Error('GitHub delivery metadata is invalid.');
}

function deliveryRecord(metadata: WebhookDeliveryMetadata, resultCode: WebhookProcessingResult) {
  return {
    event: metadata.event.slice(0, 50),
    action: metadata.action.slice(0, 50),
    repository: metadata.repository.slice(0, 200),
    status: resultCode === 'submitted' ? 'processed' : 'ignored',
    resultCode,
    receivedAt: FieldValue.serverTimestamp(),
    processedAt: FieldValue.serverTimestamp(),
  };
}

export async function recordIgnoredWebhookDelivery(
  firestore: Firestore,
  metadata: WebhookDeliveryMetadata,
  resultCode: WebhookProcessingResult,
): Promise<WebhookProcessingResult> {
  validateMetadata(metadata);
  const reference = firestore.doc(`githubWebhookDeliveries/${metadata.deliveryId}`);
  return firestore.runTransaction(async (transaction) => {
    if ((await transaction.get(reference)).exists) return 'duplicate_delivery';
    transaction.create(reference, deliveryRecord(metadata, resultCode));
    return resultCode;
  });
}

function validActiveTurn(data: Record<string, unknown>): data is Record<string, unknown> & {
  githubUserId: string; targetContributionNumber: number; dueAt: Timestamp;
} {
  const allowedKeys = new Set([
    'githubUserId', 'season', 'status', 'targetContributionNumber',
    'startedAt', 'dueAt', 'createdAt', 'updatedAt',
  ]);
  return Object.keys(data).length === allowedKeys.size
    && Object.keys(data).every((key) => allowedKeys.has(key))
    && typeof data.githubUserId === 'string' && /^[0-9]+$/.test(data.githubUserId)
    && data.season === 1 && data.status === 'active'
    && Number.isSafeInteger(data.targetContributionNumber)
    && (data.targetContributionNumber as number) > 0
    && data.startedAt instanceof Timestamp && data.dueAt instanceof Timestamp
    && data.createdAt instanceof Timestamp && data.updatedAt instanceof Timestamp;
}

export async function submitCurrentTurnFromWebhook(
  firestore: Firestore,
  metadata: WebhookDeliveryMetadata,
  pullRequest: QualifiedPullRequest,
): Promise<WebhookProcessingResult> {
  validateMetadata(metadata);
  const deliveryReference = firestore.doc(`githubWebhookDeliveries/${metadata.deliveryId}`);
  const privateSiteReference = firestore.doc('site/admin');
  const publicSiteReference = firestore.doc('site/public');
  return firestore.runTransaction(async (transaction) => {
    const [deliverySnapshot, privateSiteSnapshot] = await Promise.all([
      transaction.get(deliveryReference), transaction.get(privateSiteReference),
    ]);
    if (deliverySnapshot.exists) return 'duplicate_delivery';
    const privateSite = privateSiteSnapshot.data();
    if ((privateSite?.pendingArchiveContributionNumber ?? null) !== null) {
      transaction.create(deliveryReference, deliveryRecord(metadata, 'turn_not_active'));
      return 'turn_not_active';
    }
    const activeTurnId = privateSite?.activeTurnId;
    if (typeof activeTurnId !== 'string' || !activeTurnId) {
      transaction.create(deliveryReference, deliveryRecord(metadata, 'no_active_turn'));
      return 'no_active_turn';
    }
    if (privateSite?.pendingInvitationId !== null) {
      transaction.create(deliveryReference, deliveryRecord(metadata, 'turn_not_active'));
      return 'turn_not_active';
    }
    const turnReference = firestore.doc(`turns/${activeTurnId}`);
    const [turnSnapshot, publicSiteSnapshot] = await Promise.all([
      transaction.get(turnReference), transaction.get(publicSiteReference),
    ]);
    if (!turnSnapshot.exists) {
      transaction.create(deliveryReference, deliveryRecord(metadata, 'missing_turn'));
      return 'missing_turn';
    }
    const turn = turnSnapshot.data()!;
    if (turn.status !== 'active') {
      const result = turn.status === 'submitted'
        ? turn.prNumber === pullRequest.prNumber && turn.prUrl === pullRequest.prUrl
          ? 'already_submitted_same_pr'
          : 'submission_conflict'
        : 'turn_not_active';
      transaction.create(deliveryReference, deliveryRecord(metadata, result));
      return result;
    }
    if (!validActiveTurn(turn)) {
      transaction.create(deliveryReference, deliveryRecord(metadata, 'turn_not_active'));
      return 'turn_not_active';
    }
    if (turn.githubUserId !== pullRequest.authorGitHubUserId) {
      transaction.create(deliveryReference, deliveryRecord(metadata, 'wrong_contributor'));
      return 'wrong_contributor';
    }
    const publicState = publicSiteSnapshot.data();
    if (!publicSiteSnapshot.exists || publicState?.turnStatus !== 'active'
      || publicState.targetContributionNumber !== turn.targetContributionNumber
      || !(publicState.dueAt instanceof Timestamp)
      || publicState.dueAt.toMillis() !== turn.dueAt.toMillis()
      || !Number.isSafeInteger(publicState.currentVersion)
      || (publicState.currentVersion as number) < 0
      || !Number.isSafeInteger(publicState.totalContributions)
      || (publicState.totalContributions as number) < 0
      || turn.targetContributionNumber !== (publicState.currentVersion as number) + 1
      || !publicState.currentContributor || typeof publicState.currentContributor !== 'object') {
      transaction.create(deliveryReference, deliveryRecord(metadata, 'inconsistent_public_state'));
      return 'inconsistent_public_state';
    }
    transaction.update(turnReference, {
      status: 'submitted',
      prNumber: pullRequest.prNumber,
      prUrl: pullRequest.prUrl,
      submittedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(publicSiteReference, {
      turnStatus: 'submitted',
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(deliveryReference, deliveryRecord(metadata, 'submitted'));
    return 'submitted';
  });
}

export async function processPullRequestQualification(
  firestore: Firestore,
  metadata: WebhookDeliveryMetadata,
  qualification: PullRequestQualification,
): Promise<WebhookProcessingResult> {
  if (qualification.kind === 'ignored') {
    return recordIgnoredWebhookDelivery(
      firestore, metadata, qualification.code as WebhookProcessingResult,
    );
  }
  return submitCurrentTurnFromWebhook(firestore, metadata, qualification.pullRequest);
}
