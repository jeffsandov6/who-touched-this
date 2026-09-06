import { collection, doc, getDoc, getDocs, orderBy, query } from 'firebase/firestore';
import {
  parseHistoryEvent,
  parsePublicContribution,
  type PublicHistoryItem,
} from '../history';
import { getPlatformFirestore } from './firestore';
import { contributionDocumentPath, FIRESTORE_COLLECTIONS } from './paths';
import { parsePublicContributionSnapshot } from '../snapshots/public';

export async function loadPublicHistory(): Promise<PublicHistoryItem[]> {
  const firestore = getPlatformFirestore();
  const snapshot = await getDocs(query(
    collection(firestore, FIRESTORE_COLLECTIONS.historyEvents),
    orderBy('occurredAt', 'desc'),
  ));
  const snapshotDocuments = await getDocs(collection(firestore, FIRESTORE_COLLECTIONS.contributionSnapshots));
  const snapshots = new Map(snapshotDocuments.docs.flatMap((document) => {
    const parsed = parsePublicContributionSnapshot(document.data());
    return parsed ? [[parsed.contributionNumber, parsed] as const] : [];
  }));

  return Promise.all(snapshot.docs.map(async (eventDocument) => {
    const event = parseHistoryEvent(eventDocument.id, eventDocument.data());
    if (!event) throw new Error('Public history contains an unsupported event.');
    if (event.type !== 'contribution') return event;

    const contributionSnapshot = await getDoc(
      doc(firestore, contributionDocumentPath(event.contributionNumber)),
    );
    const contribution = contributionSnapshot.exists()
      ? parsePublicContribution(contributionSnapshot.data())
      : null;
    if (
      !contribution ||
      contribution.number !== event.contributionNumber ||
      contribution.displayName !== event.displayName ||
      contribution.githubUsername !== event.githubUsername ||
      contribution.mergedAt.getTime() !== event.occurredAt.getTime()
    ) throw new Error('A public contribution is missing or inconsistent.');

    return {
      ...event,
      summary: contribution.summary,
      ...(contribution.contributorMessage
        ? { contributorMessage: contribution.contributorMessage }
        : {}),
      prNumber: contribution.prNumber,
      prUrl: contribution.prUrl,
      ...(snapshots.get(event.contributionNumber)
        ? { snapshot: snapshots.get(event.contributionNumber) }
        : {}),
    };
  }));
}
