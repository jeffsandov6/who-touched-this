export const FOUNDER_MEDIA_PREFIX = 'public/canvas/founder';
export const MAX_FOUNDER_MEDIA_BYTES = 500 * 1024 * 1024;
export const MAX_FOUNDER_MEDIA_MIB = 500;

const ASSET_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

export interface MediaFileLike {
  name: string;
  type: string;
  size: number;
}

export function isSupportedFounderMediaType(contentType: string): boolean {
  return /^(image|audio|video)\/[A-Za-z0-9][A-Za-z0-9.+-]*$/.test(contentType);
}

export function sanitizeMediaFileName(fileName: string): string {
  const normalized = fileName.normalize('NFKC').trim();
  if (!normalized || normalized.includes('/') || normalized.includes('\\') || normalized.includes('\0')) {
    throw new Error('The media filename is invalid.');
  }
  if (normalized === '.' || normalized === '..' || normalized.includes('..')) {
    throw new Error('The media filename cannot contain path traversal segments.');
  }

  const sanitized = normalized
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[._-]+/, '')
    .slice(0, 120)
    .replace(/[._-]+$/, '');

  if (!SAFE_FILE_NAME_PATTERN.test(sanitized)) {
    throw new Error('The media filename has no usable characters.');
  }
  return sanitized;
}

export function buildFounderMediaPath(assetId: string, fileName: string): string {
  if (!ASSET_ID_PATTERN.test(assetId)) throw new Error('The media asset ID is invalid.');
  return `${FOUNDER_MEDIA_PREFIX}/${assetId}/${sanitizeMediaFileName(fileName)}`;
}

export function isAllowedPublicCanvasMediaPath(storagePath: string): boolean {
  const parts = storagePath.split('/');
  return parts.length === 5
    && parts.slice(0, 3).join('/') === FOUNDER_MEDIA_PREFIX
    && ASSET_ID_PATTERN.test(parts[3] ?? '')
    && SAFE_FILE_NAME_PATTERN.test(parts[4] ?? '');
}

export function assertAllowedPublicCanvasMediaPath(storagePath: string): void {
  if (!isAllowedPublicCanvasMediaPath(storagePath)) {
    throw new Error('The requested path is not approved public canvas media.');
  }
}

export function validateFounderMediaFile(file: MediaFileLike): void {
  sanitizeMediaFileName(file.name);
  if (!isSupportedFounderMediaType(file.type)) {
    throw new Error('Choose an image, audio, or video file.');
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    throw new Error('The media file must not be empty.');
  }
  if (file.size > MAX_FOUNDER_MEDIA_BYTES) {
    throw new Error(`The media file must be ${MAX_FOUNDER_MEDIA_MIB} MiB or smaller.`);
  }
}

export function formatMediaBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}

export function formatUploadProgress(transferred: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((transferred / total) * 100)));
}
