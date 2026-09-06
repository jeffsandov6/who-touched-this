import type { Timestamp } from 'firebase/firestore';

export const ADMIN_ROLES = ['owner', 'admin'] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

/** Private trusted configuration: admins/{githubUserId}. Never client-writable. */
export interface AdminRecord {
  githubUserId: string;
  role: AdminRole;
  active: boolean;
  createdAt?: Timestamp;
}

export const PARTICIPATION_STATUSES = [
  'waiting',
  'invited',
  'active',
  'completed',
  'expired',
  'invitation_expired',
  'withdrawn',
  'skipped',
] as const;

export type ParticipationStatus = (typeof PARTICIPATION_STATUSES)[number];

export const QUEUE_STATUSES = [
  'waiting',
  'invited',
  'active',
  'completed',
  'expired',
  'invitation_expired',
  'withdrawn',
  'skipped',
] as const;

export type QueueStatus = (typeof QUEUE_STATUSES)[number];

export const INVITATION_STATUSES = ['pending', 'accepted', 'expired'] as const;

export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const EMAIL_DELIVERY_STATUSES = ['sending', 'sent', 'failed'] as const;

export type EmailDeliveryStatus = (typeof EMAIL_DELIVERY_STATUSES)[number];

export const TURN_STATUSES = [
  'active',
  'submitted',
  'under_review',
  'merged',
  'expired',
  'skipped',
] as const;

export type TurnStatus = (typeof TURN_STATUSES)[number];

export const PUBLIC_TURN_STATUSES = [
  'none',
  'active',
  'submitted',
  'under_review',
] as const;

export type PublicTurnStatus = (typeof PUBLIC_TURN_STATUSES)[number];

/** Private: contributors/{githubUserId} */
export interface ContributorRecord {
  firebaseUid: string;
  githubUserId: string;
  githubUsername: string;
  /** Required, trimmed public presentation name; never inferred from authentication profile data. */
  displayName: string;
  email: string;
  /** Optional normalized HTTP(S) URL without embedded credentials. */
  socialUrl?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Private: participation/{season}_{githubUserId} */
export interface ParticipationRecord {
  githubUserId: string;
  season: number;
  status: ParticipationStatus;
  contributionNumber?: number;
  invitationId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Private: queue/{season}_{githubUserId} */
export interface QueueEntry {
  githubUserId: string;
  season: number;
  status: QueueStatus;
  joinedAt: Timestamp;
  /** V1 ordering uses priority descending, then joinedAt ascending. */
  priority: number;
  /** Reserved for future arbitrary ordering; ignored by the V1 ordering algorithm. */
  sortOrder?: number;
  promotedAt?: Timestamp;
  contributionNumber?: number;
  updatedAt: Timestamp;
}

/** Private: turns/{turnId} */
export interface TurnRecord {
  githubUserId: string;
  season: number;
  status: TurnStatus;
  /** Proposed next contribution number. It is not consumed until a later accepted merge. */
  targetContributionNumber: number;
  startedAt: Timestamp;
  dueAt: Timestamp;
  submittedAt?: Timestamp;
  reviewStartedAt?: Timestamp;
  mergedAt?: Timestamp;
  endedAt?: Timestamp;
  prNumber?: number;
  prUrl?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Private: invitations/{invitationId}. A pending invitation is not a turn. */
export interface InvitationRecord {
  githubUserId: string;
  season: number;
  status: InvitationStatus;
  invitedAt: Timestamp;
  acceptBy: Timestamp;
  turnDurationHours: number;
  acceptedAt?: Timestamp;
  expiredAt?: Timestamp;
  turnId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Public-safe snapshot: contributions/{contributionNumber}. Never add private contact data. */
export interface PublicContributionRecord {
  number: number;
  season: number;
  contributionKind?: 'community' | 'founder_seed';
  githubUsername: string;
  displayName: string;
  summary: string;
  contributorMessage?: string;
  prNumber: number;
  prUrl: string;
  beforeGitSha?: string;
  afterGitSha?: string;
  mergedAt: Timestamp;
  createdAt: Timestamp;
}

/** Public-safe immutable visual archive. Written only by trusted Functions. */
export interface PublicContributionSnapshotRecord {
  schemaVersion: 1;
  contributionNumber: number;
  captureId: string;
  beforeGitSha: string;
  afterGitSha: string;
  canonicalRoutes: string[];
  additionalRoutes: string[];
  capturedRoutes: string[];
  routes: Array<{
    route: string;
    routeKey: string;
    before: { storagePath: string; sha256: string };
    after: { storagePath: string; sha256: string };
  }>;
  manifestStoragePath: string;
  viewport: { width: number; height: number; deviceScaleFactor: number; fullPage: boolean };
  archivedAt: Timestamp;
}

export const HISTORY_EVENT_TYPES = [
  'contribution',
  'turn_expired',
  'turn_skipped',
] as const;

export type HistoryEventType = (typeof HISTORY_EVENT_TYPES)[number];

/** Public-safe chronology item: historyEvents/{turnId}. */
export interface PublicHistoryEvent {
  type: HistoryEventType;
  contributionKind?: 'community' | 'founder_seed';
  season: number;
  displayName: string;
  githubUsername: string;
  targetContributionNumber: number;
  contributionNumber?: number;
  occurredAt: Timestamp;
}

export interface PublicCurrentContributor {
  githubUsername: string;
  displayName: string;
}

/** Public projection: site/public. Never add queue, contact, or admin-only fields. */
export interface PublicSiteState {
  currentVersion: number;
  totalContributions: number;
  currentContributor: PublicCurrentContributor | null;
  turnStatus: PublicTurnStatus;
  targetContributionNumber: number | null;
  dueAt: Timestamp | null;
  updatedAt: Timestamp;
}

/** Private singleton: site/admin. Authoritative pending-invitation/current-turn lock. */
export interface PrivateSiteState {
  activeTurnId: string | null;
  pendingInvitationId: string | null;
  updatedAt: Timestamp;
}
