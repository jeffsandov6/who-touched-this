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
      <h1 id="history-heading">history</h1>
      <p>every accepted contribution lives here. this is basically the site's permanent record of who touched what.</p>
      {error ? (
        <div className="notice notice-error" role="alert">
          <p>history could not be loaded.</p>
          <button className="button button-secondary" type="button" onClick={() => void refresh()}>
            try again
          </button>
        </div>
      ) : loading ? (
        <p role="status">loading history…</p>
      ) : events.length === 0 ? (
        <p className="empty-state">no history yet.</p>
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
                    {event.contributionKind === 'founder_seed' ? 'founder contribution' : 'contribution'}{' '}
                    {formatContributionNumber(event.contributionNumber)}
                    {event.contributionKind === 'founder_seed' && <span className="history-founder-badge">founder</span>}
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
                    {' · '}merged {formatDate(event.occurredAt)}
                  </p>
                  {event.snapshot && <HistorySnapshots snapshot={event.snapshot} />}
                </article>
              ) : (
                <article>
                  <p className="history-event-kind">
                    turn for {formatContributionNumber(event.targetContributionNumber)}
                  </p>
                  <p>
                    <strong>{event.displayName}</strong>
                    {' - '}{event.type === 'turn_expired' ? 'contribution window expired' : 'turn skipped'}
                  </p>
                  <p>no shame. life happens.</p>
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
