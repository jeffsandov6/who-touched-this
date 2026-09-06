import { FirebaseError } from 'firebase/app';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
import {
  getMetadata,
  ref,
  uploadBytesResumable,
  type UploadTask,
} from 'firebase/storage';
import { connectFirebaseEmulatorOnce, getFirebaseApp } from './client';
import { getPlatformStorage } from './storage';
import { getDownloadURL } from 'firebase/storage';
import {
  snapshotArchiveObjectPath,
  type ValidatedSnapshotBundle,
  isAllowedPublicHistorySnapshotPath,
} from '../snapshots/archive';

export interface SnapshotArchiveUpload {
  cancel(): void;
  result: Promise<void>;
}

function functionsClient() {
  const functions = getFunctions(getFirebaseApp(), 'us-central1');
  if (import.meta.env.DEV && import.meta.env.PUBLIC_USE_FIREBASE_EMULATORS === 'true') {
    connectFirebaseEmulatorOnce('functions', () => connectFunctionsEmulator(functions, '127.0.0.1', 5001));
  }
  return functions;
}

async function existingObjectMatches(path: string, metadata: Record<string, string>): Promise<boolean> {
  try {
    const existing = await getMetadata(ref(getPlatformStorage(), path));
    return Object.entries(metadata).every(([key, value]) => existing.customMetadata?.[key] === value);
  } catch (error) {
    if (error instanceof FirebaseError && error.code === 'storage/object-not-found') return false;
    throw error;
  }
}

function uploadOne(path: string, file: Blob, contentType: string, customMetadata: Record<string, string>, onProgress: (fraction: number) => void) {
  const task = uploadBytesResumable(ref(getPlatformStorage(), path), file, { contentType, customMetadata });
  const result = new Promise<void>((resolve, reject) => task.on(
    'state_changed',
    (snapshot) => onProgress(snapshot.totalBytes ? snapshot.bytesTransferred / snapshot.totalBytes : 0),
    reject,
    resolve,
  ));
  return { task, result };
}

export function uploadSnapshotArchive(
  bundle: ValidatedSnapshotBundle,
  onProgress: (completed: number, total: number) => void,
): SnapshotArchiveUpload {
  const tasks = new Set<UploadTask>();
  let cancelled = false;
  const entries = [
    {
      relativePath: 'manifest.json', file: bundle.manifestFile, contentType: 'application/json',
      metadata: { contributionNumber: String(bundle.manifest.contributionNumber), contributionLabel: bundle.manifest.contributionLabel, captureId: bundle.manifest.captureId },
    },
    ...bundle.manifest.screenshots.flatMap((record) => (['before', 'after'] as const).map((side) => ({
      relativePath: record[side].path,
      file: bundle.screenshots.get(record[side].path)!,
      contentType: 'image/png',
      metadata: {
        contributionNumber: String(bundle.manifest.contributionNumber), contributionLabel: bundle.manifest.contributionLabel, captureId: bundle.manifest.captureId,
        routeKey: record.key, side, sha256: record[side].sha256,
      },
    }))),
  ];
  const result = (async () => {
    let completed = 0;
    onProgress(0, entries.length);
    for (const entry of entries) {
      if (cancelled) throw new Error('Snapshot archive upload was cancelled.');
      const path = snapshotArchiveObjectPath(bundle.manifest, entry.relativePath);
      if (await existingObjectMatches(path, entry.metadata)) {
        completed += 1;
        onProgress(completed, entries.length);
        continue;
      }
      const upload = uploadOne(path, entry.file, entry.contentType, entry.metadata, (fraction) => {
        onProgress(completed + fraction, entries.length);
      });
      tasks.add(upload.task);
      try { await upload.result; } finally { tasks.delete(upload.task); }
      completed += 1;
      onProgress(completed, entries.length);
    }
  })();
  return {
    cancel() { cancelled = true; for (const task of tasks) task.cancel(); },
    result,
  };
}

export async function finalizeSnapshotArchive(contributionNumber: number, captureId: string): Promise<void> {
  const callable = httpsCallable<{ contributionNumber: number; captureId: string }, { status: string }>(
    functionsClient(), 'finalizeSnapshotArchive',
  );
  await callable({ contributionNumber, captureId });
}

export async function getPublicHistorySnapshotUrl(storagePath: string): Promise<string> {
  if (!isAllowedPublicHistorySnapshotPath(storagePath)) throw new Error('Public History snapshot path is invalid.');
  return getDownloadURL(ref(getPlatformStorage(), storagePath));
}
