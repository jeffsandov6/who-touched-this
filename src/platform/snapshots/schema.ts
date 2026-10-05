import { CONTRIBUTION_BOUNDARIES } from '../config/contribution-boundaries.ts';

export const SNAPSHOT_MANIFEST_SCHEMA_VERSION = 2 as const;
export const SNAPSHOT_METADATA_SCHEMA_VERSION = 2 as const;
export const SNAPSHOT_SCREENSHOT_MAX_BYTES = 20 * 1024 * 1024;
export const SNAPSHOT_BUNDLE_MAX_BYTES = 250 * 1024 * 1024;
export const SNAPSHOT_MANIFEST_MAX_BYTES = 1024 * 1024;
export const SNAPSHOT_CAPTURE_ID = /^[A-Za-z0-9-]{1,100}$/;
export const SNAPSHOT_SHA256 = /^[0-9a-f]{64}$/;
export const SNAPSHOT_GIT_SHA = /^[0-9a-f]{40}$/;

export interface SnapshotTileRecord { index: number; y: number; width: number; height: number; path: string; sha256: string; bytes: number }
export interface SnapshotTiledSideRecord { width: number; height: number; tiles: SnapshotTileRecord[] }
export interface SnapshotLegacySideRecord { path: string; sha256: string }
export interface SnapshotManifestRouteV2 { route: string; key: string; before: SnapshotTiledSideRecord; after: SnapshotTiledSideRecord }
export interface SnapshotManifestRouteV1 { route: string; key: string; before: SnapshotLegacySideRecord; after: SnapshotLegacySideRecord }

interface SnapshotManifestBase {
  contributionNumber: number; contributionLabel: string; captureId: string; capturedAt: string;
  git: { before: string; after: string }; routeRegistry: { path: string; revision: string };
  canonicalRoutes: string[]; additionalRoutes: string[]; capturedRoutes: string[];
}
export interface SnapshotManifestV1 extends SnapshotManifestBase {
  schemaVersion: 1;
  capture: { viewport: { width: number; height: number }; deviceScaleFactor: number; fullPage: true; format: string; locale: string; timezoneId: string; waitMs: number };
  screenshots: SnapshotManifestRouteV1[];
}
export interface SnapshotManifestV2 extends SnapshotManifestBase {
  schemaVersion: 2;
  capture: {
    viewport: { width: number; height: number }; deviceScaleFactor: number; captureMode: 'tiled-document'; tileHeight: number;
    format: string; locale: string; timezoneId: string; waitMs: number; maximumTileCount: number;
    maximumTotalScreenshotPixels: number; maximumTotalScreenshotBytes: number;
  };
  screenshots: SnapshotManifestRouteV2[];
}
export type SnapshotManifest = SnapshotManifestV1 | SnapshotManifestV2;

export function formatSnapshotContributionNumber(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('contribution number must be a non-negative safe integer.');
  return String(value).padStart(3, '0');
}

