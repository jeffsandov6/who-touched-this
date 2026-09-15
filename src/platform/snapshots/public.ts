import type { Timestamp } from 'firebase/firestore';
import {
  SNAPSHOT_GIT_SHA,
  SNAPSHOT_METADATA_SCHEMA_VERSION,
  SNAPSHOT_SHA256,
  normalizeArchivedRoute,
} from './schema.ts';
import { isAllowedPublicHistorySnapshotPath } from './archive.ts';

export interface PublicSnapshotImage {
  storagePath: string;
  sha256: string;
}

export interface PublicSnapshotRoute {
  route: string;
  routeKey: string;
  before: PublicSnapshotImage;
  after: PublicSnapshotImage;
}

export interface PublicContributionSnapshot {
  schemaVersion: 1;
  contributionNumber: number;
  captureId: string;
  beforeGitSha: string;
  afterGitSha: string;
  canonicalRoutes: string[];
  additionalRoutes: string[];
  capturedRoutes: string[];
  routes: PublicSnapshotRoute[];
  manifestStoragePath: string;
  manifestSha256?: string;
  viewport: { width: number; height: number; deviceScaleFactor: number; fullPage: boolean };
  archivedAt: Date;
}

function dateFromTimestamp(value: unknown): Date | null {
  try {
    const date = (value as Timestamp | undefined)?.toDate();
    return date instanceof Date && Number.isFinite(date.getTime()) ? date : null;
  } catch { return null; }
}

export function parsePublicContributionSnapshot(value: unknown): PublicContributionSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (data.schemaVersion !== SNAPSHOT_METADATA_SCHEMA_VERSION || !Number.isSafeInteger(data.contributionNumber)
    || Number(data.contributionNumber) < 0 || typeof data.captureId !== 'string'
    || !SNAPSHOT_GIT_SHA.test(String(data.beforeGitSha)) || !SNAPSHOT_GIT_SHA.test(String(data.afterGitSha))
    || data.beforeGitSha === data.afterGitSha
    || !Array.isArray(data.canonicalRoutes) || !Array.isArray(data.additionalRoutes)
    || !Array.isArray(data.capturedRoutes) || !Array.isArray(data.routes)
    || typeof data.manifestStoragePath !== 'string' || !isAllowedPublicHistorySnapshotPath(data.manifestStoragePath)
    || ('manifestSha256' in data && (typeof data.manifestSha256 !== 'string'
      || !SNAPSHOT_SHA256.test(data.manifestSha256)))) return null;
  const capturedRoutes = data.capturedRoutes as unknown[];
  if (capturedRoutes.length === 0 || data.routes.length !== capturedRoutes.length) return null;
  let canonicalRoutes: string[];
  let additionalRoutes: string[];
  let normalizedCaptured: string[];
  try {
    canonicalRoutes = (data.canonicalRoutes as unknown[]).map(normalizeArchivedRoute);
    additionalRoutes = (data.additionalRoutes as unknown[]).map(normalizeArchivedRoute);
    normalizedCaptured = capturedRoutes.map(normalizeArchivedRoute);
  } catch { return null; }
  if (canonicalRoutes.length === 0 || new Set([...canonicalRoutes, ...additionalRoutes]).size !== normalizedCaptured.length
    || JSON.stringify([...canonicalRoutes, ...additionalRoutes]) !== JSON.stringify(normalizedCaptured)) return null;
  const prefix = `public/history/contributions/${String(data.contributionNumber).padStart(3, '0')}/${data.captureId}`;
  if (data.manifestStoragePath !== `${prefix}/manifest.json`) return null;
  const routes: PublicSnapshotRoute[] = [];
  const seenRoutes = new Set<string>();
  const seenKeys = new Set<string>();
  for (let index = 0; index < capturedRoutes.length; index += 1) {
    const route = capturedRoutes[index];
    const record = data.routes[index];
    if (typeof route !== 'string' || !record || typeof record !== 'object' || Array.isArray(record)) return null;
    const item = record as Record<string, unknown>;
    if (item.route !== route || typeof item.routeKey !== 'string'
      || !/^[A-Za-z0-9_-]{1,180}$/.test(item.routeKey)
      || seenRoutes.has(route) || seenKeys.has(item.routeKey)) return null;
    seenRoutes.add(route);
    seenKeys.add(item.routeKey);
    const sides = {} as Pick<PublicSnapshotRoute, 'before' | 'after'>;
    for (const side of ['before', 'after'] as const) {
      const raw = item[side];
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const image = raw as Record<string, unknown>;
      if (typeof image.storagePath !== 'string' || !isAllowedPublicHistorySnapshotPath(image.storagePath)
        || image.storagePath !== `${prefix}/${side}/${item.routeKey}.png`
        || typeof image.sha256 !== 'string' || !SNAPSHOT_SHA256.test(image.sha256)) return null;
      sides[side] = { storagePath: image.storagePath, sha256: image.sha256 };
    }
    routes.push({ route, routeKey: item.routeKey, ...sides });
  }
  const archivedAt = dateFromTimestamp(data.archivedAt);
  const viewport = data.viewport as Record<string, unknown> | undefined;
  if (!archivedAt || !viewport || !Number.isSafeInteger(viewport.width) || !Number.isSafeInteger(viewport.height)
    || viewport.deviceScaleFactor !== 1 || viewport.fullPage !== true) return null;
  return {
    schemaVersion: 1,
    contributionNumber: data.contributionNumber as number,
    captureId: data.captureId,
    beforeGitSha: data.beforeGitSha as string,
    afterGitSha: data.afterGitSha as string,
    canonicalRoutes,
    additionalRoutes,
    capturedRoutes: normalizedCaptured,
    routes,
    manifestStoragePath: data.manifestStoragePath,
    ...('manifestSha256' in data ? { manifestSha256: data.manifestSha256 as string } : {}),
    viewport: viewport as unknown as PublicContributionSnapshot['viewport'],
    archivedAt,
  };
}

export function snapshotHistorySummary(snapshot: PublicContributionSnapshot): string {
  return `before & after · ${snapshot.routes.length} ${snapshot.routes.length === 1 ? 'page' : 'pages'}`;
}

export function historicalRouteLabel(route: string): string {
  return route === '/' ? 'home' : route;
}

export function snapshotImageAlt(side: 'before' | 'after', contributionNumber: number, route: string): string {
  const label = String(contributionNumber).padStart(3, '0');
  return `${side === 'before' ? 'before' : 'after'} contribution #${label}, ${route}`;
}
