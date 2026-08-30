/** @jsxImportSource react */

import { useEffect, useState } from 'react';
import { subscribeToPublicSiteState } from '../firebase/public-site';
import { DEFAULT_PUBLIC_SITE_STATE } from '../turn-state';
import Countdown from './Countdown';

export default function SiteStatus() {
  const [siteState, setSiteState] = useState(DEFAULT_PUBLIC_SITE_STATE);

  useEffect(() => {
    let unsubscribe = () => {};

    try {
      unsubscribe = subscribeToPublicSiteState(setSiteState);
    } catch {
      setSiteState(DEFAULT_PUBLIC_SITE_STATE);
    }

    return unsubscribe;
  }, []);

  const formattedVersion = String(siteState.currentVersion).padStart(3, '0');
  const formattedTarget = siteState.targetContributionNumber
    ? String(siteState.targetContributionNumber).padStart(3, '0')
    : null;
  const contributor = siteState.currentContributor
    ? `${siteState.currentContributor.displayName} (@${siteState.currentContributor.githubUsername})`
    : 'None';

  return (
    <aside className="site-status" aria-label="Site status">
      <dl>
        <div>
          <dt>Version</dt>
          <dd>#{formattedVersion}</dd>
        </div>
        <div>
          <dt>Contributions</dt>
          <dd>{siteState.totalContributions}</dd>
        </div>
        <div>
          <dt>Current contributor</dt>
          <dd>{contributor}</dd>
        </div>
        <div>
          <dt>Turn status</dt>
          <dd>{siteState.turnStatus === 'active' ? 'Active' : 'No active turn'}</dd>
        </div>
        {formattedTarget && (
          <div>
            <dt>Working on</dt>
            <dd>#{formattedTarget}</dd>
          </div>
        )}
        {siteState.turnStatus === 'active' && siteState.dueAtMillis !== null && (
          <div>
            <dt>Time remaining</dt>
            <dd><Countdown dueAtMillis={siteState.dueAtMillis} /></dd>
          </div>
        )}
      </dl>
    </aside>
  );
}
