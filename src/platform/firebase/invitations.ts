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
  calculateTurnDueAtMillis,
  canExpireInvitation,
  InvitationValidationError,
  validateInvitationDeadline,
  validateTurnDurationHours,
} from '../invitation';
import { calculateTargetContributionNumber, tryParsePublicSiteState } from '../turn-state';
import { AdminServiceError, toAdminServiceError } from './admin';
import {
  loadSeasonOneAdminQueue,
  parseAdminContributor,
  parseAdminQueueEntry,
} from './admin-queue';
import { getEffectiveWaitingQueue } from './admin-queue-logic';
import { getPlatformFirestore } from './firestore';
import {
  getAdminInvitationEmailDelivery,
  type AdminEmailDeliveryState,
} from './email-deliveries';
import type {
  InvitationRecord,
  PrivateSiteState,
  PublicSiteState,
  TurnRecord,
} from './models';
import {
  adminDocumentPath,
  contributorDocumentPath,
  FIRESTORE_COLLECTIONS,
  invitationDocumentPath,
  participationDocumentPath,
  PRIVATE_SITE_DOCUMENT_PATH,
  PUBLIC_SITE_DOCUMENT_PATH,
  queueDocumentPath,
} from './paths';

export class InvitationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvitationError';
  }
}

export interface AdminPendingInvitation {
  invitationId: string;
  githubUserId: string;
  githubUsername: string;
  githubProfileUrl: string;
  displayName: string;
  email: string;
  status: 'pending';
  invitedAt: Date;
  acceptBy: Date;
  turnDurationHours: number;
  emailDelivery: AdminEmailDeliveryState | null;
}

export interface OwnPendingInvitation {
  invitationId: string;
  githubUserId: string;
  status: 'pending';
  invitedAt: Date;
  acceptBy: Date;
  turnDurationHours: number;
}

interface InviteContributorInput {
  adminGithubUserId: string;
  selectedGithubUserId: string;
  acceptBy: Date;
  turnDurationHours: number;
}

function activeAdminRecordIsValid(data: Record<string, unknown>, githubUserId: string): boolean {
  return data.githubUserId === githubUserId && data.active === true
    && (data.role === 'owner' || data.role === 'admin');
}

function parsePendingInvitation(
  invitationId: string,
  data: Record<string, unknown>,
  expectedGithubUserId?: string,
): InvitationRecord & { status: 'pending' } {
  if (
    !invitationId ||
    typeof data.githubUserId !== 'string' ||
    (expectedGithubUserId !== undefined && data.githubUserId !== expectedGithubUserId) ||
    data.season !== CURRENT_SEASON ||
    data.status !== 'pending' ||
    !(data.invitedAt instanceof Timestamp) ||
    !(data.acceptBy instanceof Timestamp) ||
    !(data.createdAt instanceof Timestamp) ||
    !(data.updatedAt instanceof Timestamp) ||
    !Number.isSafeInteger(data.turnDurationHours)
  ) throw new InvitationError('The pending invitation contains unsupported data.');
  validateTurnDurationHours(data.turnDurationHours as number);
  return data as unknown as InvitationRecord & { status: 'pending' };
}

function parsePrivateSiteState(data: Record<string, unknown> | undefined): PrivateSiteState | null {
  if (!data) return null;
  if (
    !('activeTurnId' in data) ||
    !('pendingInvitationId' in data) ||
    (data.activeTurnId !== null && (typeof data.activeTurnId !== 'string' || !data.activeTurnId)) ||
    (data.pendingInvitationId !== null
      && (typeof data.pendingInvitationId !== 'string' || !data.pendingInvitationId)) ||
    !(data.updatedAt instanceof Timestamp)
  ) throw new InvitationError('Private site state is malformed.');
  return data as unknown as PrivateSiteState;
}

