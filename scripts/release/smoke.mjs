import registry from '../../src/platform/config/editable-routes.json' with { type: 'json' };
import { validateCanonicalRouteRegistry } from '../snapshots/routes.mjs';
import { RELEASE_CONFIG } from './config.mjs';

export function smokeRoutes() {
  return [...new Set([...validateCanonicalRouteRegistry(registry), ...RELEASE_CONFIG.platformSmokeRoutes])];
}

export function validateSmokeOrigin(origin, allowLocal = false) {
  let url;
  try { url = new URL(origin); } catch { throw new Error('Smoke origin must be a valid URL.'); }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Smoke origin must be a bare origin.');
  if (allowLocal && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)) return url.origin;
  if (url.origin !== RELEASE_CONFIG.origin) throw new Error(`Smoke origin must be ${RELEASE_CONFIG.origin}.`);
  return url.origin;
}

export function isAllowedRedirect(from, location, expectedOrigin) {
  const target = new URL(location, from);
  return target.origin === expectedOrigin;
}

export async function runReadOnlySmoke({ origin, expectedIndexing, fetchImpl = fetch, allowLocal = false, timeoutMs = 10_000 }) {
  const expectedOrigin = validateSmokeOrigin(origin, allowLocal);
  if (!['enabled', 'disabled'].includes(expectedIndexing)) throw new Error('Expected indexing must be enabled or disabled.');
  const results = [];
  for (const route of smokeRoutes()) {
    let url = new URL(route, `${expectedOrigin}/`).href;
    let response;
    for (let redirects = 0; redirects < 4; redirects += 1) {
      response = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get('location');
      if (!location || !isAllowedRedirect(url, location, expectedOrigin)) throw new Error(`${route}: redirect left the expected origin.`);
      url = new URL(location, url).href;
    }
    if (!response?.ok) throw new Error(`${route}: HTTP ${response?.status ?? 'failure'}.`);
    if (!response.headers.get('content-type')?.toLowerCase().includes('text/html')) throw new Error(`${route}: expected HTML content.`);
    const html = await response.text();
    if (!/<title>[^<]*Who Touched This[^<]*<\/title>/i.test(html) || /localhost|127\.0\.0\.1|demo-who-touched-this/i.test(html)) throw new Error(`${route}: invalid production shell or development reference.`);
    const noindex = /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(html);
    if (expectedIndexing === 'disabled' ? !noindex : noindex) throw new Error(`${route}: indexing metadata does not match expectation.`);
    results.push(route);
  }
  return results;
}
