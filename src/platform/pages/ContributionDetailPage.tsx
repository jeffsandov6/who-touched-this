/** @jsxImportSource react */

import { useEffect, useState } from 'react';
import {
  HistoryContributionRecord,
  type SuccessfulHistoryContribution,
} from '../components/HistoryContributionRecord';
import HistorySnapshots from '../components/HistorySnapshots';
import { loadPublicContributionDetail } from '../firebase/public-history';
import { contributionNumberFromHistoryPathname } from '../history-detail';

type DetailState =
  | { status: 'loading' }
  | { status: 'ready'; contribution: SuccessfulHistoryContribution }
  | { status: 'not_found' }
  | { status: 'error' };

export default function ContributionDetailPage() {
  const [state, setState] = useState<DetailState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    const contributionNumber = contributionNumberFromHistoryPathname(window.location.pathname);
    if (contributionNumber === null) {
      setState({ status: 'not_found' });
      return () => { active = false; };
    }

    void loadPublicContributionDetail(contributionNumber)
      .then((contribution) => {
        if (active) setState(contribution
          ? { status: 'ready', contribution }
          : { status: 'not_found' });
      })
      .catch(() => { if (active) setState({ status: 'error' }); });
    return () => { active = false; };
  }, []);

  const historyUrl = '/history';
  if (state.status === 'loading') {
    return <section className="page-content history-detail-page"><p role="status">opening this version…</p></section>;
  }
  if (state.status === 'not_found') {
    return (
      <section className="page-content history-detail-page history-detail-state">
        <h1>version not found.</h1>
        <p>there isn't an accepted contribution at this address.</p>
        <a href={historyUrl}>back to history</a>
      </section>
    );
  }
  if (state.status === 'error') {
    return (
      <section className="page-content history-detail-page history-detail-state">
        <h1>this version couldn't be opened.</h1>
        <p>the public archive is temporarily unavailable.</p>
        <a href={historyUrl}>back to history</a>
      </section>
    );
  }

  const { contribution } = state;
  return (
    <section className="page-content history-detail-page" aria-labelledby="history-detail-heading">
      <a className="history-back-link" href={historyUrl}>← back to history</a>
      <article className="history-detail-record">
        <HistoryContributionRecord
          event={contribution}
          headingLevel="h1"
          headingId="history-detail-heading"
          avatarSize={72}
        />
      </article>
      {contribution.archiveStatus === 'pending' ? (
        <section className="history-detail-no-snapshots" aria-labelledby="history-snapshots-heading">
          <p className="history-section-label">visual history</p>
          <h2 id="history-snapshots-heading">before & after</h2>
          <p>before & after is being archived.</p>
        </section>
      ) : contribution.snapshot ? (
        <HistorySnapshots snapshot={contribution.snapshot} />
      ) : (
        <section className="history-detail-no-snapshots" aria-labelledby="history-snapshots-heading">
          <p className="history-section-label">visual history</p>
          <h2 id="history-snapshots-heading">before & after</h2>
          <p>{contribution.archiveStatus === 'finalized'
            ? 'before & after is unavailable for this version.'
            : "before & after wasn't archived for this version."}</p>
        </section>
      )}
    </section>
  );
}
