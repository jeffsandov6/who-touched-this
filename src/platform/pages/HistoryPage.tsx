/** @jsxImportSource react */

import { useEffect, useState } from 'react';
import { loadPublicHistory } from '../firebase/public-history';
import { formatContributionNumber, type PublicHistoryItem } from '../history';
import HistorySnapshots from '../components/HistorySnapshots';

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export default function HistoryPage() {
  const [events, setEvents] = useState<PublicHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(false);
    try {
      setEvents(await loadPublicHistory());
    } catch {
      setEvents([]);
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <section className="page-content" aria-labelledby="history-heading">
      <h1 id="history-heading">History</h1>
      <p>The public chronology of accepted contributions and turns that ended without one.</p>
      {error ? (
        <div className="notice notice-error" role="alert">
          <p>History could not be loaded.</p>
          <button className="button button-secondary" type="button" onClick={() => void refresh()}>
            Try again
          </button>
        </div>
      ) : loading ? (
        <p role="status">Loading History…</p>
      ) : events.length === 0 ? (
        <p className="empty-state">No History events yet.</p>
      ) : (
        <ol className="history-timeline">
          {events.map((event) => (
            <li
              className={event.type === 'contribution'
                ? 'history-event history-contribution'
                : 'history-event history-turn-outcome'}
              key={event.id}
            >
              {event.type === 'contribution' ? (
                <article>
                  <p className="history-event-kind">
                    Contribution {formatContributionNumber(event.contributionNumber)}
                  </p>
                  <h2>{event.summary}</h2>
                  <p>
                    <strong>{event.displayName}</strong>{' '}
                    <a href={`https://github.com/${event.githubUsername}`} rel="noreferrer">
                      @{event.githubUsername}
                    </a>
                  </p>
                  {event.contributorMessage && (
                    <blockquote>{event.contributorMessage}</blockquote>
                  )}
                  <p>
                    <a href={event.prUrl} rel="noreferrer">GitHub PR #{event.prNumber}</a>
                    {' · '}Merged {formatDate(event.occurredAt)}
                  </p>
                  {event.snapshot && <HistorySnapshots snapshot={event.snapshot} />}
                </article>
              ) : (
                <article>
                  <p className="history-event-kind">
                    Turn for {formatContributionNumber(event.targetContributionNumber)}
                  </p>
                  <p>
                    <strong>{event.displayName}</strong>{' '}
                    <a href={`https://github.com/${event.githubUsername}`} rel="noreferrer">
                      @{event.githubUsername}
                    </a>
                    {' — '}{event.type === 'turn_expired' ? 'Expired' : 'Skipped'}
                  </p>
                  <time dateTime={event.occurredAt.toISOString()}>{formatDate(event.occurredAt)}</time>
                </article>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
