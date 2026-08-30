import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
  type DocumentReference,
} from 'firebase/firestore';
import { CURRENT_SEASON } from '../config/season';
import { AdminServiceError, toAdminServiceError } from './admin';
import { getPlatformFirestore } from './firestore';
import {
  QUEUE_STATUSES,
  type ContributorRecord,
  type QueueEntry,
  type QueueStatus,
} from './models';
import {
  contributorDocumentPath,
  FIRESTORE_COLLECTIONS,
  queueDocumentId,
  queueDocumentPath,
} from './paths';

export const MAX_QUEUE_PRIORITY = 2_147_483_647;

export interface AdminQueueItem {
  githubUserId: string;
  githubUsername: string;
  githubProfileUrl: string;
  displayName: string;
  email: string;
  socialUrl?: string;
  joinedAt: Date;
  joinedAtMillis: number;
  status: QueueStatus;
  priority: number;
  promotedAt: Date | null;
}

function isQueueStatus(value: unknown): value is QueueStatus {
  return typeof value === 'string' && (QUEUE_STATUSES as readonly string[]).includes(value);
}

function parseQueueEntry(data: Record<string, unknown>, expectedGithubUserId: string): QueueEntry {
  if (
    data.githubUserId !== expectedGithubUserId ||
    data.season !== CURRENT_SEASON ||
    !isQueueStatus(data.status) ||
    !(data.joinedAt instanceof Timestamp) ||
    !Number.isSafeInteger(data.priority) ||
    (data.priority as number) < 0 ||
    (data.priority as number) > MAX_QUEUE_PRIORITY ||
    (data.promotedAt !== undefined && !(data.promotedAt instanceof Timestamp))
  ) {
    throw new AdminServiceError('A queue entry contains unsupported data.');
  }

  return data as unknown as QueueEntry;
}

function parseContributor(
  data: Record<string, unknown>,
  expectedGithubUserId: string,
): Pick<
  ContributorRecord,
  'githubUserId' | 'githubUsername' | 'displayName' | 'email' | 'socialUrl'
> {
  let socialUrlIsSafe = true;
  if (typeof data.socialUrl === 'string') {
    try {
      const socialUrl = new URL(data.socialUrl);
      socialUrlIsSafe =
        (socialUrl.protocol === 'https:' || socialUrl.protocol === 'http:') &&
        Boolean(socialUrl.hostname) &&
        !socialUrl.username &&
        !socialUrl.password;
    } catch {
      socialUrlIsSafe = false;
    }
  }

  if (
    data.githubUserId !== expectedGithubUserId ||
    typeof data.githubUsername !== 'string' ||
    !/^[A-Za-z0-9-]{1,39}$/.test(data.githubUsername) ||
    typeof data.displayName !== 'string' ||
    !data.displayName.trim() ||
    typeof data.email !== 'string' ||
    !data.email.trim() ||
    (data.socialUrl !== undefined && typeof data.socialUrl !== 'string') ||
    !socialUrlIsSafe
  ) {
    throw new AdminServiceError('A contributor record contains unsupported data.');
  }

  return data as unknown as Pick<
    ContributorRecord,
    'githubUserId' | 'githubUsername' | 'displayName' | 'email' | 'socialUrl'
  >;
}

