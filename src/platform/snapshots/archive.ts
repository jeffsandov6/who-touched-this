import {
  SNAPSHOT_MANIFEST_MAX_BYTES,
  SNAPSHOT_SCREENSHOT_MAX_BYTES,
  assertSafeArchiveRelativePath,
  formatSnapshotContributionNumber,
  validateSnapshotManifest,
  type SnapshotManifestV1,
} from './schema.ts';

export const SNAPSHOT_ARCHIVE_PREFIX = 'public/history/contributions';

export interface ValidatedSnapshotBundle {
  manifest: SnapshotManifestV1;
  manifestFile: File;
  screenshots: Map<string, File>;
  validChecksums: number;
}

function selectedPath(file: File): string {
  const candidate = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  if (candidate.startsWith('/') || candidate.startsWith('\\') || candidate.includes('\\')) {
    throw new Error('Selected bundle contains an unsafe file path.');
  }
  const parts = candidate.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Selected bundle contains an unsafe file path.');
  }
  return candidate;
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isPng(bytes: Uint8Array): boolean {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  return signature.every((byte, index) => bytes[index] === byte);
}

export async function validateSelectedSnapshotBundle(files: File[]): Promise<ValidatedSnapshotBundle> {
  if (files.length === 0) throw new Error('Choose a complete snapshot bundle directory.');
  const selected = files.map((file) => ({ file, path: selectedPath(file) }));
  const manifests = selected.filter(({ path }) => path === 'manifest.json' || path.endsWith('/manifest.json'));
  if (manifests.length !== 1) throw new Error('The selected directory must contain exactly one manifest.json.');
  const manifestSelection = manifests[0];
  if (manifestSelection.file.size <= 0 || manifestSelection.file.size > SNAPSHOT_MANIFEST_MAX_BYTES) {
    throw new Error('Snapshot manifest size is invalid.');
  }
  const root = manifestSelection.path.slice(0, -'manifest.json'.length);
  const relativeFiles = new Map<string, File>();
  for (const entry of selected) {
    if (!entry.path.startsWith(root)) continue;
    const relative = assertSafeArchiveRelativePath(entry.path.slice(root.length));
    if (relativeFiles.has(relative)) throw new Error(`Duplicate bundle file: ${relative}`);
    relativeFiles.set(relative, entry.file);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(await manifestSelection.file.text()); }
  catch { throw new Error('Snapshot manifest is not valid JSON.'); }
  const manifest = validateSnapshotManifest(parsed);
  const rootParts = root.replace(/\/$/, '').split('/');
  const selectedCaptureId = rootParts.at(-1);
  if (selectedCaptureId && selectedCaptureId !== manifest.captureId) {
    throw new Error('Selected directory capture ID does not match the manifest.');
  }
  const contributionDirectory = rootParts.at(-2);
  if (contributionDirectory?.startsWith('contribution-')
    && contributionDirectory !== `contribution-${manifest.contributionLabel}`) {
    throw new Error('Selected contribution directory does not match the manifest.');
  }
  const screenshots = new Map<string, File>();
  let validChecksums = 0;
  for (const record of manifest.screenshots) {
    for (const side of ['before', 'after'] as const) {
      const expected = record[side];
      const file = relativeFiles.get(expected.path);
      if (!file) throw new Error(`Expected screenshot is missing: ${expected.path}`);
      if (file.type !== 'image/png' || file.size <= 0 || file.size > SNAPSHOT_SCREENSHOT_MAX_BYTES
        || !isPng(new Uint8Array(await file.slice(0, 8).arrayBuffer()))) {
        throw new Error(`Expected screenshot is not an allowed PNG: ${expected.path}`);
      }
      if (await sha256(file) !== expected.sha256) throw new Error(`Screenshot checksum mismatch: ${expected.path}`);
      screenshots.set(expected.path, file);
      validChecksums += 1;
    }
  }
  return { manifest, manifestFile: manifestSelection.file, screenshots, validChecksums };
}

export function snapshotArchivePrefix(contributionNumber: number, captureId: string): string {
  const label = formatSnapshotContributionNumber(contributionNumber);
  if (!/^[A-Za-z0-9-]{1,100}$/.test(captureId)) throw new Error('Snapshot capture ID is invalid.');
  return `${SNAPSHOT_ARCHIVE_PREFIX}/${label}/${captureId}`;
}

export function snapshotArchiveObjectPath(manifest: SnapshotManifestV1, relativePath: string): string {
  return `${snapshotArchivePrefix(manifest.contributionNumber, manifest.captureId)}/${assertSafeArchiveRelativePath(relativePath)}`;
}

export function isAllowedPublicHistorySnapshotPath(path: string): boolean {
  return /^public\/history\/contributions\/(?:\d{3,})\/[A-Za-z0-9-]{1,100}\/(?:manifest\.json|(?:before|after)\/[A-Za-z0-9_-]{1,180}\.png)$/.test(path);
}