export function normalizeArchivedRoute(value: unknown): string {
  if (typeof value !== 'string' || !value || value !== value.trim() || !value.startsWith('/') || value.includes('//')
    || value.includes('\\') || value.includes('%') || /[\u0000-\u001f\u007f?#]/.test(value)) throw new Error('snapshot route must be a normalized local path.');
  const normalized = value === '/' ? '/' : value.replace(/\/+$/, '');
  if (CONTRIBUTION_BOUNDARIES.reservedPublicRoutes.some((route) => normalized === route || normalized.startsWith(`${route}/`))) throw new Error('snapshot route cannot be a protected operational route.');
  return normalized;
}

export function assertSafeArchiveRelativePath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.startsWith('\\') || value.includes('\\')
    || value.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('snapshot file path must be a safe portable relative path.');
  return value;
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is malformed.`);
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new Error(`${label} contains unsupported fields.`);
}
function routeArray(value: unknown, label: string, allowEmpty: boolean): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw new Error(`${label} is malformed.`);
  const routes = value.map(normalizeArchivedRoute);
  if (new Set(routes).size !== routes.length) throw new Error(`${label} contains duplicate routes.`);
  return routes;
}
function validateIdentity(manifest: Record<string, unknown>) {
  const contributionNumber = manifest.contributionNumber;
  if (typeof contributionNumber !== 'number' || manifest.contributionLabel !== formatSnapshotContributionNumber(contributionNumber)) throw new Error('snapshot contribution identity is malformed.');
  if (typeof manifest.captureId !== 'string' || !SNAPSHOT_CAPTURE_ID.test(manifest.captureId)) throw new Error('snapshot capture id is malformed.');
  if (typeof manifest.capturedAt !== 'string' || !Number.isFinite(Date.parse(manifest.capturedAt))) throw new Error('snapshot capture timestamp is malformed.');
  const git = asObject(manifest.git, 'snapshot git metadata');
  exactKeys(git, ['before', 'after'], 'snapshot git metadata');
  if (typeof git.before !== 'string' || typeof git.after !== 'string' || !SNAPSHOT_GIT_SHA.test(git.before) || !SNAPSHOT_GIT_SHA.test(git.after) || git.before === git.after) throw new Error('snapshot git revisions are malformed.');
  const routeRegistry = asObject(manifest.routeRegistry, 'snapshot route registry');
  exactKeys(routeRegistry, ['path', 'revision'], 'snapshot route registry');
  if (routeRegistry.path !== 'src/platform/config/editable-routes.json' || routeRegistry.revision !== git.after) throw new Error('snapshot route-registry metadata is malformed.');
  const canonicalRoutes = routeArray(manifest.canonicalRoutes, 'canonical routes', false);
  const additionalRoutes = routeArray(manifest.additionalRoutes, 'additional routes', true);
  const capturedRoutes = routeArray(manifest.capturedRoutes, 'captured routes', false);
  if (new Set([...canonicalRoutes, ...additionalRoutes]).size !== capturedRoutes.length || JSON.stringify([...canonicalRoutes, ...additionalRoutes]) !== JSON.stringify(capturedRoutes)) throw new Error('snapshot route metadata disagrees.');
  return { contributionNumber, git, routeRegistry, canonicalRoutes, additionalRoutes, capturedRoutes };
}
function validateCommonCapture(capture: Record<string, unknown>) {
  const viewport = asObject(capture.viewport, 'snapshot viewport');
  exactKeys(viewport, ['width', 'height'], 'snapshot viewport');
  if (!Number.isSafeInteger(viewport.width) || !Number.isSafeInteger(viewport.height) || Number(viewport.width) < 1 || Number(viewport.height) < 1
    || capture.deviceScaleFactor !== 1 || capture.format !== 'png' || typeof capture.locale !== 'string' || typeof capture.timezoneId !== 'string'
    || !Number.isSafeInteger(capture.waitMs) || Number(capture.waitMs) < 0 || Number(capture.waitMs) > 10_000) throw new Error('snapshot capture configuration is malformed.');
}
function validateRouteHeader(record: Record<string, unknown>, route: string, seenKeys: Set<string>): string {
  if (record.route !== route || typeof record.key !== 'string' || !/^[A-Za-z0-9_-]{1,180}$/.test(record.key) || seenKeys.has(record.key)) throw new Error('snapshot route & screenshot records disagree.');
  seenKeys.add(record.key);
  return record.key;
}

export function validateSnapshotManifest(value: unknown): SnapshotManifest {
  const manifest = asObject(value, 'snapshot manifest');
  exactKeys(manifest, ['schemaVersion', 'contributionNumber', 'contributionLabel', 'captureId', 'capturedAt', 'git', 'routeRegistry', 'canonicalRoutes', 'additionalRoutes', 'capturedRoutes', 'capture', 'screenshots'], 'snapshot manifest');
  if (manifest.schemaVersion !== 1 && manifest.schemaVersion !== 2) throw new Error('unsupported snapshot manifest schema.');
  const common = validateIdentity(manifest);
  const capture = asObject(manifest.capture, 'snapshot capture configuration');
  validateCommonCapture(capture);
  if (!Array.isArray(manifest.screenshots) || manifest.screenshots.length !== common.capturedRoutes.length) throw new Error('snapshot route & screenshot records disagree.');
  const seenKeys = new Set<string>();
  if (manifest.schemaVersion === 1) {
    exactKeys(capture, ['viewport', 'deviceScaleFactor', 'fullPage', 'format', 'locale', 'timezoneId', 'waitMs'], 'snapshot capture configuration');
    if (capture.fullPage !== true) throw new Error('snapshot capture configuration is malformed.');
    const screenshots = manifest.screenshots.map((item, index) => {
      const record = asObject(item, 'snapshot screenshot record');
      exactKeys(record, ['route', 'key', 'before', 'after'], 'snapshot screenshot record');
      const key = validateRouteHeader(record, common.capturedRoutes[index], seenKeys);
      const sides = Object.fromEntries(['before', 'after'].map((side) => {
        const image = asObject(record[side], `${side} screenshot`);
        exactKeys(image, ['path', 'sha256'], `${side} screenshot`);
        const path = assertSafeArchiveRelativePath(image.path);
        if (path !== `${side}/${key}.png` || typeof image.sha256 !== 'string' || !SNAPSHOT_SHA256.test(image.sha256)) throw new Error('snapshot screenshot metadata disagrees.');
        return [side, { path, sha256: image.sha256 }];
      }));
      return { route: record.route as string, key, before: sides.before, after: sides.after } as SnapshotManifestRouteV1;
    });
    return { ...manifest, ...common, schemaVersion: 1, capture, screenshots } as unknown as SnapshotManifestV1;
  }
  exactKeys(capture, ['viewport', 'deviceScaleFactor', 'captureMode', 'tileHeight', 'format', 'locale', 'timezoneId', 'waitMs', 'maximumTileCount', 'maximumTotalScreenshotPixels', 'maximumTotalScreenshotBytes'], 'snapshot capture configuration');
  if (capture.captureMode !== 'tiled-document' || capture.tileHeight !== 3_600 || capture.maximumTileCount !== 64
    || capture.maximumTotalScreenshotPixels !== 384_000_000 || capture.maximumTotalScreenshotBytes !== 160 * 1024 * 1024) throw new Error('snapshot tiled capture configuration is malformed.');
  const screenshots = manifest.screenshots.map((item, routeIndex) => {
    const record = asObject(item, 'snapshot screenshot record');
    exactKeys(record, ['route', 'key', 'before', 'after'], 'snapshot screenshot record');
    const key = validateRouteHeader(record, common.capturedRoutes[routeIndex], seenKeys);
    const sides = Object.fromEntries(['before', 'after'].map((side) => {
      const sideRecord = asObject(record[side], `${side} screenshot`);
      exactKeys(sideRecord, ['width', 'height', 'tiles'], `${side} screenshot`);
      if (!Number.isSafeInteger(sideRecord.width) || !Number.isSafeInteger(sideRecord.height) || Number(sideRecord.width) < 1 || Number(sideRecord.width) > 2_880 || Number(sideRecord.height) < 1
        || !Array.isArray(sideRecord.tiles) || sideRecord.tiles.length < 1 || sideRecord.tiles.length > 64) throw new Error('snapshot tiled side is malformed.');
      const tileValues = sideRecord.tiles as unknown[];
      let nextY = 0;
      let totalBytes = 0;
      const tiles = tileValues.map((tileValue, tileIndex) => {
        const tile = asObject(tileValue, 'snapshot tile');
        exactKeys(tile, ['index', 'y', 'width', 'height', 'path', 'sha256', 'bytes'], 'snapshot tile');
        const path = assertSafeArchiveRelativePath(tile.path);
        const expectedPath = `${side}/${key}/tile-${String(tileIndex).padStart(3, '0')}.png`;
        if (tile.index !== tileIndex || tile.y !== nextY || tile.y !== tileIndex * 3_600 || tile.width !== sideRecord.width || !Number.isSafeInteger(tile.height) || Number(tile.height) < 1 || Number(tile.height) > 3_600
          || (tileIndex < tileValues.length - 1 && tile.height !== 3_600)
          || path !== expectedPath || typeof tile.sha256 !== 'string' || !SNAPSHOT_SHA256.test(tile.sha256) || !Number.isSafeInteger(tile.bytes) || Number(tile.bytes) < 1 || Number(tile.bytes) > SNAPSHOT_SCREENSHOT_MAX_BYTES) throw new Error('snapshot tile metadata disagrees.');
        nextY += Number(tile.height);
        totalBytes += Number(tile.bytes);
        return { index: tileIndex, y: tile.y as number, width: tile.width as number, height: tile.height as number, path, sha256: tile.sha256, bytes: tile.bytes as number };
      });
      if (nextY !== sideRecord.height || Number(sideRecord.width) * Number(sideRecord.height) > 384_000_000 || totalBytes > 160 * 1024 * 1024) throw new Error('snapshot tiles do not continuously cover the page or exceed resource bounds.');
      return [side, { width: sideRecord.width, height: sideRecord.height, tiles }];
    }));
    return { route: record.route as string, key, before: sides.before, after: sides.after } as SnapshotManifestRouteV2;
  });
  return { ...manifest, ...common, schemaVersion: 2, capture, screenshots } as unknown as SnapshotManifestV2;
}

export function snapshotSideTiles(side: SnapshotLegacySideRecord | SnapshotTiledSideRecord): Array<SnapshotLegacySideRecord | SnapshotTileRecord> {
  return 'tiles' in side ? side.tiles : [side];
}