export async function loadSeasonOneAdminQueue(): Promise<AdminQueueItem[]> {
  try {
    const firestore = getPlatformFirestore();
    const queueSnapshot = await getDocs(
      query(
        collection(firestore, FIRESTORE_COLLECTIONS.queue),
        where('season', '==', CURRENT_SEASON),
      ),
    );

    return await Promise.all(
      queueSnapshot.docs.map(async (queueSnapshotDocument) => {
        const githubUserId = queueSnapshotDocument.data().githubUserId;
        if (
          typeof githubUserId !== 'string' ||
          queueSnapshotDocument.id !== queueDocumentId(CURRENT_SEASON, githubUserId)
        ) {
          throw new AdminServiceError('A queue entry has an invalid identity.');
        }

        const queueEntry = parseQueueEntry(queueSnapshotDocument.data(), githubUserId);
        const contributorSnapshot = await getDoc(
          doc(firestore, contributorDocumentPath(githubUserId)),
        );
        if (!contributorSnapshot.exists()) {
          throw new AdminServiceError('A queue entry is missing its contributor record.');
        }
        const contributor = parseContributor(contributorSnapshot.data(), githubUserId);

        return {
          githubUserId,
          githubUsername: contributor.githubUsername,
          githubProfileUrl: `https://github.com/${contributor.githubUsername}`,
          displayName: contributor.displayName,
          email: contributor.email,
          ...(contributor.socialUrl ? { socialUrl: contributor.socialUrl } : {}),
          joinedAt: queueEntry.joinedAt.toDate(),
          joinedAtMillis: queueEntry.joinedAt.toMillis(),
          status: queueEntry.status,
          priority: queueEntry.priority,
          promotedAt: queueEntry.promotedAt?.toDate() ?? null,
        };
      }),
    );
  } catch (error) {
    throw toAdminServiceError(error, 'The private queue could not be loaded.');
  }
}

export async function promoteWaitingQueueEntry(githubUserId: string): Promise<void> {
  try {
    const firestore = getPlatformFirestore();
    const waitingSnapshot = await getDocs(
      query(
        collection(firestore, FIRESTORE_COLLECTIONS.queue),
        where('season', '==', CURRENT_SEASON),
        where('status', '==', 'waiting'),
      ),
    );
    // Web Firestore transactions read document references rather than queries. Refresh the full
    // waiting set first, then read every returned reference inside the transaction so simultaneous
    // promotions of existing entries conflict and retry against the new maximum.
    const waitingReferences = waitingSnapshot.docs.map(
      (snapshot) => snapshot.ref as DocumentReference<Record<string, unknown>>,
    );
    const selectedDocumentId = queueDocumentId(CURRENT_SEASON, githubUserId);

    if (!waitingReferences.some((reference) => reference.id === selectedDocumentId)) {
      throw new AdminServiceError('Only an existing waiting queue entry can be promoted.');
    }

    await runTransaction(firestore, async (transaction) => {
      const snapshots = await Promise.all(
        waitingReferences.map((reference) => transaction.get(reference)),
      );
      let selectedReference: DocumentReference<Record<string, unknown>> | null = null;
      let highestPriority = 0;

      for (const snapshot of snapshots) {
        if (!snapshot.exists()) continue;
        const entryGithubUserId = snapshot.data().githubUserId;
        if (typeof entryGithubUserId !== 'string') {
          throw new AdminServiceError('A queue entry has an invalid identity.');
        }
        const entry = parseQueueEntry(snapshot.data(), entryGithubUserId);
        if (entry.status !== 'waiting') continue;

        highestPriority = Math.max(highestPriority, entry.priority);
        if (snapshot.id === selectedDocumentId) selectedReference = snapshot.ref;
      }

      if (!selectedReference) {
        throw new AdminServiceError('Only an existing waiting queue entry can be promoted.');
      }
      if (highestPriority >= MAX_QUEUE_PRIORITY) {
        throw new AdminServiceError('Queue priority has reached its supported limit.');
      }

      transaction.update(selectedReference, {
        priority: highestPriority + 1,
        promotedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    throw toAdminServiceError(error, 'The queue entry could not be promoted.');
  }
}

export async function restoreWaitingQueueEntry(githubUserId: string): Promise<void> {
  try {
    const firestore = getPlatformFirestore();
    const queueReference = doc(
      firestore,
      queueDocumentPath(CURRENT_SEASON, githubUserId),
    );

    await runTransaction(firestore, async (transaction) => {
      const snapshot = await transaction.get(queueReference);
      if (!snapshot.exists()) {
        throw new AdminServiceError('The queue entry no longer exists.');
      }
      const entry = parseQueueEntry(snapshot.data(), githubUserId);
      if (entry.status !== 'waiting') {
        throw new AdminServiceError('Only a waiting queue entry can be restored.');
      }

      transaction.update(queueReference, {
        priority: 0,
        promotedAt: deleteField(),
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    throw toAdminServiceError(error, 'Natural queue order could not be restored.');
  }
}