export async function inviteNextContributor(input: InviteContributorInput): Promise<string> {
  try {
    validateInvitationDeadline(input.acceptBy);
    validateTurnDurationHours(input.turnDurationHours);
  } catch (error) {
    if (error instanceof InvitationValidationError) throw new AdminServiceError(error.message);
    throw error;
  }

  const firstWaiting = getEffectiveWaitingQueue(await loadSeasonOneAdminQueue())[0];
  if (!firstWaiting || firstWaiting.githubUserId !== input.selectedGithubUserId) {
    throw new AdminServiceError('Only the effective first waiting contributor can be invited.');
  }

  const firestore = getPlatformFirestore();
  const invitationReference = doc(collection(firestore, FIRESTORE_COLLECTIONS.invitations));
  const adminReference = doc(firestore, adminDocumentPath(input.adminGithubUserId));
  const contributorReference = doc(firestore, contributorDocumentPath(input.selectedGithubUserId));
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
    await runTransaction(firestore, async (transaction) => {
      const [admin, contributor, participation, queue, privateSite, publicSite, invitation] =
        await Promise.all([
          transaction.get(adminReference),
          transaction.get(contributorReference),
          transaction.get(participationReference),
          transaction.get(queueReference),
          transaction.get(privateSiteReference),
          transaction.get(publicSiteReference),
          transaction.get(invitationReference),
        ]);
      if (!admin.exists() || !activeAdminRecordIsValid(admin.data(), input.adminGithubUserId)) {
        throw new AdminServiceError('Access denied.');
      }
      if (!contributor.exists()) throw new AdminServiceError('The contributor is missing.');
      parseAdminContributor(contributor.data(), input.selectedGithubUserId);
      if (
        !participation.exists() ||
        participation.data().githubUserId !== input.selectedGithubUserId ||
        participation.data().season !== CURRENT_SEASON ||
        participation.data().status !== 'waiting' ||
        'invitationId' in participation.data()
      ) throw new AdminServiceError('The participation record is not waiting.');
      if (!queue.exists()) throw new AdminServiceError('The queue entry is missing.');
      const queueEntry = parseAdminQueueEntry(queue.data(), input.selectedGithubUserId);
      if (queueEntry.status !== 'waiting') throw new AdminServiceError('The queue entry is not waiting.');
      const privateState = parsePrivateSiteState(privateSite.data());
      if (privateState?.activeTurnId || privateState?.pendingInvitationId) {
        throw new AdminServiceError('Another turn or invitation is already current.');
      }
      const publicState = publicSite.exists() ? tryParsePublicSiteState(publicSite.data()) : null;
      if (publicState && publicState.turnStatus !== 'none') {
        throw new AdminServiceError('A public turn is already current.');
      }
      if (invitation.exists()) throw new AdminServiceError('The generated invitation ID is in use.');

      transaction.set(invitationReference, {
        githubUserId: input.selectedGithubUserId,
        season: CURRENT_SEASON,
        status: 'pending',
        invitedAt: serverTimestamp(),
        acceptBy: Timestamp.fromDate(input.acceptBy),
        turnDurationHours: input.turnDurationHours,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      } satisfies WithFieldValue<InvitationRecord>);
      transaction.update(participationReference, {
        status: 'invited',
        invitationId: invitationReference.id,
        updatedAt: serverTimestamp(),
      });
      transaction.update(queueReference, { status: 'invited', updatedAt: serverTimestamp() });
      transaction.set(privateSiteReference, {
        activeTurnId: null,
        pendingInvitationId: invitationReference.id,
        updatedAt: serverTimestamp(),
      } satisfies WithFieldValue<PrivateSiteState>);
    });
    return invitationReference.id;
  } catch (error) {
    throw toAdminServiceError(error, 'The contributor could not be invited.');
  }
}

export async function loadAdminPendingInvitation(): Promise<AdminPendingInvitation | null> {
  try {
    const firestore = getPlatformFirestore();
    const privateSite = await getDoc(doc(firestore, PRIVATE_SITE_DOCUMENT_PATH));
    if (!privateSite.exists()) return null;
    const state = parsePrivateSiteState(privateSite.data());
    if (!state?.pendingInvitationId) return null;
    const invitationSnapshot = await getDoc(
      doc(firestore, invitationDocumentPath(state.pendingInvitationId)),
    );
    if (!invitationSnapshot.exists()) throw new InvitationError('The pending invitation is missing.');
    const invitation = parsePendingInvitation(state.pendingInvitationId, invitationSnapshot.data());
    const [contributorSnapshot, emailDelivery] = await Promise.all([
      getDoc(doc(firestore, contributorDocumentPath(invitation.githubUserId))),
      getAdminInvitationEmailDelivery(state.pendingInvitationId),
    ]);
    if (!contributorSnapshot.exists()) throw new InvitationError('The invited contributor is missing.');
    const contributor = parseAdminContributor(contributorSnapshot.data(), invitation.githubUserId);
    return {
      invitationId: state.pendingInvitationId,
      githubUserId: invitation.githubUserId,
      githubUsername: contributor.githubUsername,
      githubProfileUrl: `https://github.com/${contributor.githubUsername}`,
      displayName: contributor.displayName,
      email: contributor.email,
      status: 'pending',
      invitedAt: invitation.invitedAt.toDate(),
      acceptBy: invitation.acceptBy.toDate(),
      turnDurationHours: invitation.turnDurationHours,
      emailDelivery,
    };
  } catch (error) {
    throw toAdminServiceError(error, 'The pending invitation could not be loaded.');
  }
}

