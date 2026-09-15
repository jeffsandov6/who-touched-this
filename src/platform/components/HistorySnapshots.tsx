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

export type HistorySnapshotImageResolver = (image: PublicSnapshotImage) => Promise<string>;

const resolveArchivedSnapshotImage: HistorySnapshotImageResolver = (image) =>
  getPublicHistorySnapshotUrl(image.storagePath);

function SnapshotImage({ image, side, contributionNumber, route, resolveImageUrl }: {
  image: PublicSnapshotImage;
  side: 'before' | 'after';
  contributionNumber: number;
  route: string;
  resolveImageUrl: HistorySnapshotImageResolver;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void resolveImageUrl(image)
      .then((nextUrl) => { if (active) setUrl(nextUrl); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [image, resolveImageUrl]);

  return (
    <figure className={`history-snapshot history-snapshot-${side}`}>
      <figcaption>{side}</figcaption>
      {error ? <p className="notice">screenshot unavailable.</p> : url ? (
        <>
          <a
            className="history-snapshot-image-link"
            href={url}
            target="_blank"
            rel="noreferrer"
            aria-label={`open ${side} screenshot for ${route} full size`}
          >
            <img loading="lazy" src={url} alt={snapshotImageAlt(side, contributionNumber, route)} onError={() => setError(true)} />
          </a>
          <a className="history-snapshot-full-link" href={url} target="_blank" rel="noreferrer">
            open full size
          </a>
        </>
      ) : (
        <p role="status">loading screenshot…</p>
      )}
    </figure>
  );
}

export default function HistorySnapshots({
  snapshot,
  resolveImageUrl = resolveArchivedSnapshotImage,
}: {
  snapshot: PublicContributionSnapshot;
  resolveImageUrl?: HistorySnapshotImageResolver;
}) {
  return (
    <section className="history-snapshots history-detail-snapshots" aria-labelledby="history-snapshots-heading">
      <header className="history-snapshots-heading">
        <p className="history-section-label">visual history</p>
        <h2 id="history-snapshots-heading">before & after</h2>
        <p>{snapshotHistorySummary(snapshot).replace('before & after · ', '')} archived</p>
      </header>
      {snapshot.routes.map((record) => (
        <section className="history-snapshot-route" key={record.route}>
          <h3>{historicalRouteLabel(record.route)}</h3>
          <div className="history-snapshot-comparison">
            <SnapshotImage image={record.before} side="before" contributionNumber={snapshot.contributionNumber} route={record.route} resolveImageUrl={resolveImageUrl} />
            <SnapshotImage image={record.after} side="after" contributionNumber={snapshot.contributionNumber} route={record.route} resolveImageUrl={resolveImageUrl} />
          </div>
        </section>
      ))}
    </section>
  );
}
