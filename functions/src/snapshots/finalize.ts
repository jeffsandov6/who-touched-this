import { githubIdFromAuthToken } from '../email/retry-invitation.js';
import { createHash } from 'node:crypto';

const SCREENSHOT_MAX_BYTES = 20 * 1024 * 1024;
const MANIFEST_MAX_BYTES = 1024 * 1024;
const BUNDLE_SCREENSHOT_MAX_BYTES = 250 * 1024 * 1024;
const CAPTURE_ID = /^[A-Za-z0-9-]{1,100}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const ROUTE_KEY = /^[A-Za-z0-9_-]{1,180}$/;

export type SnapshotFinalizeErrorCode = 'unauthenticated' | 'permission-denied' | 'invalid-argument' | 'failed-precondition' | 'not-found';

export class SnapshotFinalizeError extends Error {
  constructor(public readonly code: SnapshotFinalizeErrorCode, message: string) {
    super(message);
    this.name = 'SnapshotFinalizeError';
  }
}

interface ObjectMetadata {
  path: string;
  size: number;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface SnapshotFinalizeDependencies {
  loadAdmin(githubUserId: string): Promise<Record<string, unknown> | null>;
  loadArchiveState(contributionNumber: number): Promise<{
    contribution: Record<string, unknown> | null;
    snapshot: Record<string, unknown> | null;
    privateSite: Record<string, unknown> | null;
  }>;
  loadObject(path: string): Promise<{ metadata: ObjectMetadata; contents?: Buffer } | null>;
  listObjects(prefix: string): Promise<string[]>;
  commitFinalization(input: {
    contributionNumber: number;
    captureId: string;
    beforeGitSha: string;
    afterGitSha: string;
    snapshot: Record<string, unknown>;
  }): Promise<'finalized' | 'already_finalized'>;
  archivedAt(): unknown;
}

function contributionLabel(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new SnapshotFinalizeError('invalid-argument', 'contribution number is invalid.');
  return String(value).padStart(3, '0');
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SnapshotFinalizeError('failed-precondition', `${label} is malformed.`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new SnapshotFinalizeError('failed-precondition', `${label} contains unsupported fields.`);
  }
}

function route(value: unknown): string {
  if (typeof value !== 'string' || !value || value !== value.trim() || !value.startsWith('/')
    || value.includes('//') || value.includes('\\') || value.includes('%')
    || /[\u0000-\u001f\u007f?#]/.test(value)) throw new SnapshotFinalizeError('failed-precondition', 'archive route is malformed.');
  const normalized = value === '/' ? '/' : value.replace(/\/+$/, '');
  if (['/admin', '/api', '/auth', '/history', '/join', '/faq', '/rules'].some((reserved) => normalized === reserved || normalized.startsWith(`${reserved}/`))) {
    throw new SnapshotFinalizeError('failed-precondition', 'archive route is protected.');
  }
  return normalized;
}

function routes(value: unknown, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw new SnapshotFinalizeError('failed-precondition', 'archive routes are malformed.');
  const normalized = value.map(route);
  if (new Set(normalized).size !== normalized.length) throw new SnapshotFinalizeError('failed-precondition', 'archive routes contain duplicates.');
  return normalized;
}

function parseManifest(raw: Buffer, contributionNumber: number, captureId: string) {
  let value: unknown;
  try { value = JSON.parse(raw.toString('utf8')); }
  catch { throw new SnapshotFinalizeError('failed-precondition', 'uploaded manifest is malformed.'); }
  const manifest = object(value, 'uploaded manifest');
  exactKeys(manifest, [
    'schemaVersion', 'contributionNumber', 'contributionLabel', 'captureId', 'capturedAt',
    'git', 'routeRegistry', 'canonicalRoutes', 'additionalRoutes', 'capturedRoutes',
    'capture', 'screenshots',
  ], 'uploaded manifest');
  if (manifest.schemaVersion !== 1 && manifest.schemaVersion !== 2) throw new SnapshotFinalizeError('failed-precondition', 'uploaded manifest schema is unsupported.');
  if (manifest.contributionNumber !== contributionNumber || manifest.contributionLabel !== contributionLabel(contributionNumber)
    || manifest.captureId !== captureId) throw new SnapshotFinalizeError('failed-precondition', 'uploaded manifest identity does not match the archive.');
  if (typeof manifest.capturedAt !== 'string' || !Number.isFinite(Date.parse(manifest.capturedAt))) {
    throw new SnapshotFinalizeError('failed-precondition', 'manifest capture timestamp is malformed.');
  }
  const git = object(manifest.git, 'manifest git metadata');
  exactKeys(git, ['before', 'after'], 'manifest git metadata');
  if (typeof git.before !== 'string' || typeof git.after !== 'string' || !GIT_SHA.test(git.before)
    || !GIT_SHA.test(git.after) || git.before === git.after) throw new SnapshotFinalizeError('failed-precondition', 'manifest git metadata is malformed.');
  const routeRegistry = object(manifest.routeRegistry, 'manifest route registry');
  exactKeys(routeRegistry, ['path', 'revision'], 'manifest route registry');
  if (routeRegistry.path !== 'src/platform/config/editable-routes.json' || routeRegistry.revision !== git.after) {
    throw new SnapshotFinalizeError('failed-precondition', 'manifest route registry is malformed.');
  }
  const canonicalRoutes = routes(manifest.canonicalRoutes);
  const additionalRoutes = routes(manifest.additionalRoutes, true);
  const capturedRoutes = routes(manifest.capturedRoutes);
  if (new Set([...canonicalRoutes, ...additionalRoutes]).size !== capturedRoutes.length
    || JSON.stringify([...canonicalRoutes, ...additionalRoutes]) !== JSON.stringify(capturedRoutes)) {
    throw new SnapshotFinalizeError('failed-precondition', 'manifest route metadata disagrees.');
  }
  if (!Array.isArray(manifest.screenshots) || manifest.screenshots.length !== capturedRoutes.length) {
    throw new SnapshotFinalizeError('failed-precondition', 'manifest screenshot records disagree.');
  }
  const capture = object(manifest.capture, 'manifest capture configuration');
  exactKeys(capture, manifest.schemaVersion === 1
    ? ['viewport', 'deviceScaleFactor', 'fullPage', 'format', 'locale', 'timezoneId', 'waitMs']
    : ['viewport', 'deviceScaleFactor', 'captureMode', 'tileHeight', 'format', 'locale', 'timezoneId', 'waitMs', 'maximumTileCount', 'maximumTotalScreenshotPixels', 'maximumTotalScreenshotBytes'], 'manifest capture configuration');
  const viewport = object(capture.viewport, 'manifest viewport');
  exactKeys(viewport, ['width', 'height'], 'manifest viewport');
  if (!Number.isSafeInteger(viewport.width) || !Number.isSafeInteger(viewport.height)
    || Number(viewport.width) < 1 || Number(viewport.height) < 1 || capture.deviceScaleFactor !== 1
    || (manifest.schemaVersion === 1 ? capture.fullPage !== true : capture.captureMode !== 'tiled-document' || capture.tileHeight !== 3_600
      || capture.maximumTileCount !== 64 || capture.maximumTotalScreenshotPixels !== 384_000_000 || capture.maximumTotalScreenshotBytes !== 160 * 1024 * 1024)
    || capture.format !== 'png' || typeof capture.locale !== 'string'
    || typeof capture.timezoneId !== 'string' || !Number.isSafeInteger(capture.waitMs)
    || Number(capture.waitMs) < 0 || Number(capture.waitMs) > 10_000) {
    throw new SnapshotFinalizeError('failed-precondition', 'manifest capture configuration is malformed.');
  }
  const keys = new Set<string>();
  const screenshotRecords = manifest.screenshots.map((entry, index) => {
    const record = object(entry, 'manifest screenshot record');
    exactKeys(record, ['route', 'key', 'before', 'after'], 'manifest screenshot record');
    if (record.route !== capturedRoutes[index] || typeof record.key !== 'string' || !ROUTE_KEY.test(record.key) || keys.has(record.key)) {
      throw new SnapshotFinalizeError('failed-precondition', 'manifest screenshot records disagree.');
    }
    keys.add(record.key);
    const sides = Object.fromEntries(['before', 'after'].map((side) => {
      const item = object(record[side], 'manifest screenshot side');
      if (manifest.schemaVersion === 1) {
        exactKeys(item, ['path', 'sha256'], 'manifest screenshot side');
        const expectedPath = `${side}/${record.key}.png`;
        if (item.path !== expectedPath || typeof item.sha256 !== 'string' || !SHA256.test(item.sha256)) throw new SnapshotFinalizeError('failed-precondition', 'manifest screenshot side is malformed.');
        return [side, { width: null, height: null, tiles: [{ path: expectedPath, sha256: item.sha256 }] }];
      }
      exactKeys(item, ['width', 'height', 'tiles'], 'manifest screenshot side');
      if (!Number.isSafeInteger(item.width) || Number(item.width) < 1 || Number(item.width) > 2_880 || !Number.isSafeInteger(item.height) || Number(item.height) < 1
        || !Array.isArray(item.tiles) || item.tiles.length < 1 || item.tiles.length > 64) throw new SnapshotFinalizeError('failed-precondition', 'manifest tiled screenshot side is malformed.');
      const tileValues = item.tiles as unknown[];
      let nextY = 0;
      let totalBytes = 0;
      const tiles = tileValues.map((value, tileIndex) => {
        const tile = object(value, 'manifest screenshot tile');
        exactKeys(tile, ['index', 'y', 'width', 'height', 'path', 'sha256', 'bytes'], 'manifest screenshot tile');
        const expectedPath = `${side}/${record.key}/tile-${String(tileIndex).padStart(3, '0')}.png`;
        if (tile.index !== tileIndex || tile.y !== nextY || tile.y !== tileIndex * 3_600 || tile.width !== item.width || !Number.isSafeInteger(tile.height) || Number(tile.height) < 1 || Number(tile.height) > 3_600
          || (tileIndex < tileValues.length - 1 && tile.height !== 3_600)
          || tile.path !== expectedPath || typeof tile.sha256 !== 'string' || !SHA256.test(tile.sha256) || !Number.isSafeInteger(tile.bytes) || Number(tile.bytes) < 1 || Number(tile.bytes) > SCREENSHOT_MAX_BYTES) throw new SnapshotFinalizeError('failed-precondition', 'manifest screenshot tile is malformed.');
        nextY += Number(tile.height);
        totalBytes += Number(tile.bytes);
        return { index: tileIndex, y: tile.y as number, width: tile.width as number, height: tile.height as number, path: expectedPath, sha256: tile.sha256 as string, bytes: tile.bytes as number };
      });
      if (nextY !== item.height || Number(item.width) * Number(item.height) > 384_000_000 || totalBytes > 160 * 1024 * 1024) throw new SnapshotFinalizeError('failed-precondition', 'manifest screenshot tiles do not continuously cover the page or exceed bounds.');
      return [side, { width: item.width, height: item.height, tiles }];
    }));
    return { route: record.route as string, routeKey: record.key, before: sides.before, after: sides.after };
  });
  return { schemaVersion: manifest.schemaVersion as 1 | 2, git: git as { before: string; after: string }, canonicalRoutes, additionalRoutes, capturedRoutes, screenshotRecords, viewport, capture };
}

function validateObject(metadata: ObjectMetadata, expected: { path: string; type: string; max: number; custom: Record<string, string> }): void {
  if (metadata.path !== expected.path || metadata.contentType !== expected.type
    || !Number.isSafeInteger(metadata.size) || metadata.size <= 0 || metadata.size > expected.max
    || Object.entries(expected.custom).some(([key, value]) => metadata.metadata?.[key] !== value)) {
    throw new SnapshotFinalizeError('failed-precondition', `archive object validation failed: ${expected.path}`);
  }
}

export async function finalizeSnapshotArchiveRequest(
  authToken: Record<string, unknown> | null,
  input: unknown,
  dependencies: SnapshotFinalizeDependencies,
): Promise<{ status: 'finalized' | 'already_finalized'; contributionNumber: number }> {
  if (!authToken) throw new SnapshotFinalizeError('unauthenticated', 'authentication is required.');
  const githubUserId = githubIdFromAuthToken(authToken);
  if (!githubUserId) throw new SnapshotFinalizeError('permission-denied', 'access denied.');
  const admin = await dependencies.loadAdmin(githubUserId);
  if (!admin || admin.githubUserId !== githubUserId || admin.active !== true || !['owner', 'admin'].includes(String(admin.role))) {
    throw new SnapshotFinalizeError('permission-denied', 'access denied.');
  }
  const request = object(input, 'finalization request');
  if (Object.keys(request).sort().join(',') !== 'captureId,contributionNumber'
    || typeof request.contributionNumber !== 'number' || typeof request.captureId !== 'string'
    || !CAPTURE_ID.test(request.captureId)) throw new SnapshotFinalizeError('invalid-argument', 'finalization request is invalid.');
  const number = request.contributionNumber;
  const label = contributionLabel(number);
  const captureId = request.captureId;
  const state = await dependencies.loadArchiveState(number);
  if (!state.contribution) throw new SnapshotFinalizeError('not-found', 'permanent contribution does not exist.');
  const contributionBefore = state.contribution.beforeGitSha;
  const contributionAfter = state.contribution.afterGitSha;
  if (state.snapshot) {
    if (state.contribution.archiveStatus === 'finalized'
      && state.snapshot.captureId === captureId
      && state.snapshot.contributionNumber === number
      && state.snapshot.beforeGitSha === contributionBefore
      && state.snapshot.afterGitSha === contributionAfter
      && (state.privateSite?.pendingArchiveContributionNumber ?? null) !== number) {
      return { status: 'already_finalized', contributionNumber: number };
    }
    throw new SnapshotFinalizeError('failed-precondition', 'this contribution already has a different finalized snapshot archive.');
  }
  if (state.contribution.archiveStatus !== 'pending'
    || typeof contributionBefore !== 'string' || typeof contributionAfter !== 'string'
    || !GIT_SHA.test(contributionBefore) || !GIT_SHA.test(contributionAfter)
    || contributionBefore === contributionAfter) {
    throw new SnapshotFinalizeError('failed-precondition', 'contribution archive provenance is invalid.');
  }
  if (state.privateSite?.pendingArchiveContributionNumber !== number) {
    throw new SnapshotFinalizeError('failed-precondition', 'the pending archive relay lock does not match this contribution.');
  }
  const prefix = `public/history/contributions/${label}/${captureId}`;
  const manifestPath = `${prefix}/manifest.json`;
  const manifestObject = await dependencies.loadObject(manifestPath);
  if (!manifestObject?.contents) throw new SnapshotFinalizeError('failed-precondition', 'uploaded manifest is missing.');
  validateObject(manifestObject.metadata, {
    path: manifestPath, type: 'application/json', max: MANIFEST_MAX_BYTES,
    custom: { contributionNumber: String(number), contributionLabel: label, captureId },
  });
  if (manifestObject.metadata.size !== manifestObject.contents.length) {
    throw new SnapshotFinalizeError('failed-precondition', 'uploaded manifest size metadata disagrees with its contents.');
  }
  const manifest = parseManifest(manifestObject.contents, number, captureId);
  if (manifest.git.before !== contributionBefore || manifest.git.after !== contributionAfter) {
    throw new SnapshotFinalizeError('failed-precondition', 'manifest Git revisions do not match the accepted contribution.');
  }
  const publicRoutes = [];
  const expectedPaths = [manifestPath];
  let archiveScreenshotBytes = 0;
  for (const record of manifest.screenshotRecords) {
    const publicRecord: Record<string, unknown> = { route: record.route, routeKey: record.routeKey };
    for (const side of ['before', 'after'] as const) {
      const sideRecord = record[side];
      const publicTiles = [];
      for (const item of sideRecord.tiles) {
        const path = `${prefix}/${item.path}`;
        expectedPaths.push(path);
        const objectRecord = await dependencies.loadObject(path);
        if (!objectRecord) throw new SnapshotFinalizeError('failed-precondition', `archive screenshot is missing: ${item.path}`);
        validateObject(objectRecord.metadata, {
          path, type: 'image/png', max: SCREENSHOT_MAX_BYTES,
          custom: { contributionNumber: String(number), contributionLabel: label, captureId, routeKey: record.routeKey, side, sha256: item.sha256, ...(manifest.schemaVersion === 2 ? { tileIndex: String(item.index) } : {}) },
        });
        if (manifest.schemaVersion === 2 && objectRecord.metadata.size !== item.bytes) throw new SnapshotFinalizeError('failed-precondition', `archive screenshot byte length disagrees: ${item.path}`);
        archiveScreenshotBytes += objectRecord.metadata.size;
        if (archiveScreenshotBytes > BUNDLE_SCREENSHOT_MAX_BYTES) throw new SnapshotFinalizeError('failed-precondition', 'archive screenshots exceed total bundle bounds.');
        publicTiles.push({ storagePath: path, sha256: item.sha256, ...('index' in item ? { index: item.index, y: item.y, width: item.width, height: item.height } : {}) });
      }
      publicRecord[side] = manifest.schemaVersion === 1 ? publicTiles[0] : { width: sideRecord.width, height: sideRecord.height, tiles: publicTiles };
    }
    publicRoutes.push(publicRecord);
  }
  const actualPaths = (await dependencies.listObjects(prefix)).sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths.sort())) {
    throw new SnapshotFinalizeError('failed-precondition', 'archive object count or paths do not match the manifest.');
  }
  const snapshot = {
    schemaVersion: manifest.schemaVersion,
    contributionNumber: number,
    captureId,
    beforeGitSha: manifest.git.before,
    afterGitSha: manifest.git.after,
    canonicalRoutes: manifest.canonicalRoutes,
    additionalRoutes: manifest.additionalRoutes,
    capturedRoutes: manifest.capturedRoutes,
    routes: publicRoutes,
    manifestStoragePath: manifestPath,
    manifestSha256: createHash('sha256').update(manifestObject.contents).digest('hex'),
    viewport: {
      width: manifest.viewport.width,
      height: manifest.viewport.height,
      deviceScaleFactor: manifest.capture.deviceScaleFactor,
      ...(manifest.schemaVersion === 1 ? { fullPage: true } : { captureMode: 'tiled-document', tileHeight: 3_600 }),
    },
    archivedAt: dependencies.archivedAt(),
  };
  const status = await dependencies.commitFinalization({
    contributionNumber: number,
    captureId,
    beforeGitSha: manifest.git.before,
    afterGitSha: manifest.git.after,
    snapshot,
  });
  return { status, contributionNumber: number };
}
