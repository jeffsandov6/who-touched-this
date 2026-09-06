/** @jsxImportSource react */

import { useEffect, useState } from 'react';
import {
  CONTRIBUTION_SUMMARY_MAX_LENGTH,
  CONTRIBUTOR_MESSAGE_MAX_LENGTH,
  FOUNDER_DISPLAY_NAME_MAX_LENGTH,
  founderSnapshotCommand,
  validateFounderSeedForm,
} from '../founder-seed';
import {
  loadFounderSeedContribution,
  recordFounderContributionZero,
} from '../firebase/founder-seed';
import type { ParsedContribution } from '../history';

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default function AdminFounderSeed({ isOwner }: { isOwner: boolean }) {
  const [recorded, setRecorded] = useState<ParsedContribution | null>(null);
  const [loading, setLoading] = useState(isOwner);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publicDisplayName, setPublicDisplayName] = useState('Founder');
  const [prNumber, setPrNumber] = useState('');
  const [summary, setSummary] = useState('');
  const [contributorMessage, setContributorMessage] = useState('');
  const [beforeGitSha, setBeforeGitSha] = useState('');
  const [afterGitSha, setAfterGitSha] = useState('');

  useEffect(() => {
    let active = true;
    if (!isOwner) { setLoading(false); return () => { active = false; }; }
    void loadFounderSeedContribution()
      .then((value) => { if (active) setRecorded(value); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Founder record could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isOwner]);

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    let input;
    try {
      input = validateFounderSeedForm({ publicDisplayName, prNumber, summary, contributorMessage, beforeGitSha, afterGitSha });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Founder details are invalid.');
      return;
    }
    if (!window.confirm('Record the already-merged Founder Contribution #000 permanently? This cannot be edited or repeated.')) return;
    setBusy(true);
    try {
      await recordFounderContributionZero(input);
      setRecorded(await loadFounderSeedContribution());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Founder Contribution #000 could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-media" aria-labelledby="founder-seed-heading">
      <h2 id="founder-seed-heading">Founder Contribution #000</h2>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {!isOwner ? (
        <p className="admin-private-note">Only the active owner may perform this one-time bootstrap operation.</p>
      ) : loading ? (
        <p role="status">Checking founder bootstrap state…</p>
      ) : recorded ? (
        <div className="admin-start-turn">
          <p className="notice">Recorded</p>
          <h3>{recorded.displayName}</h3>
          <p>{recorded.summary}</p>
          {recorded.contributorMessage && <blockquote>{recorded.contributorMessage}</blockquote>}
          <dl>
            <div><dt>GitHub PR</dt><dd><a href={recorded.prUrl} rel="noreferrer">#{recorded.prNumber}</a></dd></div>
            <div><dt>BEFORE SHA</dt><dd><code>{recorded.beforeGitSha}</code></dd></div>
            <div><dt>AFTER SHA</dt><dd><code>{recorded.afterGitSha}</code></dd></div>
            <div><dt>Recorded</dt><dd>{formatDate(recorded.mergedAt)}</dd></div>
          </dl>
          {recorded.beforeGitSha && recorded.afterGitSha && (
            <div className="form-field">
              <label htmlFor="founder-snapshot-command">Snapshot capture command</label>
              <textarea id="founder-snapshot-command" readOnly rows={4} value={founderSnapshotCommand(recorded.beforeGitSha, recorded.afterGitSha)} />
              <button className="button button-secondary" type="button" onClick={() => void navigator.clipboard.writeText(founderSnapshotCommand(recorded.beforeGitSha!, recorded.afterGitSha!))}>Copy command</button>
            </div>
          )}
        </div>
      ) : (
        <form className="admin-start-turn" onSubmit={(event) => void submit(event)}>
          <p className="admin-private-note">This records an already merged creative founder PR. It does not merge, deploy, capture, or archive anything.</p>
          <div className="form-field"><label htmlFor="founder-name">Public founder name / alias</label><input id="founder-name" required maxLength={FOUNDER_DISPLAY_NAME_MAX_LENGTH} value={publicDisplayName} onChange={(event) => setPublicDisplayName(event.target.value)} /></div>
          <div className="form-field"><label htmlFor="founder-pr">GitHub PR number</label><input id="founder-pr" type="number" min="1" step="1" required value={prNumber} onChange={(event) => setPrNumber(event.target.value)} /><small>GitHub assigns this number; it is unrelated to Contribution #000.</small></div>
          <div className="form-field"><label htmlFor="founder-summary">Summary</label><textarea id="founder-summary" required maxLength={CONTRIBUTION_SUMMARY_MAX_LENGTH} value={summary} onChange={(event) => setSummary(event.target.value)} /></div>
          <div className="form-field"><label htmlFor="founder-message">Optional founder message</label><textarea id="founder-message" maxLength={CONTRIBUTOR_MESSAGE_MAX_LENGTH} value={contributorMessage} onChange={(event) => setContributorMessage(event.target.value)} /></div>
          <div className="form-field"><label htmlFor="founder-before">BEFORE Git SHA</label><input id="founder-before" required minLength={40} maxLength={40} spellCheck={false} value={beforeGitSha} onChange={(event) => setBeforeGitSha(event.target.value)} /></div>
          <div className="form-field"><label htmlFor="founder-after">AFTER Git SHA</label><input id="founder-after" required minLength={40} maxLength={40} spellCheck={false} value={afterGitSha} onChange={(event) => setAfterGitSha(event.target.value)} /></div>
          <button className="button" type="submit" disabled={busy}>{busy ? 'Recording…' : 'Record Founder Contribution #000'}</button>
        </form>
      )}
    </section>
  );
}
