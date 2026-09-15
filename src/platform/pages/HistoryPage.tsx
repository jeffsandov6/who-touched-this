/** @jsxImportSource react */

import { useEffect, useState } from 'react';
import {
  formatHistoryDate,
  HistoryContributionRecord,
} from '../components/HistoryContributionRecord';
import { loadPublicHistory } from '../firebase/public-history';
import {
  formatContributionNumber,
  type PublicHistoryItem,
} from '../history';

function ContributionEntry({ event }: {
  event: Extract<PublicHistoryItem, { type: 'contribution' }>;
}) {
  const number = formatContributionNumber(event.contributionNumber);
  const headingId = `history-contribution-${event.contributionNumber}`;
  const detailUrl = `/history/${event.contributionNumber}`;
  return (
    <li className="history-event history-contribution">
      <span className="history-rail-marker" aria-hidden="true">{number}</span>
      <article className="history-entry-card" aria-labelledby={headingId}>
        <HistoryContributionRecord event={event} headingId={headingId} />
        <a className={`history-detail-link${event.snapshot ? ' history-detail-link-visual' : ''}`} href={detailUrl}>
          {event.snapshot ? `see before & after · ${event.snapshot.routes.length} ${event.snapshot.routes.length === 1 ? 'page' : 'pages'}` : 'view contribution'}
        </a>
      </article>
    </li>
  );
}

function TurnOutcomeEntry({ event }: {
  event: Extract<PublicHistoryItem, { type: 'turn_expired' | 'turn_skipped' }>;
}) {
  const number = formatContributionNumber(event.targetContributionNumber);
  const headingId = `history-outcome-${event.targetContributionNumber}-${event.type}`;
  return (
    <li className="history-event history-turn-outcome">
      <span className="history-rail-marker history-rail-marker-muted" aria-hidden="true">missed turn</span>
      <article className="history-entry-card" aria-labelledby={headingId}>
        <p className="history-event-kind">unwritten version {number}</p>
        <h2 id={headingId}>{event.displayName}</h2>
        <p className="history-outcome-status">
          {event.type === 'turn_expired' ? 'their contribution window expired' : 'their turn was skipped'}
        </p>
        <p className="history-outcome-note">no shame. life happens.</p>
        <time dateTime={event.occurredAt.toISOString()}>{formatHistoryDate(event.occurredAt)}</time>
      </article>
    </li>
  );
}

export function HistoryTimeline({ events }: {
  events: PublicHistoryItem[];
}) {
  return (
    <ol className="history-timeline" aria-label="website versions & turn outcomes">
      {events.map((event) => event.type === 'contribution'
        ? <ContributionEntry event={event} key={event.id} />
        : <TurnOutcomeEntry event={event} key={event.id} />)}
    </ol>
  );
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
    <section className="page-content history-page" aria-labelledby="history-heading">
      <header className="history-intro">
        <p className="history-eyebrow">the site's lineage</p>
        <h1 id="history-heading">history</h1>
        <p>one website, passed from person to person. every accepted touch leaves a version behind.</p>
      </header>
      {error ? (
        <div className="notice notice-error" role="alert">
          <p>history could not be loaded.</p>
          <button className="button button-secondary" type="button" onClick={() => void refresh()}>
            try again
          </button>
        </div>
      ) : loading ? (
        <p className="history-loading" role="status">opening the archive…</p>
      ) : events.length === 0 ? (
        <div className="history-empty">
          <p className="history-event-kind">the archive is ready</p>
          <h2>the first accepted touch will begin the timeline.</h2>
          <p>nothing has been added yet. this space is waiting for a real contribution.</p>
        </div>
      ) : (
        <HistoryTimeline events={events} />
      )}
    </section>
  );
}
