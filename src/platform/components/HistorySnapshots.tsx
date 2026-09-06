/** @jsxImportSource react */

import { useEffect, useState } from 'react';
import { getPublicHistorySnapshotUrl } from '../firebase/snapshot-archives';
import {
  historicalRouteLabel,
  snapshotHistorySummary,
  snapshotImageAlt,
  type PublicContributionSnapshot,
  type PublicSnapshotImage,
} from '../snapshots/public';

function SnapshotImage({ image, side, contributionNumber, route }: {
  image: PublicSnapshotImage;
  side: 'before' | 'after';
  contributionNumber: number;
  route: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void getPublicHistorySnapshotUrl(image.storagePath)
      .then((nextUrl) => { if (active) setUrl(nextUrl); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [image.storagePath]);

  return (
    <figure>
      <figcaption>{side.toUpperCase()}</figcaption>
      {error ? <p className="notice">Screenshot unavailable.</p> : url ? (
        <img loading="lazy" src={url} alt={snapshotImageAlt(side, contributionNumber, route)} onError={() => setError(true)} />
      ) : (
        <p role="status">Loading screenshot…</p>
      )}
    </figure>
  );
}

export default function HistorySnapshots({ snapshot }: { snapshot: PublicContributionSnapshot }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="history-snapshots" aria-label={`Contribution #${String(snapshot.contributionNumber).padStart(3, '0')} snapshots`}>
      <button className="button button-secondary" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        {expanded ? 'Hide snapshots' : `View snapshots — ${snapshotHistorySummary(snapshot)}`}
      </button>
      {expanded && snapshot.routes.map((record) => (
        <section className="history-snapshot-route" key={record.route}>
          <h3>{historicalRouteLabel(record.route)}</h3>
          <div className="history-snapshot-comparison">
            <SnapshotImage image={record.before} side="before" contributionNumber={snapshot.contributionNumber} route={record.route} />
            <SnapshotImage image={record.after} side="after" contributionNumber={snapshot.contributionNumber} route={record.route} />
          </div>
        </section>
      ))}
    </section>
  );
}
