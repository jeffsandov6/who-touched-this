/** @jsxImportSource react */

import { useEffect, useState } from 'react';
import { subscribeToPublicSiteState } from '../firebase/public-site';
import { DEFAULT_PUBLIC_SITE_STATE } from '../turn-state';
import { getPublicTurnPresentation } from '../turn-lifecycle';
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
    : 'none';
  const presentation = getPublicTurnPresentation(siteState.turnStatus);

  return (
    <aside className="site-status" aria-label="site status">
      <dl>
        <div>
          <dt>version</dt>
          <dd>#{formattedVersion}</dd>
        </div>
        <div>
          <dt>contributions</dt>
          <dd>{siteState.totalContributions}</dd>
        </div>
        <div>
          <dt>current contributor</dt>
          <dd>{contributor}</dd>
        </div>
        <div>
          <dt>turn status</dt>
          <dd>{presentation.statusLabel}</dd>
        </div>
        {formattedTarget && (
          <div>
            <dt>{presentation.targetLabel}</dt>
            <dd>#{formattedTarget}</dd>
          </div>
        )}
        {presentation.showCountdown && siteState.dueAtMillis !== null && (
          <div>
            <dt>time remaining</dt>
            <dd><Countdown dueAtMillis={siteState.dueAtMillis} /></dd>
          </div>
        )}
      </dl>
    </aside>
  );
}