export async function getOwnPendingInvitation(
  githubUserId: string,
  invitationId: string,
): Promise<OwnPendingInvitation> {
  try {
    const snapshot = await getDoc(
      doc(getPlatformFirestore(), invitationDocumentPath(invitationId)),
    );
    if (!snapshot.exists()) throw new InvitationError('Your invitation is unavailable.');
    const invitation = parsePendingInvitation(invitationId, snapshot.data(), githubUserId);
    return {
      invitationId,
      githubUserId,
      status: 'pending',
      invitedAt: invitation.invitedAt.toDate(),
      acceptBy: invitation.acceptBy.toDate(),
      turnDurationHours: invitation.turnDurationHours,
    };
  } catch (error) {
    if (error instanceof InvitationError) throw error;
    throw new InvitationError('Your invitation could not be loaded.');
  }
}

export async function acceptInvitation(
  githubUserId: string,
  invitationId: string,
): Promise<string> {
  const firestore = getPlatformFirestore();
  const invitationReference = doc(firestore, invitationDocumentPath(invitationId));
  const contributorReference = doc(firestore, contributorDocumentPath(githubUserId));
  const participationReference = doc(
    firestore,
    participationDocumentPath(CURRENT_SEASON, githubUserId),
  );
  const queueReference = doc(firestore, queueDocumentPath(CURRENT_SEASON, githubUserId));
  const privateSiteReference = doc(firestore, PRIVATE_SITE_DOCUMENT_PATH);
  const publicSiteReference = doc(firestore, PUBLIC_SITE_DOCUMENT_PATH);
  const turnReference = doc(collection(firestore, FIRESTORE_COLLECTIONS.turns));

  try {
    return await runTransaction(firestore, async (transaction) => {
      const [invitationSnapshot, contributorSnapshot, participationSnapshot, publicSiteSnapshot] =
        await Promise.all([
        transaction.get(invitationReference), transaction.get(contributorReference),
        transaction.get(participationReference), transaction.get(publicSiteReference),
      ]);
      if (!invitationSnapshot.exists()) throw new InvitationError('Your invitation is unavailable.');
      const invitation = parsePendingInvitation(invitationId, invitationSnapshot.data(), githubUserId);
      if (Date.now() > invitation.acceptBy.toMillis()) {
        throw new InvitationError('This invitation has passed its acceptance deadline.');
      }
      if (!contributorSnapshot.exists()) throw new InvitationError('Your contributor record is missing.');
      const contributor = parseAdminContributor(contributorSnapshot.data(), githubUserId);
      if (
        !participationSnapshot.exists() || participationSnapshot.data().githubUserId !== githubUserId ||
        participationSnapshot.data().season !== CURRENT_SEASON ||
        participationSnapshot.data().status !== 'invited' ||
        participationSnapshot.data().invitationId !== invitationId
      ) throw new InvitationError('Your participation state is inconsistent.');
      const publicState = publicSiteSnapshot.exists()
        ? tryParsePublicSiteState(publicSiteSnapshot.data())
        : {
            currentVersion: 0, totalContributions: 0, turnStatus: 'none' as const,
            targetContributionNumber: null, currentContributor: null, dueAtMillis: null,
          };
      if (!publicState || publicState.turnStatus !== 'none') {
        throw new InvitationError('Another turn is already active.');
      }
      const targetContributionNumber = calculateTargetContributionNumber(publicState.currentVersion);
      const dueAt = Timestamp.fromMillis(calculateTurnDueAtMillis(
        Date.now(), invitation.turnDurationHours,
      ));
      transaction.set(turnReference, {
        githubUserId, season: CURRENT_SEASON, status: 'active', targetContributionNumber,
        startedAt: serverTimestamp(), dueAt, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      } satisfies WithFieldValue<TurnRecord>);
      transaction.update(invitationReference, {
        status: 'accepted', acceptedAt: serverTimestamp(), turnId: turnReference.id,
        updatedAt: serverTimestamp(),
      });
      transaction.update(participationReference, { status: 'active', updatedAt: serverTimestamp() });
      transaction.update(queueReference, { status: 'active', updatedAt: serverTimestamp() });
      transaction.set(privateSiteReference, {
        activeTurnId: turnReference.id, pendingInvitationId: null, updatedAt: serverTimestamp(),
      } satisfies WithFieldValue<PrivateSiteState>);
      transaction.set(publicSiteReference, {
        currentVersion: publicState.currentVersion,
        totalContributions: publicState.totalContributions,
        turnStatus: 'active', targetContributionNumber,
        currentContributor: {
          githubUsername: contributor.githubUsername, displayName: contributor.displayName,
        },
        dueAt, updatedAt: serverTimestamp(),
      } satisfies WithFieldValue<PublicSiteState>);
      return turnReference.id;
    });
  } catch (error) {
    if (error instanceof InvitationError) throw error;
    throw new InvitationError('The invitation could not be accepted.');
  }
}

