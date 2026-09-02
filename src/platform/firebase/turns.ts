import {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  Timestamp,
  type WithFieldValue,
} from 'firebase/firestore';
import { CURRENT_SEASON } from '../config/season';
import {
  calculateTargetContributionNumber,
  type PublicSiteViewState,
  tryParsePublicSiteState,
} from '../turn-state';
import {
  canExpireTurn,
  normalizePullRequestSubmission,
  PullRequestValidationError,
} from '../turn-lifecycle';
import { AdminServiceError, toAdminServiceError } from './admin';
import {
  loadSeasonOneAdminQueue,
  parseAdminContributor,
  parseAdminQueueEntry,
} from './admin-queue';
import { getEffectiveWaitingQueue } from './admin-queue-logic';
import { getPlatformFirestore } from './firestore';
import type {
  ParticipationRecord,
  PrivateSiteState,
  PublicSiteState,
  TurnRecord,
  TurnStatus,
} from './models';
import {
  adminDocumentPath,
  contributorDocumentPath,
  FIRESTORE_COLLECTIONS,
  participationDocumentPath,
  PRIVATE_SITE_DOCUMENT_PATH,
  PUBLIC_SITE_DOCUMENT_PATH,
  queueDocumentPath,
  turnDocumentPath,
} from './paths';

export interface StartTurnInput {
  adminGithubUserId: string;
  selectedGithubUserId: string;
  dueAt: Date;
}

export interface StartTurnResult {
  turnId: string;
  targetContributionNumber: number;
}

export interface AdminCurrentTurn {
  turnId: string;
  githubUserId: string;
  githubUsername: string;
  githubProfileUrl: string;
  displayName: string;
  email: string;
  season: number;
  status: 'active' | 'submitted' | 'under_review';
  targetContributionNumber: number;
  startedAt: Date;
  dueAt: Date;
  prNumber?: number;
  prUrl?: string;
  submittedAt?: Date;
  reviewStartedAt?: Date;
}

function activeAdminRecordIsValid(data: Record<string, unknown>, githubUserId: string): boolean {
  return (
    data.githubUserId === githubUserId &&
    data.active === true &&
    (data.role === 'owner' || data.role === 'admin')
  );
}

function parseWaitingParticipation(
  data: Record<string, unknown>,
  expectedGithubUserId: string,
): ParticipationRecord {
  if (
    data.githubUserId !== expectedGithubUserId ||
    data.season !== CURRENT_SEASON ||
    data.status !== 'waiting' ||
    !(data.createdAt instanceof Timestamp) ||
    !(data.updatedAt instanceof Timestamp) ||
    'contributionNumber' in data
  ) {
    throw new AdminServiceError('The selected participation record is not waiting.');
  }
  return data as unknown as ParticipationRecord;
}

function parseCurrentTurn(
  turnId: string,
  data: Record<string, unknown>,
): TurnRecord & { status: 'active' | 'submitted' | 'under_review' } {
  const isCurrentStatus = ['active', 'submitted', 'under_review'].includes(data.status as string);
  let hasValidPullRequest = false;
  if (typeof data.prUrl === 'string' && Number.isSafeInteger(data.prNumber)) {
    try {
      normalizePullRequestSubmission(data.prUrl, data.prNumber as number);
      hasValidPullRequest = true;
    } catch {
      hasValidPullRequest = false;
    }
  }
  const hasValidSubmission = data.status === 'active'
    ? data.prNumber === undefined && data.prUrl === undefined && data.submittedAt === undefined
      && data.reviewStartedAt === undefined
    : hasValidPullRequest && data.submittedAt instanceof Timestamp
      && (data.status === 'submitted'
        ? data.reviewStartedAt === undefined
        : data.reviewStartedAt instanceof Timestamp);
  if (
    !turnId ||
    typeof data.githubUserId !== 'string' ||
    data.season !== CURRENT_SEASON ||
    !isCurrentStatus ||
    !Number.isSafeInteger(data.targetContributionNumber) ||
    (data.targetContributionNumber as number) < 1 ||
    !(data.startedAt instanceof Timestamp) ||
    !(data.dueAt instanceof Timestamp) ||
    !(data.createdAt instanceof Timestamp) ||
    !(data.updatedAt instanceof Timestamp) ||
    data.endedAt !== undefined ||
    !hasValidSubmission
  ) {
    throw new AdminServiceError('The current turn contains unsupported data.');
  }
  return data as unknown as TurnRecord & { status: 'active' | 'submitted' | 'under_review' };
}

