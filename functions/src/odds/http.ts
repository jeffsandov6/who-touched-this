import {
  NflOddsError,
  resolveNflOdds,
  type NflOddsCache,
  type PublicNflOddsResponse,
} from './nfl-odds.js';

interface NflOddsHttpDependencies {
  apiKey: string;
  cache: NflOddsCache;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  logFailure?: (code: string) => void;
}

interface OddsHttpRequest {
  method: string;
  query: object;
}

interface OddsHttpResponse {
  set(name: string, value: string): unknown;
  status(code: number): OddsHttpResponse;
  json(body: unknown): unknown;
}

function cacheControl(response: PublicNflOddsResponse): string {
  return response.cache.status === 'fresh'
    ? 'public, max-age=300, s-maxage=900, stale-while-revalidate=300'
    : 'public, max-age=30, s-maxage=60, stale-while-revalidate=60';
}

export async function handleNflOddsRequest(
  request: OddsHttpRequest,
  response: OddsHttpResponse,
  dependencies: NflOddsHttpDependencies,
): Promise<void> {
  response.set('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET') {
    response.set('Allow', 'GET');
    response.set('Cache-Control', 'no-store');
    response.status(405).json({ error: { code: 'method_not_allowed', message: 'Only GET is supported.' } });
    return;
  }
  if (Object.keys(request.query).length !== 0) {
    response.set('Cache-Control', 'no-store');
    response.status(400).json({ error: { code: 'invalid_request', message: 'Query parameters are not supported.' } });
    return;
  }
  try {
    const result = await resolveNflOdds({
      apiKey: dependencies.apiKey,
      cache: dependencies.cache,
      ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}),
      ...(dependencies.now ? { now: dependencies.now } : {}),
    });
    response.set('Cache-Control', cacheControl(result));
    response.status(200).json(result);
  } catch (error) {
    const code = error instanceof NflOddsError ? error.code : 'internal_error';
    dependencies.logFailure?.(code);
    response.set('Cache-Control', 'no-store');
    response.set('Retry-After', '300');
    response.status(503).json({
      error: {
        code: 'odds_temporarily_unavailable',
        message: 'NFL odds are temporarily unavailable.',
      },
    });
  }
}
