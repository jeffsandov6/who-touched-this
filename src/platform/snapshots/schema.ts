import { CONTRIBUTION_BOUNDARIES } from '../config/contribution-boundaries.ts';

export const SNAPSHOT_MANIFEST_SCHEMA_VERSION = 1 as const;
export const SNAPSHOT_METADATA_SCHEMA_VERSION = 1 as const;
export const SNAPSHOT_SCREENSHOT_MAX_BYTES = 20 * 1024 * 1024;
export const SNAPSHOT_MANIFEST_MAX_BYTES = 1024 * 1024;
export const SNAPSHOT_CAPTURE_ID = /^[A-Za-z0-9-]{1,100}$/;
export const SNAPSHOT_SHA256 = /^[0-9a-f]{64}$/;
export const SNAPSHOT_GIT_SHA = /^[0-9a-f]{40}$/;

export interface SnapshotSideRecord {
  path: string;
  sha256: string;
}

export interface SnapshotManifestRoute {
  route: string;
  key: string;
  before: SnapshotSideRecord;
  after: SnapshotSideRecord;
}

export interface SnapshotManifestV1 {
  schemaVersion: 1;
  contributionNumber: number;
  contributionLabel: string;
  captureId: string;
  capturedAt: string;
  git: { before: string; after: string };
  routeRegistry: { path: string; revision: string };
  canonicalRoutes: string[];
  additionalRoutes: string[];
  capturedRoutes: string[];
  capture: {
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
    fullPage: boolean;
    format: string;
    locale: string;
    timezoneId: string;
    waitMs: number;
  };
  screenshots: SnapshotManifestRoute[];
}

export function formatSnapshotContributionNumber(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Contribution number must be a non-negative safe integer.');
  }
  return String(value).padStart(3, '0');
}

export function normalizeArchivedRoute(value: unknown): string {
  if (typeof value !== 'string' || !value || value !== value.trim()
    || !value.startsWith('/') || value.includes('//') || value.includes('\\')
    || value.includes('%') || /[\u0000-\u001f\u007f?#]/.test(value)) {
    throw new Error('Snapshot route must be a normalized local path.');
  }
  const normalized = value === '/' ? '/' : value.replace(/\/+$/, '');
  const reserved = CONTRIBUTION_BOUNDARIES.reservedPublicRoutes.some(
    (route) => normalized === route || normalized.startsWith(`${route}/`),
  );
  if (reserved) throw new Error('Snapshot route cannot be a protected operational route.');
  return normalized;
}

export function assertSafeArchiveRelativePath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.startsWith('\\')
    || value.includes('\\') || value.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Snapshot file path must be a safe portable relative path.');
  }
  return value;
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is malformed.`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} contains unsupported fields.`);
}

function routeArray(value: unknown, label: string, allowEmpty: boolean): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw new Error(`${label} is malformed.`);
  const routes = value.map(normalizeArchivedRoute);
  if (new Set(routes).size !== routes.length) throw new Error(`${label} contains duplicate routes.`);
  return routes;
}

