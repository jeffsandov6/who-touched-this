import type { Timestamp } from 'firebase/firestore';

export const PARTICIPATION_STATUSES = [
  'waiting',
  'invited',
  'active',
  'completed',
  'withdrawn',
  'skipped',
] as const;

export type ParticipationStatus = (typeof PARTICIPATION_STATUSES)[number];

export const QUEUE_STATUSES = [
  'waiting',
  'invited',
  'active',
  'withdrawn',
  'skipped',
] as const;

export type QueueStatus = (typeof QUEUE_STATUSES)[number];

export const TURN_STATUSES = [
  'invited',
  'active',
  'submitted',
  'under_review',
  'merged',
  'expired',
  'skipped',
] as const;

export type TurnStatus = (typeof TURN_STATUSES)[number];

export const PUBLIC_TURN_STATUSES = [
  'no_active_turn',
  'active',
  'submitted',
  'under_review',
] as const;

export type PublicTurnStatus = (typeof PUBLIC_TURN_STATUSES)[number];

/** Private: contributors/{githubUserId} */
export interface ContributorRecord {
  githubUserId: string;
  githubUsername: string;
  displayName: string;
  email: string;
  socialUrl?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Private: participation/{season}_{githubUserId} */
export interface ParticipationRecord {
  githubUserId: string;
  season: string;
  status: ParticipationStatus;
  contributionNumber?: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Private: queue/{season}_{githubUserId} */
export interface QueueEntry {
  githubUserId: string;
  season: string;
  status: QueueStatus;
  joinedAt: Timestamp;
  /** Higher values may be considered before lower values by future admin tooling. */
  priority: number;
  /** Explicit admin ordering takes precedence when supplied. */
  sortOrder?: number;
  promotedAt?: Timestamp;
  updatedAt: Timestamp;
}

/** Private: turns/{turnId} */
export interface TurnRecord {
  githubUserId: string;
  contributionNumber: number;
  status: TurnStatus;
  startedAt: Timestamp;
  dueAt: Timestamp;
  submittedAt?: Timestamp;
  completedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Public-safe snapshot: contributions/{contributionNumber}. Never add private contact data. */
export interface PublicContributionRecord {
  contributionNumber: number;
  season: string;
  githubUserId: string;
  githubUsername: string;
  displayName: string;
  summary: string;
  contributorMessage?: string;
  prNumber?: number;
  prUrl?: string;
  beforeCommitSha?: string;
  afterCommitSha?: string;
  affectedRoutes: string[];
  mergedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PublicCurrentContributor {
  contributionNumber: number;
  githubUserId: string;
  githubUsername: string;
  displayName: string;
}

/** Public projection: site/public. Never add queue, contact, or admin-only fields. */
export interface PublicSiteState {
  currentVersion: number;
  totalAcceptedContributions: number;
  currentContributor: PublicCurrentContributor | null;
  currentTurnStatus: PublicTurnStatus;
  dueAt: Timestamp | null;
  updatedAt: Timestamp;
}
