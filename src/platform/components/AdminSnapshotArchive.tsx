/** @jsxImportSource react */

import { useRef, useState } from 'react';
import { finalizeSnapshotArchive, uploadSnapshotArchive } from '../firebase/snapshot-archives';
import { validateSelectedSnapshotBundle, type ValidatedSnapshotBundle } from '../snapshots/archive';

export default function AdminSnapshotArchive() {
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
      setBundle(validated);
      setPhase('ready');
    } catch (cause) {
      setPhase('idle');
      setError(cause instanceof Error ? cause.message : 'Snapshot bundle validation failed.');
    }
  }

  async function archive() {
    if (!bundle || !window.confirm(`Archive Contribution #${bundle.manifest.contributionLabel} snapshots permanently?`)) return;
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
    } catch {
      activeUpload.current = null;
      setPhase('ready');
      setError('Archive incomplete — public snapshot metadata was not finalized. Retry this same bundle to resume missing uploads.');
    }
  }

  return (
    <section className="admin-media" aria-labelledby="snapshot-archive-heading">
      <h2 id="snapshot-archive-heading">Snapshot Archive</h2>
      <p className="admin-private-note">Import one reviewed local capture bundle. Finalized History archives cannot be replaced or deleted here.</p>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {phase === 'done' && bundle && <p className="notice" role="status">Archived Contribution #{bundle.manifest.contributionLabel}: {bundle.manifest.capturedRoutes.length} pages, {bundle.validChecksums} screenshots.</p>}
      <div className="form-field">
        <label htmlFor="snapshot-bundle">Local snapshot bundle directory</label>
        <input
          id="snapshot-bundle"
          type="file"
          // React does not type Chromium's directory picker attribute.
          {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
          disabled={phase === 'uploading' || phase === 'finalizing'}
          onChange={(event) => void select(event.target.files)}
        />
      </div>
      {phase === 'validating' && <p role="status">Validating manifest and screenshot checksums…</p>}
      {bundle && phase !== 'validating' && (
        <div className="admin-start-turn">
          <h3>Contribution #{bundle.manifest.contributionLabel}</h3>
          <dl>
            <div><dt>BEFORE SHA</dt><dd><code>{bundle.manifest.git.before}</code></dd></div>
            <div><dt>AFTER SHA</dt><dd><code>{bundle.manifest.git.after}</code></dd></div>
            <div><dt>Canonical pages</dt><dd>{bundle.manifest.canonicalRoutes.length}</dd></div>
            <div><dt>Screenshots</dt><dd>{bundle.validChecksums}</dd></div>
            <div><dt>Integrity</dt><dd>{bundle.validChecksums} / {bundle.manifest.capturedRoutes.length * 2} checksums valid</dd></div>
          </dl>
          <p>Routes: {bundle.manifest.capturedRoutes.join(', ')}</p>
          {phase === 'uploading' && (
            <div role="status">
              <progress value={progress.completed} max={progress.total}>{Math.floor(progress.completed)} / {progress.total}</progress>
              <span> {Math.floor(progress.completed)} / {progress.total} objects</span>
            </div>
          )}
          {phase === 'finalizing' && <p role="status">Finalizing archive…</p>}
          <div className="admin-turn-actions">
            <button className="button" type="button" onClick={() => void archive()} disabled={phase !== 'ready'}>Archive snapshots</button>
            {phase === 'uploading' && <button className="button button-secondary" type="button" onClick={() => activeUpload.current?.cancel()}>Cancel upload</button>}
          </div>
        </div>
      )}
    </section>
  );
}
