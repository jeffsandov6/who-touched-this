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
  onRecordMerged: (summary: string, contributorMessage: string, beforeGitSha: string, afterGitSha: string) => Promise<void>;
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
  const [beforeGitSha, setBeforeGitSha] = useState('');
  const [afterGitSha, setAfterGitSha] = useState('');

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
      'record this contribution as merged? the pull request should already be merged on GitHub.',
    )) return;
    await onRecordMerged(summary, contributorMessage, beforeGitSha, afterGitSha);
  }

  return (
    <div className="admin-turn-panel">
      <dl className="admin-current-turn-details">
        <div><dt>contributor</dt><dd><strong>{turn.displayName}</strong></dd></div>
        <div>
          <dt>GitHub</dt>
          <dd><a href={turn.githubProfileUrl} rel="noreferrer">@{turn.githubUsername}</a></dd>
        </div>
        <div><dt>private contact</dt><dd><a href={`mailto:${turn.email}`}>{turn.email}</a></dd></div>
        <div><dt>target contribution</dt><dd>#{turn.targetContributionNumber}</dd></div>
        <div><dt>status</dt><dd>{turn.status.replace('_', ' ')}</dd></div>
        <div><dt>started</dt><dd>{formatDate(turn.startedAt)}</dd></div>
        <div><dt>deadline</dt><dd>{formatDate(turn.dueAt)}</dd></div>
        {turn.status === 'active' && (
          <div>
            <dt>time remaining</dt>
            <dd><Countdown dueAtMillis={turn.dueAt.getTime()} /></dd>
          </div>
        )}
        {turn.prNumber && turn.prUrl && (
          <div><dt>pull request</dt><dd><a href={turn.prUrl} rel="noreferrer">#{turn.prNumber}</a></dd></div>
        )}
        {turn.submittedAt && (
          <div><dt>submitted</dt><dd>{formatDate(turn.submittedAt)}</dd></div>
        )}
        {turn.reviewStartedAt && (
          <div><dt>review started</dt><dd>{formatDate(turn.reviewStartedAt)}</dd></div>
        )}
      </dl>

      {turn.status === 'active' && (
        <form className="admin-pr-form" onSubmit={(event) => void handleSubmission(event)}>
          <h3>record pr submission</h3>
          <div className="form-field">
            <label htmlFor="turn-pr-url">GitHub pull request url</label>
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
            <label htmlFor="turn-pr-number">GitHub pr number</label>
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
            {busy ? 'updating…' : 'record pr submission'}
          </button>
        </form>
      )}

      {turn.status === 'under_review' && (
        <form className="admin-merge-form" onSubmit={(event) => void handleMerged(event)}>
          <h3>record successful contribution</h3>
          <p className="admin-private-note">
            this records an outcome only. merge the pull request manually on GitHub first.
          </p>
          <div className="form-field">
            <label htmlFor="contribution-summary">contribution summary</label>
            <textarea
              id="contribution-summary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              maxLength={CONTRIBUTION_SUMMARY_MAX_LENGTH}
              disabled={busy}
              required
            />
            <small>public, required, & limited to {CONTRIBUTION_SUMMARY_MAX_LENGTH} characters.</small>
          </div>
          <div className="form-field">
            <label htmlFor="contributor-message">contributor message (optional)</label>
            <textarea
              id="contributor-message"
              value={contributorMessage}
              onChange={(event) => setContributorMessage(event.target.value)}
              maxLength={CONTRIBUTOR_MESSAGE_MAX_LENGTH}
              disabled={busy}
            />
            <small>public & limited to {CONTRIBUTOR_MESSAGE_MAX_LENGTH} characters.</small>
          </div>
          <div className="form-field">
            <label htmlFor="contribution-before-sha">before SHA</label>
            <input id="contribution-before-sha" value={beforeGitSha}
              onChange={(event) => setBeforeGitSha(event.target.value)} minLength={40} maxLength={40}
              pattern="[0-9A-Fa-f]{40}" spellCheck={false} disabled={busy} required />
            <small>canonical main immediately before the accepted PR merge. enter the full 40-character SHA.</small>
          </div>
          <div className="form-field">
            <label htmlFor="contribution-after-sha">after SHA</label>
            <input id="contribution-after-sha" value={afterGitSha}
              onChange={(event) => setAfterGitSha(event.target.value)} minLength={40} maxLength={40}
              pattern="[0-9A-Fa-f]{40}" spellCheck={false} disabled={busy} required />
            <small>canonical main containing the accepted merge. capture tooling verifies ancestry independently.</small>
          </div>
          <button className="button" type="submit" disabled={busy}>
            {busy ? 'recording…' : 'record merged contribution'}
          </button>
        </form>
      )}

      <div className="admin-turn-actions">
        {turn.status === 'submitted' && (
          <button className="button" type="button" onClick={() => void onMarkUnderReview()} disabled={busy}>
            mark under review
          </button>
        )}
        {canExpireTurn(turn.status, turn.dueAt.getTime(), nowMillis) && (
          <button
            className="button button-danger"
            type="button"
            onClick={() => {
              if (window.confirm('expire this turn? this cannot be undone in the application.')) {
                void onExpire();
              }
            }}
            disabled={busy}
          >
            expire turn
          </button>
        )}
        <button
          className="button button-danger-secondary"
          type="button"
          onClick={() => {
            if (window.confirm('skip this turn? this cannot be undone in the application.')) {
              void onSkip();
            }
          }}
          disabled={busy}
        >
          skip turn
        </button>
      </div>

    </div>
  );
}