export async function loadAdminCurrentTurn(): Promise<AdminCurrentTurn | null> {
  try {
    const firestore = getPlatformFirestore();
    const privateSiteSnapshot = await getDoc(doc(firestore, PRIVATE_SITE_DOCUMENT_PATH));
    if (!privateSiteSnapshot.exists()) return null;

    const activeTurnId = privateSiteSnapshot.data().activeTurnId;
    if (activeTurnId === null) return null;
    if (typeof activeTurnId !== 'string' || !activeTurnId) {
      throw new AdminServiceError('Private current-turn state is malformed.');
    }

    const turnSnapshot = await getDoc(doc(firestore, turnDocumentPath(activeTurnId)));
    if (!turnSnapshot.exists()) {
      throw new AdminServiceError('The active turn record is missing.');
    }
    const turn = parseCurrentTurn(activeTurnId, turnSnapshot.data());
    const contributorSnapshot = await getDoc(
      doc(firestore, contributorDocumentPath(turn.githubUserId)),
    );
    if (!contributorSnapshot.exists()) {
      throw new AdminServiceError('The active contributor record is missing.');
    }
    const contributor = parseAdminContributor(
      contributorSnapshot.data(),
      turn.githubUserId,
    );

    return {
      turnId: activeTurnId,
      githubUserId: turn.githubUserId,
      githubUsername: contributor.githubUsername,
      githubProfileUrl: `https://github.com/${contributor.githubUsername}`,
      displayName: contributor.displayName,
      email: contributor.email,
      season: turn.season,
      status: turn.status,
      targetContributionNumber: turn.targetContributionNumber,
      startedAt: turn.startedAt.toDate(),
      dueAt: turn.dueAt.toDate(),
      ...(turn.prNumber ? { prNumber: turn.prNumber } : {}),
      ...(turn.prUrl ? { prUrl: turn.prUrl } : {}),
      ...(turn.submittedAt ? { submittedAt: turn.submittedAt.toDate() } : {}),
      ...(turn.reviewStartedAt ? { reviewStartedAt: turn.reviewStartedAt.toDate() } : {}),
    };
  } catch (error) {
    throw toAdminServiceError(error, 'The current turn could not be loaded.');
  }
}

