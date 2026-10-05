/** @jsxImportSource react */

import { useEffect, useState } from 'react';
import { getPublicHistorySnapshotUrl } from '../firebase/snapshot-archives';
import {
  historicalRouteLabel,
  snapshotHistorySummary,
  snapshotImageAlt,
  type PublicContributionSnapshot,
  type PublicSnapshotImage,
  type PublicSnapshotSide,
  type PublicSnapshotTile,
} from '../snapshots/public';

export type HistorySnapshotImageResolver = (image: PublicSnapshotImage) => Promise<string>;

const resolveArchivedSnapshotImage: HistorySnapshotImageResolver = (image) =>
  getPublicHistorySnapshotUrl(image.storagePath);

function ResolvedImage({ image, alt, resolveImageUrl, showFullSizeLink = false }: { image: PublicSnapshotImage; alt: string; resolveImageUrl: HistorySnapshotImageResolver; showFullSizeLink?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void resolveImageUrl(image).then((nextUrl) => { if (active) setUrl(nextUrl); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [image, resolveImageUrl]);
  if (error) return <p className="notice">screenshot unavailable.</p>;
  if (!url) return <p role="status">loading screenshot…</p>;
  return <><a className="history-snapshot-image-link" href={url} target="_blank" rel="noreferrer"><img loading="lazy" src={url} alt={alt} onError={() => setError(true)} /></a>{showFullSizeLink ? <a className="history-snapshot-full-link" href={url} target="_blank" rel="noreferrer">open full size</a> : null}</>;
}

function ResolvedTile({ tile, alt, resolveImageUrl }: { tile: PublicSnapshotTile; alt: string; resolveImageUrl: HistorySnapshotImageResolver }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void resolveImageUrl(tile).then((nextUrl) => { if (active) setUrl(nextUrl); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [tile, resolveImageUrl]);
  return (
    <div className={`history-snapshot-tile${error ? ' history-snapshot-tile-error' : ''}`} style={{ aspectRatio: `${tile.width} / ${tile.height}` }} aria-busy={!url && !error}>
      {url && !error ? <a className="history-snapshot-tile-link" href={url} target="_blank" rel="noreferrer"><img loading="lazy" src={url} alt={alt} onError={() => setError(true)} /></a> : null}
      {error ? <span role="status">screenshot unavailable</span> : null}
    </div>
  );
}

function SnapshotImage({ image, side, contributionNumber, route, resolveImageUrl }: {
  image: PublicSnapshotSide;
  side: 'before' | 'after';
  contributionNumber: number;
  route: string;
  resolveImageUrl: HistorySnapshotImageResolver;
}) {
  const tiled = 'tiles' in image;
  const images = tiled ? image.tiles : [image];
  return (
    <figure className={`history-snapshot history-snapshot-${side}`}>
      <figcaption>{side}</figcaption>
      {tiled ? <div className="history-snapshot-image-stack">{image.tiles.map((tile, index) => <ResolvedTile key={tile.storagePath} tile={tile} alt={`${snapshotImageAlt(side, contributionNumber, route)}, tile ${index + 1} of ${image.tiles.length}`} resolveImageUrl={resolveImageUrl} />)}</div>
        : <ResolvedImage image={images[0]} alt={snapshotImageAlt(side, contributionNumber, route)} resolveImageUrl={resolveImageUrl} showFullSizeLink />}
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
