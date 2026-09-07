import { FirebaseError } from 'firebase/app';
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  type WithFieldValue,
} from 'firebase/firestore';
import { CURRENT_SEASON } from '../config/season';
import type { GitHubIdentity } from './auth';
import { getPlatformFirestore } from './firestore';
import {
  PARTICIPATION_STATUSES,
  type ContributorRecord,
  type ParticipationRecord,
  type ParticipationStatus,
  type QueueEntry,
} from './models';
import {
  contributorDocumentPath,
  participationDocumentPath,
  queueDocumentPath,
} from './paths';
import {
  JoinError,
  validateJoinForm,
  type JoinFormValues,
} from './join-validation';

export { JoinError, validateJoinForm } from './join-validation';
export type { JoinFormValues, ValidatedJoinFormValues } from './join-validation';

export type JoinResult =
  | { kind: 'joined'; status: 'waiting' }
  | { kind: 'existing'; status: ParticipationStatus };

export interface OwnParticipationState {
  status: ParticipationStatus;
  invitationId: string | null;
}

function isParticipationStatus(value: unknown): value is ParticipationStatus {
  return (
    typeof value === 'string' &&
    (PARTICIPATION_STATUSES as readonly string[]).includes(value)
  );
}

export async function getOwnParticipationStatus(
  githubUserId: string,
): Promise<ParticipationStatus | null> {
  return (await getOwnParticipationState(githubUserId))?.status ?? null;
}

export async function getOwnParticipationState(
  githubUserId: string,
): Promise<OwnParticipationState | null> {
  try {
    const firestore = getPlatformFirestore();
    const snapshot = await getDoc(
      doc(firestore, participationDocumentPath(CURRENT_SEASON, githubUserId)),
    );

    if (!snapshot.exists()) return null;

    const status = snapshot.data().status;
    if (!isParticipationStatus(status)) {
      throw new JoinError('your participation record has an unsupported status.');
    }

    const invitationId = snapshot.data().invitationId;
    if (
      (status === 'invited' && (typeof invitationId !== 'string' || !invitationId)) ||
      (invitationId !== undefined && (typeof invitationId !== 'string' || !invitationId))
    ) throw new JoinError('your participation record has unsupported invitation data.');

    return { status, invitationId: typeof invitationId === 'string' ? invitationId : null };
  } catch (error) {
    if (error instanceof JoinError) throw error;
    throw toJoinError(error, 'your participation status could not be loaded.');
  }
}

export async function joinCurrentSeason(
  identity: GitHubIdentity,
  values: JoinFormValues,
): Promise<JoinResult> {
  if (!identity.githubUsername) {
    throw new JoinError('your verified GitHub username is unavailable. authenticate again to join.');
  }

  const githubUsername = identity.githubUsername;
  const validatedValues = validateJoinForm(values);
  const firestore = getPlatformFirestore();
  const contributorRef = doc(firestore, contributorDocumentPath(identity.githubUserId));
  const participationRef = doc(
    firestore,
    participationDocumentPath(CURRENT_SEASON, identity.githubUserId),
  );
  const queueRef = doc(firestore, queueDocumentPath(CURRENT_SEASON, identity.githubUserId));

  try {
    return await runTransaction(firestore, async (transaction): Promise<JoinResult> => {
      const participationSnapshot = await transaction.get(participationRef);

      if (participationSnapshot.exists()) {
        const existingStatus = participationSnapshot.data().status;
        if (!isParticipationStatus(existingStatus)) {
          throw new JoinError('your participation record has an unsupported status.');
        }
        return { kind: 'existing', status: existingStatus };
      }

      const contributorRecord = {
        firebaseUid: identity.firebaseUid,
        githubUserId: identity.githubUserId,
        githubUsername,
        displayName: validatedValues.displayName,
        email: validatedValues.email,
        ...(validatedValues.socialUrl ? { socialUrl: validatedValues.socialUrl } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      } satisfies WithFieldValue<ContributorRecord>;

      const participationRecord = {
        githubUserId: identity.githubUserId,
        season: CURRENT_SEASON,
        status: 'waiting',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      } satisfies WithFieldValue<ParticipationRecord>;

      const queueEntry = {
        githubUserId: identity.githubUserId,
        season: CURRENT_SEASON,
        status: 'waiting',
        joinedAt: serverTimestamp(),
        priority: 0,
        updatedAt: serverTimestamp(),
      } satisfies WithFieldValue<QueueEntry>;

      transaction.set(contributorRef, contributorRecord);
      transaction.set(participationRef, participationRecord);
      transaction.set(queueRef, queueEntry);

      return { kind: 'joined', status: 'waiting' };
    });
  } catch (error) {
    if (error instanceof JoinError) throw error;
    throw toJoinError(error, 'the queue could not be joined. please try again.');
  }
}

function toJoinError(error: unknown, fallback: string): JoinError {
  if (error instanceof FirebaseError) {
    const messages: Record<string, string> = {
      'firestore/permission-denied':
        'Firebase rejected this join request. sign out, authenticate with GitHub, & try again.',
      'firestore/unavailable': 'Firebase is temporarily unavailable. please try again shortly.',
      'firestore/aborted': 'the join request conflicted with another update. please try again.',
      'firestore/deadline-exceeded': 'the join request timed out. please try again.',
    };
    return new JoinError(messages[error.code] ?? fallback);
  }

  return new JoinError(fallback);
}