export async function startTurn(input: StartTurnInput): Promise<StartTurnResult> {
  const dueAtMilliseconds = input.dueAt.getTime();
  if (!Number.isFinite(dueAtMilliseconds) || dueAtMilliseconds <= Date.now()) {
    throw new AdminServiceError('Choose a deadline in the future.');
  }

  const firstWaitingEntry = getEffectiveWaitingQueue(
    await loadSeasonOneAdminQueue(),
  )[0];
  if (!firstWaitingEntry || firstWaitingEntry.githubUserId !== input.selectedGithubUserId) {
    throw new AdminServiceError(
      'Only the effective first waiting contributor can be started.',
    );
  }

  const firestore = getPlatformFirestore();
  const turnReference = doc(collection(firestore, FIRESTORE_COLLECTIONS.turns));
  const adminReference = doc(firestore, adminDocumentPath(input.adminGithubUserId));
  const contributorReference = doc(
    firestore,
    contributorDocumentPath(input.selectedGithubUserId),
  );
  const participationReference = doc(
    firestore,
    participationDocumentPath(CURRENT_SEASON, input.selectedGithubUserId),
  );
  const queueReference = doc(
    firestore,
    queueDocumentPath(CURRENT_SEASON, input.selectedGithubUserId),
  );
  const privateSiteReference = doc(firestore, PRIVATE_SITE_DOCUMENT_PATH);
  const publicSiteReference = doc(firestore, PUBLIC_SITE_DOCUMENT_PATH);

  try {
    return await runTransaction(firestore, async (transaction) => {
      const [
        adminSnapshot,
        contributorSnapshot,
        participationSnapshot,
        queueSnapshot,
        privateSiteSnapshot,
        publicSiteSnapshot,
        existingTurnSnapshot,
      ] = await Promise.all([
        transaction.get(adminReference),
        transaction.get(contributorReference),
        transaction.get(participationReference),
        transaction.get(queueReference),
        transaction.get(privateSiteReference),
        transaction.get(publicSiteReference),
        transaction.get(turnReference),
      ]);

      if (
        !adminSnapshot.exists() ||
        !activeAdminRecordIsValid(adminSnapshot.data(), input.adminGithubUserId)
      ) {
        throw new AdminServiceError('Access denied.');
      }
      if (existingTurnSnapshot.exists()) {
        throw new AdminServiceError('The generated turn ID is already in use.');
      }
      if (!contributorSnapshot.exists()) {
        throw new AdminServiceError('The selected contributor record is missing.');
      }
      const contributor = parseAdminContributor(
        contributorSnapshot.data(),
        input.selectedGithubUserId,
      );
      if (!participationSnapshot.exists()) {
        throw new AdminServiceError('The selected participation record is missing.');
      }
      parseWaitingParticipation(participationSnapshot.data(), input.selectedGithubUserId);
      if (!queueSnapshot.exists()) {
        throw new AdminServiceError('The selected queue entry is missing.');
      }
      const queueEntry = parseAdminQueueEntry(
        queueSnapshot.data(),
        input.selectedGithubUserId,
      );
      if (queueEntry.status !== 'waiting') {
        throw new AdminServiceError('The selected queue entry is not waiting.');
      }

      if (privateSiteSnapshot.exists()) {
        const privateState = privateSiteSnapshot.data() as Partial<PrivateSiteState>;
        if (privateState.activeTurnId !== null) {
          throw new AdminServiceError('Another turn is already active.');
        }
      }

      const publicState = publicSiteSnapshot.exists()
        ? tryParsePublicSiteState(publicSiteSnapshot.data())
        : {
            currentVersion: 0,
            totalContributions: 0,
            turnStatus: 'none' as const,
            targetContributionNumber: null,
            currentContributor: null,
            dueAtMillis: null,
          };
      if (!publicState || publicState.turnStatus !== 'none') {
        throw new AdminServiceError('Another turn is already active or public state is malformed.');
      }

      const targetContributionNumber = calculateTargetContributionNumber(
        publicState.currentVersion,
      );
      const dueAt = Timestamp.fromMillis(dueAtMilliseconds);
      const turnRecord = {
        githubUserId: input.selectedGithubUserId,
        season: CURRENT_SEASON,
        status: 'active',
        targetContributionNumber,
        startedAt: serverTimestamp(),
        dueAt,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      } satisfies WithFieldValue<TurnRecord>;
      const privateState = {
        activeTurnId: turnReference.id,
        updatedAt: serverTimestamp(),
      } satisfies WithFieldValue<PrivateSiteState>;
      const nextPublicState = {
        currentVersion: publicState.currentVersion,
        totalContributions: publicState.totalContributions,
        turnStatus: 'active',
        targetContributionNumber,
        currentContributor: {
          githubUsername: contributor.githubUsername,
          displayName: contributor.displayName,
        },
        dueAt,
        updatedAt: serverTimestamp(),
      } satisfies WithFieldValue<PublicSiteState>;

      transaction.set(turnReference, turnRecord);
      transaction.update(participationReference, {
        status: 'active',
        updatedAt: serverTimestamp(),
      });
      transaction.update(queueReference, {
        status: 'active',
        updatedAt: serverTimestamp(),
      });
      transaction.set(privateSiteReference, privateState);
      transaction.set(publicSiteReference, nextPublicState);

      return { turnId: turnReference.id, targetContributionNumber };
    });
  } catch (error) {
    throw toAdminServiceError(error, 'The turn could not be started.');
  }
}

export interface RecordPullRequestInput {
  adminGithubUserId: string;
  prNumber: string | number;
  prUrl: string;
}

function assertCurrentPublicProjection(
  publicState: PublicSiteViewState | null,
  turn: TurnRecord & { status: 'active' | 'submitted' | 'under_review' },
): asserts publicState is PublicSiteViewState {
  if (!publicState || publicState.turnStatus !== turn.status
    || publicState.targetContributionNumber !== turn.targetContributionNumber
    || publicState.dueAtMillis !== turn.dueAt.toMillis()) {
    throw new AdminServiceError('The public current-turn state is inconsistent.');
  }
}