export async function expirePendingInvitation(adminGithubUserId: string): Promise<void> {
  const firestore = getPlatformFirestore();
  const adminReference = doc(firestore, adminDocumentPath(adminGithubUserId));
  const privateSiteReference = doc(firestore, PRIVATE_SITE_DOCUMENT_PATH);
  try {
    await runTransaction(firestore, async (transaction) => {
      const [adminSnapshot, privateSiteSnapshot] = await Promise.all([
        transaction.get(adminReference), transaction.get(privateSiteReference),
      ]);
      if (!adminSnapshot.exists() || !activeAdminRecordIsValid(adminSnapshot.data(), adminGithubUserId)) {
        throw new AdminServiceError('Access denied.');
      }
      const state = parsePrivateSiteState(privateSiteSnapshot.data());
      if (!state?.pendingInvitationId || state.activeTurnId !== null) {
        throw new AdminServiceError('There is no pending invitation.');
      }
      const invitationReference = doc(
        firestore,
        invitationDocumentPath(state.pendingInvitationId),
      );
      const invitationSnapshot = await transaction.get(invitationReference);
      if (!invitationSnapshot.exists()) throw new AdminServiceError('The invitation is missing.');
      const invitation = parsePendingInvitation(state.pendingInvitationId, invitationSnapshot.data());
      if (!canExpireInvitation('pending', invitation.acceptBy.toMillis(), Date.now())) {
        throw new AdminServiceError('The invitation cannot expire before its deadline.');
      }
      const participationReference = doc(
        firestore,
        participationDocumentPath(CURRENT_SEASON, invitation.githubUserId),
      );
      const queueReference = doc(
        firestore,
        queueDocumentPath(CURRENT_SEASON, invitation.githubUserId),
      );
      const [participationSnapshot, queueSnapshot] = await Promise.all([
        transaction.get(participationReference), transaction.get(queueReference),
      ]);
      if (
        !participationSnapshot.exists() || participationSnapshot.data().status !== 'invited' ||
        participationSnapshot.data().invitationId !== state.pendingInvitationId ||
        !queueSnapshot.exists() || queueSnapshot.data().status !== 'invited'
      ) throw new AdminServiceError('Invitation state is inconsistent.');

      transaction.update(invitationReference, {
        status: 'expired', expiredAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      transaction.update(participationReference, {
        status: 'invitation_expired', updatedAt: serverTimestamp(),
      });
      transaction.update(queueReference, {
        status: 'invitation_expired', updatedAt: serverTimestamp(),
      });
      transaction.set(privateSiteReference, {
        activeTurnId: null, pendingInvitationId: null, updatedAt: serverTimestamp(),
      } satisfies WithFieldValue<PrivateSiteState>);
    });
  } catch (error) {
    throw toAdminServiceError(error, 'The invitation could not be expired.');
  }
}
