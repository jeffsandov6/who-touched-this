import { createHash } from 'node:crypto';
import { CONTRIBUTION_BOUNDARIES } from '../../src/platform/config/contribution-boundaries.ts';

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

export function normalizeSnapshotRoute(value) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new Error('Snapshot routes must be non-empty strings without surrounding whitespace.');
  }
  if (!value.startsWith('/') || value.includes('//') || value.includes('\\') || value.includes('%')) {
    throw new Error(`Snapshot route must be a local same-origin path: ${value}`);
  }
  if (CONTROL_CHARACTER.test(value)) {
    throw new Error(`Snapshot route contains control characters: ${JSON.stringify(value)}`);
  }

  let parsed;
  try {
    parsed = new URL(value, 'http://snapshot.local');
  } catch {
    throw new Error(`Malformed snapshot route: ${value}`);
  }
  if (parsed.origin !== 'http://snapshot.local' || parsed.search || parsed.hash) {
    throw new Error(`Snapshot route must not be external or contain query/hash state: ${value}`);
  }

  const normalized = parsed.pathname === '/' ? '/' : parsed.pathname.replace(/\/+$/, '');
  const protectedRoute = CONTRIBUTION_BOUNDARIES.reservedPublicRoutes.find(
    (route) => normalized === route || normalized.startsWith(`${route}/`),
  );
  if (protectedRoute) {
    throw new Error(`Protected operational route cannot be captured: ${value}`);
  }
  return normalized;
}

export function validateCanonicalRouteRegistry(value, source = 'route registry') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${source} must be a JSON object.`);
  }
  if (value.schemaVersion !== 1 || !Array.isArray(value.routes) || value.routes.length === 0) {
    throw new Error(`${source} must use schemaVersion 1 and contain a non-empty routes array.`);
  }
  const routes = value.routes.map(normalizeSnapshotRoute);
  if (new Set(routes).size !== routes.length) {
    throw new Error(`${source} contains duplicate routes.`);
  }
  return routes;
}

export function mergeSnapshotRoutes(canonicalRoutes, additionalRoutes = []) {
  const canonical = canonicalRoutes.map(normalizeSnapshotRoute);
  if (new Set(canonical).size !== canonical.length || canonical.length === 0) {
    throw new Error('Canonical routes must be non-empty and unique.');
  }
  const additional = [];
  const seen = new Set(canonical);
  for (const route of additionalRoutes.map(normalizeSnapshotRoute)) {
    if (!seen.has(route)) {
      additional.push(route);
      seen.add(route);
    }
  }
  return { canonicalRoutes: canonical, additionalRoutes: additional, capturedRoutes: [...canonical, ...additional] };
}

function readableRouteKey(route) {
  if (route === '/') return 'home';
  return route.slice(1).split('/').map((segment) =>
    encodeURIComponent(segment).replaceAll('%', '_').replaceAll('.', '_2e_')
  ).join('--') || 'home';
}

export function createRouteKeyMap(routes) {
  const normalized = routes.map(normalizeSnapshotRoute);
  const groups = new Map();
  for (const route of normalized) {
    const base = readableRouteKey(route);
    groups.set(base, [...(groups.get(base) ?? []), route]);
  }
  return Object.fromEntries(normalized.map((route) => {
    const base = readableRouteKey(route);
    const collision = groups.get(base).length > 1;
    const suffix = createHash('sha256').update(route).digest('hex').slice(0, 8);
    return [route, collision ? `${base}--${suffix}` : base];
  }));
}
