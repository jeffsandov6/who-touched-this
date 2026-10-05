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
export interface PublicSnapshotTile extends PublicSnapshotImage { index: number; y: number; width: number; height: number }
export interface PublicSnapshotTiledSide { width: number; height: number; tiles: PublicSnapshotTile[] }
export type PublicSnapshotSide = PublicSnapshotImage | PublicSnapshotTiledSide;

export interface PublicSnapshotRoute {
  route: string;
  routeKey: string;
  before: PublicSnapshotSide;
  after: PublicSnapshotSide;
}

export interface PublicContributionSnapshot {
  schemaVersion: 1 | 2;
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
  viewport: { width: number; height: number; deviceScaleFactor: number; fullPage?: boolean; captureMode?: string; tileHeight?: number };
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
  if (![1, SNAPSHOT_METADATA_SCHEMA_VERSION].includes(Number(data.schemaVersion)) || !Number.isSafeInteger(data.contributionNumber)
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
      if (data.schemaVersion === 1) {
        if (typeof image.storagePath !== 'string' || !isAllowedPublicHistorySnapshotPath(image.storagePath) || image.storagePath !== `${prefix}/${side}/${item.routeKey}.png`
          || typeof image.sha256 !== 'string' || !SNAPSHOT_SHA256.test(image.sha256)) return null;
        sides[side] = { storagePath: image.storagePath, sha256: image.sha256 };
      } else {
        if (!Number.isSafeInteger(image.width) || Number(image.width) < 1 || Number(image.width) > 2_880
          || !Number.isSafeInteger(image.height) || Number(image.height) < 1
          || Number(image.width) * Number(image.height) > 384_000_000
          || !Array.isArray(image.tiles) || image.tiles.length < 1 || image.tiles.length > 64) return null;
        const tileValues = image.tiles as unknown[];
        let nextY = 0;
        const tiles: PublicSnapshotTile[] = [];
        for (let tileIndex = 0; tileIndex < tileValues.length; tileIndex += 1) {
          const rawTile = tileValues[tileIndex];
          if (!rawTile || typeof rawTile !== 'object' || Array.isArray(rawTile)) return null;
          const tile = rawTile as Record<string, unknown>;
          if (tile.index !== tileIndex || tile.y !== nextY || tile.y !== tileIndex * 3_600 || tile.width !== image.width || !Number.isSafeInteger(tile.height) || Number(tile.height) < 1 || Number(tile.height) > 3_600
            || (tileIndex < tileValues.length - 1 && tile.height !== 3_600)
            || typeof tile.storagePath !== 'string' || tile.storagePath !== `${prefix}/${side}/${item.routeKey}/tile-${String(tileIndex).padStart(3, '0')}.png`
            || !isAllowedPublicHistorySnapshotPath(tile.storagePath) || typeof tile.sha256 !== 'string' || !SNAPSHOT_SHA256.test(tile.sha256)) return null;
          nextY += Number(tile.height);
          tiles.push({ index: tileIndex, y: tile.y as number, width: tile.width as number, height: tile.height as number, storagePath: tile.storagePath, sha256: tile.sha256 });
        }
        if (nextY !== image.height) return null;
        sides[side] = { width: image.width as number, height: image.height as number, tiles };
      }
    }
    routes.push({ route, routeKey: item.routeKey, ...sides });
  }
  const archivedAt = dateFromTimestamp(data.archivedAt);
  const viewport = data.viewport as Record<string, unknown> | undefined;
  if (!archivedAt || !viewport || !Number.isSafeInteger(viewport.width) || !Number.isSafeInteger(viewport.height)
    || viewport.deviceScaleFactor !== 1 || (data.schemaVersion === 1 ? viewport.fullPage !== true : viewport.captureMode !== 'tiled-document' || viewport.tileHeight !== 3_600)) return null;
  return {
    schemaVersion: data.schemaVersion as 1 | 2,
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
