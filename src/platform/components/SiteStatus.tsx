/** @jsxImportSource react */

interface SiteStatusProps {
  version?: number;
  contributionCount?: number;
  currentContributor?: string | null;
  turnStatus?: string;
}

export default function SiteStatus({
  version = 0,
  contributionCount = 0,
  currentContributor = null,
  turnStatus = 'No active turn',
}: SiteStatusProps) {
  const formattedVersion = String(version).padStart(3, '0');

  return (
    <aside className="site-status" aria-label="Site status">
      <dl>
        <div>
          <dt>Version</dt>
          <dd>#{formattedVersion}</dd>
        </div>
        <div>
          <dt>Contributions</dt>
          <dd>{contributionCount}</dd>
        </div>
        <div>
          <dt>Current contributor</dt>
          <dd>{currentContributor ?? 'None'}</dd>
        </div>
        <div>
          <dt>Turn status</dt>
          <dd>{turnStatus}</dd>
        </div>
      </dl>
    </aside>
  );
}
