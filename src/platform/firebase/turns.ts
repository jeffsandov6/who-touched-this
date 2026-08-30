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
  tryParsePublicSiteState,
} from '../turn-state';
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
  status: 'active';
  targetContributionNumber: number;
  startedAt: Date;
  dueAt: Date;
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

function parseActiveTurn(
  turnId: string,
  data: Record<string, unknown>,
): TurnRecord & { status: 'active' } {
  if (
    !turnId ||
    typeof data.githubUserId !== 'string' ||
    data.season !== CURRENT_SEASON ||
    data.status !== 'active' ||
    !Number.isSafeInteger(data.targetContributionNumber) ||
    (data.targetContributionNumber as number) < 1 ||
    !(data.startedAt instanceof Timestamp) ||
    !(data.dueAt instanceof Timestamp) ||
    !(data.createdAt instanceof Timestamp) ||
    !(data.updatedAt instanceof Timestamp)
  ) {
    throw new AdminServiceError('The active turn contains unsupported data.');
  }
  return data as unknown as TurnRecord & { status: 'active' };
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
    const turn = parseActiveTurn(activeTurnId, turnSnapshot.data());
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
      status: 'active',
      targetContributionNumber: turn.targetContributionNumber,
      startedAt: turn.startedAt.toDate(),
      dueAt: turn.dueAt.toDate(),
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