export function validateSnapshotManifest(value: unknown): SnapshotManifestV1 {
  const manifest = asObject(value, 'Snapshot manifest');
  exactKeys(manifest, [
    'schemaVersion', 'contributionNumber', 'contributionLabel', 'captureId', 'capturedAt',
    'git', 'routeRegistry', 'canonicalRoutes', 'additionalRoutes', 'capturedRoutes',
    'capture', 'screenshots',
  ], 'Snapshot manifest');
  if (manifest.schemaVersion !== SNAPSHOT_MANIFEST_SCHEMA_VERSION) throw new Error('Unsupported snapshot manifest schema.');
  const contributionNumber = manifest.contributionNumber;
  if (typeof contributionNumber !== 'number'
    || manifest.contributionLabel !== formatSnapshotContributionNumber(contributionNumber)) {
    throw new Error('Snapshot contribution identity is malformed.');
  }
  if (typeof manifest.captureId !== 'string' || !SNAPSHOT_CAPTURE_ID.test(manifest.captureId)) {
    throw new Error('Snapshot capture ID is malformed.');
  }
  if (typeof manifest.capturedAt !== 'string' || !Number.isFinite(Date.parse(manifest.capturedAt))) {
    throw new Error('Snapshot capture timestamp is malformed.');
  }
  const git = asObject(manifest.git, 'Snapshot Git metadata');
  exactKeys(git, ['before', 'after'], 'Snapshot Git metadata');
  if (typeof git.before !== 'string' || typeof git.after !== 'string'
    || !SNAPSHOT_GIT_SHA.test(git.before) || !SNAPSHOT_GIT_SHA.test(git.after)
    || git.before === git.after) throw new Error('Snapshot Git revisions are malformed.');
  const routeRegistry = asObject(manifest.routeRegistry, 'Snapshot route registry');
  exactKeys(routeRegistry, ['path', 'revision'], 'Snapshot route registry');
  if (routeRegistry.path !== 'src/platform/config/editable-routes.json'
    || routeRegistry.revision !== git.after) throw new Error('Snapshot route-registry metadata is malformed.');
  const canonicalRoutes = routeArray(manifest.canonicalRoutes, 'Canonical routes', false);
  const additionalRoutes = routeArray(manifest.additionalRoutes, 'Additional routes', true);
  const capturedRoutes = routeArray(manifest.capturedRoutes, 'Captured routes', false);
  const expectedRoutes = [...canonicalRoutes, ...additionalRoutes];
  if (new Set(expectedRoutes).size !== expectedRoutes.length
    || JSON.stringify(expectedRoutes) !== JSON.stringify(capturedRoutes)) {
    throw new Error('Snapshot route metadata disagrees.');
  }
  const capture = asObject(manifest.capture, 'Snapshot capture configuration');
  exactKeys(capture, ['viewport', 'deviceScaleFactor', 'fullPage', 'format', 'locale', 'timezoneId', 'waitMs'], 'Snapshot capture configuration');
  const viewport = asObject(capture.viewport, 'Snapshot viewport');
  exactKeys(viewport, ['width', 'height'], 'Snapshot viewport');
  if (!Number.isSafeInteger(viewport.width) || !Number.isSafeInteger(viewport.height)
    || Number(viewport.width) < 1 || Number(viewport.height) < 1
    || capture.deviceScaleFactor !== 1 || capture.fullPage !== true || capture.format !== 'png'
    || typeof capture.locale !== 'string' || typeof capture.timezoneId !== 'string'
    || !Number.isSafeInteger(capture.waitMs) || Number(capture.waitMs) < 0 || Number(capture.waitMs) > 10_000) {
    throw new Error('Snapshot capture configuration is malformed.');
  }
  if (!Array.isArray(manifest.screenshots) || manifest.screenshots.length !== capturedRoutes.length) {
    throw new Error('Snapshot route and screenshot records disagree.');
  }
  const seenKeys = new Set<string>();
  const screenshots = manifest.screenshots.map((item, index) => {
    const record = asObject(item, 'Snapshot screenshot record');
    exactKeys(record, ['route', 'key', 'before', 'after'], 'Snapshot screenshot record');
    if (record.route !== capturedRoutes[index] || typeof record.key !== 'string'
      || !/^[A-Za-z0-9_-]{1,180}$/.test(record.key) || seenKeys.has(record.key)) {
      throw new Error('Snapshot route and screenshot records disagree.');
    }
    seenKeys.add(record.key);
    const sides = Object.fromEntries(['before', 'after'].map((side) => {
      const sideRecord = asObject(record[side], `${side} screenshot`);
      exactKeys(sideRecord, ['path', 'sha256'], `${side} screenshot`);
      const path = assertSafeArchiveRelativePath(sideRecord.path);
      if (path !== `${side}/${record.key}.png` || typeof sideRecord.sha256 !== 'string'
        || !SNAPSHOT_SHA256.test(sideRecord.sha256)) throw new Error('Snapshot screenshot metadata disagrees.');
      return [side, { path, sha256: sideRecord.sha256 }];
    }));
    return { route: record.route, key: record.key, before: sides.before, after: sides.after } as SnapshotManifestRoute;
  });
  return {
    schemaVersion: 1, contributionNumber, contributionLabel: manifest.contributionLabel as string,
    captureId: manifest.captureId, capturedAt: manifest.capturedAt, git: git as SnapshotManifestV1['git'],
    routeRegistry: routeRegistry as SnapshotManifestV1['routeRegistry'], canonicalRoutes,
    additionalRoutes, capturedRoutes, capture: capture as unknown as SnapshotManifestV1['capture'], screenshots,
  };
}
