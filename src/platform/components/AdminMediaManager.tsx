/** @jsxImportSource react */

import { useEffect, useRef, useState } from 'react';
import {
  deleteFounderMedia,
  listFounderMedia,
  uploadFounderMedia,
  type FounderMediaObject,
} from '../firebase/media';
import { formatMediaBytes, validateFounderMediaFile } from '../media';

function MediaPreview({ media }: { media: FounderMediaObject }) {
  if (media.contentType.startsWith('image/')) {
    return <img className="admin-media-preview" src={media.downloadUrl} alt="" />;
  }
  if (media.contentType.startsWith('audio/')) {
    return <audio className="admin-media-audio" src={media.downloadUrl} controls preload="metadata" />;
  }
  if (media.contentType.startsWith('video/')) {
    return <video className="admin-media-preview" src={media.downloadUrl} controls preload="metadata" />;
  }
  return null;
}

export default function AdminMediaManager() {
  const activeUpload = useRef<{ cancel: () => boolean } | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [media, setMedia] = useState<FounderMediaObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refreshMedia() {
    setLoading(true);
    setError(null);
    try {
      setMedia(await listFounderMedia());
    } catch {
      setError('founder media could not be loaded. check storage emulator or bucket configuration.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshMedia();
    return () => {
      activeUpload.current?.cancel();
    };
  }, []);

  function selectFile(file: File | null) {
    setMessage(null);
    setError(null);
    if (!file) {
      setSelectedFile(null);
      return;
    }
    try {
      validateFounderMediaFile(file);
      setSelectedFile(file);
    } catch (cause) {
      setSelectedFile(null);
      setError(cause instanceof Error ? cause.message : 'that file cannot be uploaded.');
    }
  }

  async function handleUpload() {
    if (!selectedFile) return;
    setUploading(true);
    setProgress(0);
    setMessage(null);
    setError(null);
    try {
      const upload = uploadFounderMedia(selectedFile, setProgress);
      activeUpload.current = upload;
      const uploaded = await upload.result;
      setMessage(`uploaded ${uploaded.name}.`);
      setSelectedFile(null);
      await refreshMedia();
    } catch {
      setError('the media upload failed or was cancelled. the existing media library was not changed.');
    } finally {
      activeUpload.current = null;
      setUploading(false);
    }
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${label} copied.`);
      setError(null);
    } catch {
      setError(`${label} could not be copied. select it manually instead.`);
    }
  }

  async function handleDelete(item: FounderMediaObject) {
    if (!window.confirm(`delete ${item.name}? existing references to this url will stop working.`)) return;
    setMessage(null);
    setError(null);
    try {
      await deleteFounderMedia(item.path);
      setMessage(`deleted ${item.name}.`);
      await refreshMedia();
    } catch {
      setError('the media object could not be deleted.');
    }
  }

  return (
    <section className="admin-media" aria-labelledby="admin-media-heading">
      <div className="admin-media-heading-row">
        <div>
          <h2 id="admin-media-heading">media</h2>
          <p className="admin-private-note">
            public founder canvas media. uploading creates a unique object; existing objects are never overwritten.
          </p>
        </div>
        <button className="button button-secondary" type="button" onClick={() => void refreshMedia()} disabled={loading || uploading}>
          {loading ? 'loading…' : 'refresh media'}
        </button>
      </div>

      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {message && <p className="notice" role="status">{message}</p>}

      <div className="admin-media-upload">
        <div className="form-field">
          <label htmlFor="founder-media-file">image, audio, or video</label>
          <input
            id="founder-media-file"
            type="file"
            accept="image/*,audio/*,video/*"
            disabled={uploading}
            onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
          />
        </div>
        {selectedFile && (
          <p>
            <strong>{selectedFile.name}</strong> · {selectedFile.type || 'unknown type'} · {formatMediaBytes(selectedFile.size)}
          </p>
        )}
        {uploading && (
          <div className="admin-upload-progress" role="status">
            <progress value={progress} max="100">{progress}%</progress>
            <span>{progress}% uploaded</span>
          </div>
        )}
        <div className="admin-turn-actions">
          <button className="button" type="button" onClick={() => void handleUpload()} disabled={!selectedFile || uploading}>
            {uploading ? 'uploading…' : 'upload media'}
          </button>
          {uploading && (
            <button className="button button-secondary" type="button" onClick={() => activeUpload.current?.cancel()}>
              cancel upload
            </button>
          )}
        </div>
      </div>

      {loading && media.length === 0 ? (
        <p role="status">loading founder media…</p>
      ) : media.length === 0 ? (
        <p className="empty-state">no founder media has been uploaded.</p>
      ) : (
        <ul className="admin-media-list">
          {media.map((item) => (
            <li key={item.path} className="admin-media-item">
              <MediaPreview media={item} />
              <div className="admin-media-details">
                <strong>{item.name}</strong>
                <span>{item.contentType} · {formatMediaBytes(item.size)}</span>
                {item.createdAt && <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>}
                <code>{item.path}</code>
                <a href={item.downloadUrl} target="_blank" rel="noreferrer">open public media url</a>
                <div className="admin-turn-actions">
                  <button className="button button-secondary admin-action" type="button" onClick={() => void copy(item.path, 'storage path')}>copy path</button>
                  <button className="button button-secondary admin-action" type="button" onClick={() => void copy(item.downloadUrl, 'download url')}>copy url</button>
                  <button className="button button-danger-secondary admin-action" type="button" onClick={() => void handleDelete(item)}>delete</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