function assertActiveAdmin(exists: boolean, data: Record<string, unknown>, githubUserId: string) {
  if (!exists || !activeAdminRecordIsValid(data, githubUserId)) {
    throw new AdminServiceError('Access denied.');
  }
}

export async function recordPullRequestSubmission(input: RecordPullRequestInput): Promise<void> {
  let submission;
  try {
    submission = normalizePullRequestSubmission(input.prUrl, input.prNumber);
  } catch (error) {
    if (error instanceof PullRequestValidationError) throw new AdminServiceError(error.message);
    throw error;
  }
  const firestore = getPlatformFirestore();
  const adminReference = doc(firestore, adminDocumentPath(input.adminGithubUserId));
  const privateSiteReference = doc(firestore, PRIVATE_SITE_DOCUMENT_PATH);
  const publicSiteReference = doc(firestore, PUBLIC_SITE_DOCUMENT_PATH);
  try {
    await runTransaction(firestore, async (transaction) => {
      const [adminSnapshot, privateSiteSnapshot, publicSiteSnapshot] = await Promise.all([
        transaction.get(adminReference), transaction.get(privateSiteReference),
        transaction.get(publicSiteReference),
      ]);
      assertActiveAdmin(adminSnapshot.exists(), adminSnapshot.data() ?? {}, input.adminGithubUserId);
      const turnId = privateSiteSnapshot.data()?.activeTurnId;
      if (typeof turnId !== 'string' || !turnId) throw new AdminServiceError('There is no current turn.');
      const turnReference = doc(firestore, turnDocumentPath(turnId));
      const turnSnapshot = await transaction.get(turnReference);
      if (!turnSnapshot.exists()) throw new AdminServiceError('The current turn is missing.');
      const turn = parseCurrentTurn(turnId, turnSnapshot.data());
      if (turn.status !== 'active') throw new AdminServiceError('A pull request can only be recorded for an active turn.');
      const publicState = publicSiteSnapshot.exists() ? tryParsePublicSiteState(publicSiteSnapshot.data()) : null;
      assertCurrentPublicProjection(publicState, turn);
      transaction.update(turnReference, {
        status: 'submitted', prNumber: submission.prNumber, prUrl: submission.prUrl,
        submittedAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      transaction.update(publicSiteReference, { turnStatus: 'submitted', updatedAt: serverTimestamp() });
    });
  } catch (error) {
    throw toAdminServiceError(error, 'The pull request submission could not be recorded.');
  }
}

export async function markCurrentTurnUnderReview(adminGithubUserId: string): Promise<void> {
  const firestore = getPlatformFirestore();
  const adminReference = doc(firestore, adminDocumentPath(adminGithubUserId));
  const privateSiteReference = doc(firestore, PRIVATE_SITE_DOCUMENT_PATH);
  const publicSiteReference = doc(firestore, PUBLIC_SITE_DOCUMENT_PATH);
  try {
    await runTransaction(firestore, async (transaction) => {
      const [adminSnapshot, privateSiteSnapshot, publicSiteSnapshot] = await Promise.all([
        transaction.get(adminReference), transaction.get(privateSiteReference), transaction.get(publicSiteReference),
      ]);
      assertActiveAdmin(adminSnapshot.exists(), adminSnapshot.data() ?? {}, adminGithubUserId);
      const turnId = privateSiteSnapshot.data()?.activeTurnId;
      if (typeof turnId !== 'string' || !turnId) throw new AdminServiceError('There is no current turn.');
      const turnReference = doc(firestore, turnDocumentPath(turnId));
      const turnSnapshot = await transaction.get(turnReference);
      if (!turnSnapshot.exists()) throw new AdminServiceError('The current turn is missing.');
      const turn = parseCurrentTurn(turnId, turnSnapshot.data());
      if (turn.status !== 'submitted') throw new AdminServiceError('Only a submitted turn can be marked under review.');
      const publicState = publicSiteSnapshot.exists() ? tryParsePublicSiteState(publicSiteSnapshot.data()) : null;
      assertCurrentPublicProjection(publicState, turn);
      transaction.update(turnReference, { status: 'under_review', reviewStartedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      transaction.update(publicSiteReference, { turnStatus: 'under_review', updatedAt: serverTimestamp() });
    });
  } catch (error) {
    throw toAdminServiceError(error, 'The turn could not be marked under review.');
  }
}

async function endCurrentTurn(adminGithubUserId: string, nextStatus: Extract<TurnStatus, 'expired' | 'skipped'>) {
  const firestore = getPlatformFirestore();
  const adminReference = doc(firestore, adminDocumentPath(adminGithubUserId));
  const privateSiteReference = doc(firestore, PRIVATE_SITE_DOCUMENT_PATH);
  const publicSiteReference = doc(firestore, PUBLIC_SITE_DOCUMENT_PATH);
  try {
    await runTransaction(firestore, async (transaction) => {
      const [adminSnapshot, privateSiteSnapshot, publicSiteSnapshot] = await Promise.all([
        transaction.get(adminReference), transaction.get(privateSiteReference), transaction.get(publicSiteReference),
      ]);
      assertActiveAdmin(adminSnapshot.exists(), adminSnapshot.data() ?? {}, adminGithubUserId);
      const turnId = privateSiteSnapshot.data()?.activeTurnId;
      if (typeof turnId !== 'string' || !turnId) throw new AdminServiceError('There is no current turn.');
      const turnReference = doc(firestore, turnDocumentPath(turnId));
      const turnSnapshot = await transaction.get(turnReference);
      if (!turnSnapshot.exists()) throw new AdminServiceError('The current turn is missing.');
      const turn = parseCurrentTurn(turnId, turnSnapshot.data());
      if (nextStatus === 'expired' && !canExpireTurn(turn.status, turn.dueAt.toMillis(), Date.now())) {
        throw new AdminServiceError('An active turn can be expired only after its deadline.');
      }
      const participationReference = doc(firestore, participationDocumentPath(CURRENT_SEASON, turn.githubUserId));
      const queueReference = doc(firestore, queueDocumentPath(CURRENT_SEASON, turn.githubUserId));
      const [participationSnapshot, queueSnapshot] = await Promise.all([
        transaction.get(participationReference), transaction.get(queueReference),
      ]);
      if (!participationSnapshot.exists() || participationSnapshot.data().githubUserId !== turn.githubUserId
        || participationSnapshot.data().season !== CURRENT_SEASON || participationSnapshot.data().status !== 'active') {
        throw new AdminServiceError('The current participation state is inconsistent.');
      }
      if (!queueSnapshot.exists()) throw new AdminServiceError('The current queue entry is missing.');
      const queue = parseAdminQueueEntry(queueSnapshot.data(), turn.githubUserId);
      if (queue.status !== 'active') throw new AdminServiceError('The current queue state is inconsistent.');
      const publicState = publicSiteSnapshot.exists() ? tryParsePublicSiteState(publicSiteSnapshot.data()) : null;
      assertCurrentPublicProjection(publicState, turn);
      transaction.update(turnReference, { status: nextStatus, endedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      transaction.update(participationReference, { status: nextStatus, updatedAt: serverTimestamp() });
      transaction.update(queueReference, { status: nextStatus, updatedAt: serverTimestamp() });
      transaction.set(privateSiteReference, { activeTurnId: null, updatedAt: serverTimestamp() });
      transaction.set(publicSiteReference, {
        currentVersion: publicState.currentVersion, totalContributions: publicState.totalContributions,
        turnStatus: 'none', targetContributionNumber: null, currentContributor: null,
        dueAt: null, updatedAt: serverTimestamp(),
      } satisfies WithFieldValue<PublicSiteState>);
    });
  } catch (error) {
    throw toAdminServiceError(error, nextStatus === 'expired' ? 'The turn could not be expired.' : 'The turn could not be skipped.');
  }
}

export function expireCurrentTurn(adminGithubUserId: string): Promise<void> {
  return endCurrentTurn(adminGithubUserId, 'expired');
}

export function skipCurrentTurn(adminGithubUserId: string): Promise<void> {
  return endCurrentTurn(adminGithubUserId, 'skipped');
}
