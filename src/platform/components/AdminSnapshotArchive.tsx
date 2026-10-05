/** @jsxImportSource react */

import { useRef, useState } from 'react';
import { finalizeSnapshotArchive, uploadSnapshotArchive } from '../firebase/snapshot-archives';
import { validateSelectedSnapshotBundle, type ValidatedSnapshotBundle } from '../snapshots/archive';
import type { AdminPendingArchive } from '../firebase/turns';

export default function AdminSnapshotArchive({ pendingArchive, onFinalized }: {
  pendingArchive: AdminPendingArchive | null;
  onFinalized?: () => Promise<void>;
}) {
  const activeUpload = useRef<{ cancel(): void } | null>(null);
  const [bundle, setBundle] = useState<ValidatedSnapshotBundle | null>(null);
  const [phase, setPhase] = useState<'idle' | 'validating' | 'ready' | 'uploading' | 'finalizing' | 'done'>('idle');
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  async function select(files: FileList | null) {
    setBundle(null);
    setError(null);
    if (!files?.length) { setPhase('idle'); return; }
    setPhase('validating');
    try {
      const validated = await validateSelectedSnapshotBundle([...files]);
      if (!pendingArchive
        || validated.manifest.contributionNumber !== pendingArchive.contributionNumber
        || validated.manifest.git.before !== pendingArchive.beforeGitSha
        || validated.manifest.git.after !== pendingArchive.afterGitSha) {
        throw new Error('this bundle does not match the contribution currently awaiting archival.');
      }
      setBundle(validated);
      setPhase('ready');
    } catch (cause) {
      setPhase('idle');
      setError(cause instanceof Error ? cause.message : 'snapshot bundle validation failed.');
    }
  }

  async function archive() {
    if (!bundle || !window.confirm(`archive contribution #${bundle.manifest.contributionLabel} snapshots permanently?`)) return;
    setError(null);
    setPhase('uploading');
    try {
      const upload = uploadSnapshotArchive(bundle, (completed, total) => setProgress({ completed, total }));
      activeUpload.current = upload;
      await upload.result;
      activeUpload.current = null;
      setPhase('finalizing');
      await finalizeSnapshotArchive(bundle.manifest.contributionNumber, bundle.manifest.captureId);
      setPhase('done');
      await onFinalized?.().catch(() => undefined);
    } catch {
      activeUpload.current = null;
      setPhase('ready');
      setError('archive incomplete — public snapshot metadata was not finalized. retry this same bundle to resume missing uploads.');
    }
  }

  return (
    <section className="admin-media" aria-labelledby="snapshot-archive-heading">
      <h2 id="snapshot-archive-heading">snapshot archive</h2>
      <p className="admin-private-note">import one reviewed local capture bundle. finalized history archives cannot be replaced or deleted here.</p>
      {!pendingArchive && <p className="notice">no contribution archive is pending. the relay is ready for its next invitation.</p>}
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {phase === 'done' && bundle && <p className="notice" role="status">archived contribution #{bundle.manifest.contributionLabel}: {bundle.manifest.capturedRoutes.length} pages, {bundle.validChecksums} screenshot images.</p>}
      <div className="form-field">
        <label htmlFor="snapshot-bundle">local snapshot bundle directory</label>
        <input
          id="snapshot-bundle"
          type="file"
          // React does not type Chromium's directory picker attribute.
          {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
          disabled={phase === 'uploading' || phase === 'finalizing'}
          onChange={(event) => void select(event.target.files)}
        />
      </div>
      {phase === 'validating' && <p role="status">validating manifest & screenshot checksums…</p>}
      {bundle && phase !== 'validating' && (
        <div className="admin-start-turn">
          <h3>contribution #{bundle.manifest.contributionLabel}</h3>
          <dl>
            <div><dt>before sha</dt><dd><code>{bundle.manifest.git.before}</code></dd></div>
            <div><dt>after sha</dt><dd><code>{bundle.manifest.git.after}</code></dd></div>
            <div><dt>canonical pages</dt><dd>{bundle.manifest.canonicalRoutes.length}</dd></div>
            <div><dt>screenshot images</dt><dd>{bundle.validChecksums}</dd></div>
            <div><dt>integrity</dt><dd>{bundle.validChecksums} / {bundle.screenshots.size} image checksums valid</dd></div>
          </dl>
          <p>routes: {bundle.manifest.capturedRoutes.join(', ')}</p>
          {phase === 'uploading' && (
            <div role="status">
              <progress value={progress.completed} max={progress.total}>{Math.floor(progress.completed)} / {progress.total}</progress>
              <span> {Math.floor(progress.completed)} / {progress.total} objects</span>
            </div>
          )}
          {phase === 'finalizing' && <p role="status">finalizing archive…</p>}
          <div className="admin-turn-actions">
            <button className="button" type="button" onClick={() => void archive()} disabled={phase !== 'ready'}>archive snapshots</button>
            {phase === 'uploading' && <button className="button button-secondary" type="button" onClick={() => activeUpload.current?.cancel()}>cancel upload</button>}
          </div>
        </div>
      )}
    </section>
  );
}
