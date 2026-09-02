/** @jsxImportSource react */

import { useEffect, useState, type SyntheticEvent } from 'react';
import {
  CONTRIBUTION_SUMMARY_MAX_LENGTH,
  CONTRIBUTOR_MESSAGE_MAX_LENGTH,
} from '../contribution-validation';
import type { AdminCurrentTurn as AdminCurrentTurnData } from '../firebase/turns';
import { canExpireTurn } from '../turn-lifecycle';
import Countdown from './Countdown';

interface Props {
  turn: AdminCurrentTurnData;
  busy: boolean;
  onRecordSubmission: (prUrl: string, prNumber: string) => Promise<void>;
  onMarkUnderReview: () => Promise<void>;
  onRecordMerged: (summary: string, contributorMessage: string) => Promise<void>;
  onExpire: () => Promise<void>;
  onSkip: () => Promise<void>;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export default function AdminCurrentTurn({
  turn,
  busy,
  onRecordSubmission,
  onMarkUnderReview,
  onRecordMerged,
  onExpire,
  onSkip,
}: Props) {
  const [nowMillis, setNowMillis] = useState(() => Date.now());
  const [prUrl, setPrUrl] = useState('');
  const [prNumber, setPrNumber] = useState('');
  const [summary, setSummary] = useState('');
  const [contributorMessage, setContributorMessage] = useState('');

  useEffect(() => {
    const timer = window.setInterval(() => setNowMillis(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function handleSubmission(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    await onRecordSubmission(prUrl, prNumber);
  }

  async function handleMerged(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.confirm(
      'Record this contribution as merged? The pull request should already be merged on GitHub.',
    )) return;
    await onRecordMerged(summary, contributorMessage);
  }

  return (
    <div className="admin-turn-panel">
      <dl className="admin-current-turn-details">
        <div><dt>Contributor</dt><dd><strong>{turn.displayName}</strong></dd></div>
        <div>
          <dt>GitHub</dt>
          <dd><a href={turn.githubProfileUrl} rel="noreferrer">@{turn.githubUsername}</a></dd>
        </div>
        <div><dt>Private contact</dt><dd><a href={`mailto:${turn.email}`}>{turn.email}</a></dd></div>
        <div><dt>Target contribution</dt><dd>#{turn.targetContributionNumber}</dd></div>
        <div><dt>Status</dt><dd>{turn.status.replace('_', ' ')}</dd></div>
        <div><dt>Started</dt><dd>{formatDate(turn.startedAt)}</dd></div>
        <div><dt>Deadline</dt><dd>{formatDate(turn.dueAt)}</dd></div>
        {turn.status === 'active' && (
          <div>
            <dt>Time remaining</dt>
            <dd><Countdown dueAtMillis={turn.dueAt.getTime()} /></dd>
          </div>
        )}
        {turn.prNumber && turn.prUrl && (
          <div><dt>Pull request</dt><dd><a href={turn.prUrl} rel="noreferrer">#{turn.prNumber}</a></dd></div>
        )}
        {turn.submittedAt && (
          <div><dt>Submitted</dt><dd>{formatDate(turn.submittedAt)}</dd></div>
        )}
        {turn.reviewStartedAt && (
          <div><dt>Review started</dt><dd>{formatDate(turn.reviewStartedAt)}</dd></div>
        )}
      </dl>

      {turn.status === 'active' && (
        <form className="admin-pr-form" onSubmit={(event) => void handleSubmission(event)}>
          <h3>Record PR submission</h3>
          <div className="form-field">
            <label htmlFor="turn-pr-url">GitHub pull request URL</label>
            <input
              id="turn-pr-url"
              type="url"
              placeholder="https://github.com/example/repo/pull/123"
              value={prUrl}
              onChange={(event) => setPrUrl(event.target.value)}
              disabled={busy}
              required
            />
          </div>
          <div className="form-field">
            <label htmlFor="turn-pr-number">GitHub PR number</label>
            <input
              id="turn-pr-number"
              type="number"
              min="1"
              step="1"
              value={prNumber}
              onChange={(event) => setPrNumber(event.target.value)}
              disabled={busy}
              required
            />
          </div>
          <button className="button" type="submit" disabled={busy}>
            {busy ? 'Updating…' : 'Record PR submission'}
          </button>
        </form>
      )}

      {turn.status === 'under_review' && (
        <form className="admin-merge-form" onSubmit={(event) => void handleMerged(event)}>
          <h3>Record successful contribution</h3>
          <p className="admin-private-note">
            This records an outcome only. Merge the pull request manually on GitHub first.
          </p>
          <div className="form-field">
            <label htmlFor="contribution-summary">Contribution summary</label>
            <textarea
              id="contribution-summary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              maxLength={CONTRIBUTION_SUMMARY_MAX_LENGTH}
              disabled={busy}
              required
            />
            <small>Public, required, and limited to {CONTRIBUTION_SUMMARY_MAX_LENGTH} characters.</small>
          </div>
          <div className="form-field">
            <label htmlFor="contributor-message">Contributor message (optional)</label>
            <textarea
              id="contributor-message"
              value={contributorMessage}
              onChange={(event) => setContributorMessage(event.target.value)}
              maxLength={CONTRIBUTOR_MESSAGE_MAX_LENGTH}
              disabled={busy}
            />
            <small>Public and limited to {CONTRIBUTOR_MESSAGE_MAX_LENGTH} characters.</small>
          </div>
          <button className="button" type="submit" disabled={busy}>
            {busy ? 'Recording…' : 'Record merged contribution'}
          </button>
        </form>
      )}

      <div className="admin-turn-actions">
        {turn.status === 'submitted' && (
          <button className="button" type="button" onClick={() => void onMarkUnderReview()} disabled={busy}>
            Mark under review
          </button>
        )}
        {canExpireTurn(turn.status, turn.dueAt.getTime(), nowMillis) && (
          <button
            className="button button-danger"
            type="button"
            onClick={() => {
              if (window.confirm('Expire this turn? This cannot be undone in the application.')) {
                void onExpire();
              }
            }}
            disabled={busy}
          >
            Expire turn
          </button>
        )}
        <button
          className="button button-danger-secondary"
          type="button"
          onClick={() => {
            if (window.confirm('Skip this turn? This cannot be undone in the application.')) {
              void onSkip();
            }
          }}
          disabled={busy}
        >
          Skip turn
        </button>
      </div>

    </div>
  );
}
