import {
  deleteObject,
  getDownloadURL,
  getMetadata,
  listAll,
  ref,
  uploadBytesResumable,
  type UploadTask,
} from 'firebase/storage';
import {
  FOUNDER_MEDIA_PREFIX,
  assertAllowedPublicCanvasMediaPath,
  buildFounderMediaPath,
  formatUploadProgress,
  isAllowedPublicCanvasMediaPath,
  validateFounderMediaFile,
} from '../media';
import { getPlatformStorage } from './storage';

export interface FounderMediaObject {
  name: string;
  path: string;
  contentType: string;
  size: number;
  createdAt: string | null;
  downloadUrl: string;
}

export interface FounderMediaUpload {
  cancel: () => boolean;
  result: Promise<FounderMediaObject>;
}

async function describeMediaObject(path: string): Promise<FounderMediaObject> {
  const objectReference = ref(getPlatformStorage(), path);
  const [metadata, downloadUrl] = await Promise.all([
    getMetadata(objectReference),
    getDownloadURL(objectReference),
  ]);
  return {
    name: objectReference.name,
    path: objectReference.fullPath,
    contentType: metadata.contentType ?? 'application/octet-stream',
    size: metadata.size,
    createdAt: metadata.timeCreated ?? null,
    downloadUrl,
  };
}

export function uploadFounderMedia(
  file: File,
  onProgress: (percentage: number) => void,
): FounderMediaUpload {
  validateFounderMediaFile(file);
  const path = buildFounderMediaPath(crypto.randomUUID(), file.name);
  const task: UploadTask = uploadBytesResumable(ref(getPlatformStorage(), path), file, {
    contentType: file.type,
  });

  const result = new Promise<FounderMediaObject>((resolve, reject) => {
    task.on(
      'state_changed',
      (snapshot) => onProgress(formatUploadProgress(snapshot.bytesTransferred, snapshot.totalBytes)),
      reject,
      () => void describeMediaObject(path).then(resolve, reject),
    );
  });

  return { cancel: () => task.cancel(), result };
}

export async function listFounderMedia(): Promise<FounderMediaObject[]> {
  const rootListing = await listAll(ref(getPlatformStorage(), FOUNDER_MEDIA_PREFIX));
  const assetListings = await Promise.all(rootListing.prefixes.map((prefix) => listAll(prefix)));
  const objects = await Promise.all(
    assetListings.flatMap((listing) => listing.items).map((item) => describeMediaObject(item.fullPath)),
  );
  return objects.sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? ''));
}

export async function deleteFounderMedia(storagePath: string): Promise<void> {
  if (!isAllowedPublicCanvasMediaPath(storagePath)) throw new Error('only founder canvas media can be deleted here.');
  await deleteObject(ref(getPlatformStorage(), storagePath));
}

/** Resolves only approved public canvas media paths; private/unexpected paths fail closed. */
export async function getPublicCanvasMediaUrl(storagePath: string): Promise<string> {
  assertAllowedPublicCanvasMediaPath(storagePath);
  return getDownloadURL(ref(getPlatformStorage(), storagePath));
}
