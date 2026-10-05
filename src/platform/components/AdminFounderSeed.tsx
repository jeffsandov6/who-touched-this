/** @jsxImportSource react */

import { useEffect, useState } from 'react';
import {
  CONTRIBUTION_SUMMARY_MAX_LENGTH,
  CONTRIBUTOR_MESSAGE_MAX_LENGTH,
  FOUNDER_CONTACT_EMAIL_MAX_LENGTH,
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
  const [publicDisplayName, setPublicDisplayName] = useState('founder');
  const [contactEmail, setContactEmail] = useState('');
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
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'founder record could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isOwner]);

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    let input;
    try {
      input = validateFounderSeedForm({ publicDisplayName, contactEmail, prNumber, summary, contributorMessage, beforeGitSha, afterGitSha });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'founder details are invalid.');
      return;
    }
    if (!window.confirm('record the already-merged founder contribution #000 permanently? this cannot be edited or repeated.')) return;
    setBusy(true);
    try {
      await recordFounderContributionZero(input);
      setRecorded(await loadFounderSeedContribution());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'founder contribution #000 could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-media" aria-labelledby="founder-seed-heading">
      <h2 id="founder-seed-heading">founder contribution #000</h2>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {!isOwner ? (
        <p className="admin-private-note">only the active owner may perform this one-time bootstrap operation.</p>
      ) : loading ? (
        <p role="status">checking founder bootstrap state…</p>
      ) : recorded ? (
        <div className="admin-start-turn">
          <p className="notice">recorded</p>
          <h3>{recorded.displayName}</h3>
          <p>{recorded.summary}</p>
          {recorded.contributorMessage && <blockquote>{recorded.contributorMessage}</blockquote>}
          <dl>
            <div><dt>GitHub pr</dt><dd><a href={recorded.prUrl} rel="noreferrer">#{recorded.prNumber}</a></dd></div>
            <div><dt>before sha</dt><dd><code>{recorded.beforeGitSha}</code></dd></div>
            <div><dt>after sha</dt><dd><code>{recorded.afterGitSha}</code></dd></div>
            <div><dt>recorded</dt><dd>{formatDate(recorded.mergedAt)}</dd></div>
          </dl>
          {recorded.beforeGitSha && recorded.afterGitSha && (
            <div className="form-field">
              <label htmlFor="founder-snapshot-command">snapshot capture command</label>
              <textarea id="founder-snapshot-command" readOnly rows={4} value={founderSnapshotCommand(recorded.beforeGitSha, recorded.afterGitSha)} />
              <button className="button button-secondary" type="button" onClick={() => void navigator.clipboard.writeText(founderSnapshotCommand(recorded.beforeGitSha!, recorded.afterGitSha!))}>copy command</button>
            </div>
          )}
        </div>
      ) : (
        <form className="admin-start-turn" onSubmit={(event) => void submit(event)}>
          <p className="admin-private-note">this records an already merged creative founder pr. it does not merge, deploy, capture, or archive anything.</p>
          <div className="form-field"><label htmlFor="founder-name">public founder name / alias</label><input id="founder-name" required maxLength={FOUNDER_DISPLAY_NAME_MAX_LENGTH} value={publicDisplayName} onChange={(event) => setPublicDisplayName(event.target.value)} /></div>
          <div className="form-field"><label htmlFor="founder-contact-email">private completion-email address</label><input id="founder-contact-email" type="email" required maxLength={FOUNDER_CONTACT_EMAIL_MAX_LENGTH} autoComplete="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} /><small>stored privately on the owner record and used only for Founder #000 completion email delivery.</small></div>
          <div className="form-field"><label htmlFor="founder-pr">GitHub pr number</label><input id="founder-pr" type="number" min="1" step="1" required value={prNumber} onChange={(event) => setPrNumber(event.target.value)} /><small>GitHub assigns this number; it is unrelated to contribution #000.</small></div>
          <div className="form-field"><label htmlFor="founder-summary">summary</label><textarea id="founder-summary" required maxLength={CONTRIBUTION_SUMMARY_MAX_LENGTH} value={summary} onChange={(event) => setSummary(event.target.value)} /></div>
          <div className="form-field"><label htmlFor="founder-message">optional founder message</label><textarea id="founder-message" maxLength={CONTRIBUTOR_MESSAGE_MAX_LENGTH} value={contributorMessage} onChange={(event) => setContributorMessage(event.target.value)} /></div>
          <div className="form-field"><label htmlFor="founder-before">before git sha</label><input id="founder-before" required minLength={40} maxLength={40} spellCheck={false} value={beforeGitSha} onChange={(event) => setBeforeGitSha(event.target.value)} /></div>
          <div className="form-field"><label htmlFor="founder-after">after git sha</label><input id="founder-after" required minLength={40} maxLength={40} spellCheck={false} value={afterGitSha} onChange={(event) => setAfterGitSha(event.target.value)} /></div>
          <button className="button" type="submit" disabled={busy}>{busy ? 'recording…' : 'record founder contribution #000'}</button>
        </form>
      )}
    </section>
  );
}
