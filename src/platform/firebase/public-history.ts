import { collection, doc, getDoc, getDocs, orderBy, query } from 'firebase/firestore';
import {
  parseHistoryEvent,
  parsePublicContribution,
  type PublicHistoryItem,
} from '../history';
import { getPlatformFirestore } from './firestore';
import {
  contributionDocumentPath,
  contributionSnapshotDocumentPath,
  FIRESTORE_COLLECTIONS,
} from './paths';
import { parsePublicContributionSnapshot } from '../snapshots/public';
import { buildPublicContributionDetail, type PublicContributionDetail } from '../history-detail';

export async function loadPublicContributionDetail(
  contributionNumber: number,
): Promise<PublicContributionDetail | null> {
  if (!Number.isSafeInteger(contributionNumber) || contributionNumber < 0) return null;
  const firestore = getPlatformFirestore();
  const [contributionDocument, snapshotDocument] = await Promise.all([
    getDoc(doc(firestore, contributionDocumentPath(contributionNumber))),
    getDoc(doc(firestore, contributionSnapshotDocumentPath(contributionNumber))),
  ]);
  if (!contributionDocument.exists()) return null;
  return buildPublicContributionDetail(
    contributionNumber,
    contributionDocument.data(),
    snapshotDocument.exists() ? snapshotDocument.data() : undefined,
  );
}

export async function loadPublicHistory(): Promise<PublicHistoryItem[]> {
  const firestore = getPlatformFirestore();
  const snapshot = await getDocs(query(
    collection(firestore, FIRESTORE_COLLECTIONS.historyEvents),
    orderBy('occurredAt', 'desc'),
  ));
  const [snapshotDocuments, contributionDocuments] = await Promise.all([
    getDocs(collection(firestore, FIRESTORE_COLLECTIONS.contributionSnapshots)),
    getDocs(collection(firestore, FIRESTORE_COLLECTIONS.contributions)),
  ]);
  const snapshots = new Map(snapshotDocuments.docs.flatMap((document) => {
    const parsed = parsePublicContributionSnapshot(document.data());
    return parsed ? [[parsed.contributionNumber, parsed] as const] : [];
  }));
  const contributions = new Map(contributionDocuments.docs.flatMap((document) => {
    const parsed = parsePublicContribution(document.data());
    return parsed ? [[parsed.number, parsed] as const] : [];
  }));

  return snapshot.docs.map((eventDocument) => {
    const event = parseHistoryEvent(eventDocument.id, eventDocument.data());
    if (!event) throw new Error('public history contains an unsupported event.');
    if (event.type !== 'contribution') return event;

    const contribution = contributions.get(event.contributionNumber) ?? null;
    if (
      !contribution ||
      contribution.number !== event.contributionNumber ||
      contribution.displayName !== event.displayName ||
      contribution.githubUsername !== event.githubUsername ||
      contribution.contributionKind !== event.contributionKind ||
      contribution.mergedAt.getTime() !== event.occurredAt.getTime()
    ) throw new Error('a public contribution is missing or inconsistent.');

    const snapshotRecord = snapshots.get(event.contributionNumber);
    const snapshot = snapshotRecord
      && (!contribution.beforeGitSha || (snapshotRecord.beforeGitSha === contribution.beforeGitSha
        && snapshotRecord.afterGitSha === contribution.afterGitSha))
      ? snapshotRecord
      : null;
    return {
      ...event,
      ...(contribution.githubUserId ? { githubUserId: contribution.githubUserId } : {}),
      summary: contribution.summary,
      ...(contribution.contributorMessage
        ? { contributorMessage: contribution.contributorMessage }
        : {}),
      ...(contribution.socialUrl ? { socialUrl: contribution.socialUrl } : {}),
      prNumber: contribution.prNumber,
      prUrl: contribution.prUrl,
      ...(contribution.beforeGitSha && contribution.afterGitSha
        ? { beforeGitSha: contribution.beforeGitSha, afterGitSha: contribution.afterGitSha }
        : {}),
      ...(contribution.archiveStatus ? { archiveStatus: contribution.archiveStatus } : {}),
      ...(snapshot ? { snapshot } : {}),
    };
  });
}
