/** @jsxImportSource react */

import { useState, type ElementType } from 'react';
import {
  contributorInitials,
  formatContributionNumber,
  githubAvatarUrl,
  type PublicHistoryItem,
} from '../history';

export type SuccessfulHistoryContribution = Extract<PublicHistoryItem, { type: 'contribution' }>;

export function formatHistoryDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function ContributorAvatar({ event, size = 56 }: {
  event: SuccessfulHistoryContribution;
  size?: number;
}) {
  const source = githubAvatarUrl(event.githubUserId);
  const [failed, setFailed] = useState(false);
  if (!source || failed) {
    return (
      <span
        className="history-avatar history-avatar-fallback"
        style={{ width: size, height: size, flexBasis: size }}
        role="img"
        aria-label={`no GitHub avatar available for ${event.displayName}`}
      >
        {contributorInitials(event.displayName)}
      </span>
    );
  }
  return (
    <img
      className="history-avatar"
      src={source}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      alt={`${event.displayName}'s GitHub avatar`}
      onError={() => setFailed(true)}
    />
  );
}

export function HistoryContributionRecord({
  event,
  headingLevel = 'h2',
  headingId,
  avatarSize = 56,
}: {
  event: SuccessfulHistoryContribution;
  headingLevel?: 'h1' | 'h2';
  headingId: string;
  avatarSize?: number;
}) {
  const Heading = headingLevel as ElementType;
  const number = formatContributionNumber(event.contributionNumber);
  return (
    <>
      <header className="history-entry-header">
        <ContributorAvatar event={event} size={avatarSize} />
        <div className="history-entry-heading">
          <p className="history-event-kind">
            {event.contributionKind === 'founder_seed' ? 'founder contribution' : 'site version'}
            {event.contributionKind === 'founder_seed' && (
              <span className="history-founder-badge">founder</span>
            )}
          </p>
          <Heading id={headingId}>{number}</Heading>
          <p className="history-contributor">
            <strong>{event.displayName}</strong>
            <a href={`https://github.com/${event.githubUsername}`} rel="noreferrer">
              @{event.githubUsername}
            </a>
          </p>
        </div>
      </header>

      <section className="history-change" aria-label={`what changed in ${number}`}>
        <p className="history-section-label">what changed</p>
        <p className="history-summary">{event.summary}</p>
      </section>

      {event.contributorMessage && (
        <blockquote className="history-message">
          <span>left behind</span>
          <p>{event.contributorMessage}</p>
        </blockquote>
      )}

      <footer className="history-entry-footer">
        <time dateTime={event.occurredAt.toISOString()}>merged {formatHistoryDate(event.occurredAt)}</time>
        <nav aria-label={`${number} contribution links`}>
          <a href={event.prUrl} rel="noreferrer">PR #{event.prNumber}</a>
          <a href={`https://github.com/${event.githubUsername}`} rel="noreferrer">GitHub</a>
          {event.socialUrl && <a href={event.socialUrl} rel="noreferrer">social</a>}
        </nav>
      </footer>
    </>
  );
}
