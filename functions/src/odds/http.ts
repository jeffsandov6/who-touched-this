import { leagueByPath, type LeagueConfig } from './leagues.js';
import {
  OddsError,
  resolveOdds,
  type OddsBudget,
  type OddsCache,
  type PublicOddsResponse,
} from './odds.js';

interface OddsHttpDependencies {
  apiKey: string;
  cacheForLeague(league: LeagueConfig): OddsCache;
  budget: OddsBudget;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  logFailure?: (code: string, leagueId?: string) => void;
}

interface OddsHttpRequest {
  method: string;
  path: string;
  query: object;
}

interface OddsHttpResponse {
  set(name: string, value: string): unknown;
  status(code: number): OddsHttpResponse;
  json(body: unknown): unknown;
}

function cacheControl(response: PublicOddsResponse): string {
  return response.cache.status === 'fresh'
    ? 'public, max-age=300, s-maxage=900, stale-while-revalidate=300'
    : 'public, max-age=30, s-maxage=60';
}

export async function handleOddsRequest(
  request: OddsHttpRequest,
  response: OddsHttpResponse,
  dependencies: OddsHttpDependencies,
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
  const league = leagueByPath(request.path);
  if (!league) {
    response.set('Cache-Control', 'no-store');
    response.status(404).json({ error: { code: 'unsupported_league', message: 'That odds league is not supported.' } });
    return;
  }
  try {
    const result = await resolveOdds({
      apiKey: dependencies.apiKey,
      league,
      cache: dependencies.cacheForLeague(league),
      budget: dependencies.budget,
      ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}),
      ...(dependencies.now ? { now: dependencies.now } : {}),
    });
    response.set('Cache-Control', cacheControl(result));
    response.status(200).json(result);
  } catch (error) {
    const code = error instanceof OddsError ? error.code : 'internal_error';
    dependencies.logFailure?.(code, league.id);
    response.set('Cache-Control', 'no-store');
    response.set('Retry-After', code === 'quota_exhausted' || code === 'budget_limit' ? '21600' : '300');
    if (code === 'quota_exhausted') {
      response.status(503).json({
        error: {
          code: 'ODDS_QUOTA_EXHAUSTED',
          message: 'Odds data is unavailable because the monthly provider quota is exhausted.',
        },
      });
      return;
    }
    response.status(503).json({
      error: {
        code: 'ODDS_TEMPORARILY_UNAVAILABLE',
        message: `${league.name} odds are temporarily unavailable.`,
      },
    });
  }
}
