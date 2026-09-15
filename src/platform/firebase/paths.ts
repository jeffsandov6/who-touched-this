export const FIRESTORE_COLLECTIONS = {
  admins: 'admins',
  contributors: 'contributors',
  participation: 'participation',
  queue: 'queue',
  invitations: 'invitations',
  emailDeliveries: 'emailDeliveries',
  turns: 'turns',
  contributions: 'contributions',
  historyEvents: 'historyEvents',
  contributionSnapshots: 'contributionSnapshots',
  site: 'site',
} as const;

export const PUBLIC_SITE_DOCUMENT_ID = 'public' as const;
export const PRIVATE_SITE_DOCUMENT_ID = 'admin' as const;

function assertPathSegment(value: string, label: string): string {
  const normalized = value.trim();

  if (!normalized || normalized.includes('/')) {
    throw new Error(`${label} must be a non-empty Firestore path segment.`);
  }

  return normalized;
}

function assertContributionNumber(contributionNumber: number): number {
  if (!Number.isSafeInteger(contributionNumber) || contributionNumber < 0) {
    throw new Error('contribution number must be a non-negative safe integer.');
  }

  return contributionNumber;
}

function assertSeason(season: number): number {
  if (!Number.isSafeInteger(season) || season < 1) {
    throw new Error('season must be a positive safe integer.');
  }

  return season;
}

export function contributorDocumentId(githubUserId: string): string {
  return assertPathSegment(githubUserId, 'GitHub user id');
}

export function adminDocumentId(githubUserId: string): string {
  return contributorDocumentId(githubUserId);
}

export function participationDocumentId(season: number, githubUserId: string): string {
  return `${assertSeason(season)}_${contributorDocumentId(githubUserId)}`;
}

export function queueDocumentId(season: number, githubUserId: string): string {
  return participationDocumentId(season, githubUserId);
}

export function contributorDocumentPath(githubUserId: string): string {
  return `${FIRESTORE_COLLECTIONS.contributors}/${contributorDocumentId(githubUserId)}`;
}

export function adminDocumentPath(githubUserId: string): string {
  return `${FIRESTORE_COLLECTIONS.admins}/${adminDocumentId(githubUserId)}`;
}

export function participationDocumentPath(season: number, githubUserId: string): string {
  return `${FIRESTORE_COLLECTIONS.participation}/${participationDocumentId(season, githubUserId)}`;
}

export function queueDocumentPath(season: number, githubUserId: string): string {
  return `${FIRESTORE_COLLECTIONS.queue}/${queueDocumentId(season, githubUserId)}`;
}

export function turnDocumentPath(turnId: string): string {
  return `${FIRESTORE_COLLECTIONS.turns}/${assertPathSegment(turnId, 'turn id')}`;
}

export function invitationDocumentPath(invitationId: string): string {
  return `${FIRESTORE_COLLECTIONS.invitations}/${assertPathSegment(invitationId, 'invitation id')}`;
}

export function invitationEmailDeliveryId(invitationId: string): string {
  return `invitation_${assertPathSegment(invitationId, 'invitation id')}`;
}

export function emailDeliveryDocumentPath(deliveryId: string): string {
  return `${FIRESTORE_COLLECTIONS.emailDeliveries}/${assertPathSegment(deliveryId, 'delivery id')}`;
}

export function contributionDocumentPath(contributionNumber: number): string {
  return `${FIRESTORE_COLLECTIONS.contributions}/${assertContributionNumber(contributionNumber)}`;
}

export function contributionSnapshotDocumentPath(contributionNumber: number): string {
  return `${FIRESTORE_COLLECTIONS.contributionSnapshots}/${assertContributionNumber(contributionNumber)}`;
}

export function historyEventDocumentPath(turnId: string): string {
  return `${FIRESTORE_COLLECTIONS.historyEvents}/${assertPathSegment(turnId, 'history event id')}`;
}

export const PUBLIC_SITE_DOCUMENT_PATH =
  `${FIRESTORE_COLLECTIONS.site}/${PUBLIC_SITE_DOCUMENT_ID}` as const;
export const PRIVATE_SITE_DOCUMENT_PATH =
  `${FIRESTORE_COLLECTIONS.site}/${PRIVATE_SITE_DOCUMENT_ID}` as const;
