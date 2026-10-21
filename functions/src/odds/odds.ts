import { randomUUID } from 'node:crypto';
import {
  leagueById,
  type BookmakerConfig,
  type LeagueConfig,
  type LeagueId,
  type ProviderMarketKey,
  type PublicMarketKey,
} from './leagues.js';

export const ODDS_FRESH_MILLISECONDS = 12 * 60 * 60 * 1000;
export const ODDS_MAXIMUM_STALE_MILLISECONDS = 24 * 60 * 60 * 1000;
export const ODDS_REFRESH_LEASE_MILLISECONDS = 20 * 1000;
export const ODDS_TRANSIENT_BACKOFF_MILLISECONDS = 30 * 60 * 1000;
export const ODDS_CONFIGURATION_BACKOFF_MILLISECONDS = 24 * 60 * 60 * 1000;
export const ODDS_UPSTREAM_TIMEOUT_MILLISECONDS = 8 * 1000;
export const ODDS_MAXIMUM_RESPONSE_BYTES = 2 * 1024 * 1024;

const UPSTREAM_ORIGIN = 'https://api.the-odds-api.com';
const MAX_EVENTS = 500;

export type OutcomeSide = 'home' | 'away' | 'draw' | 'over' | 'under';

export interface PublicOddsOutcome {
  /** Stable across price and point changes for one league, event, market, and side. */
  id: string;
  side: OutcomeSide;
  label: string;
  americanOdds: number;
  point?: number;
}

export interface PublicOddsMarket {
  key: ProviderMarketKey;
  name: 'Moneyline' | 'Spread' | 'Total';
  updatedAt?: string;
  outcomes: PublicOddsOutcome[];
}

export interface PublicOddsEvent {
  /** League-scoped provider event identifier. */
  id: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  bookmakerUpdatedAt?: string;
  markets: Partial<Record<PublicMarketKey, PublicOddsMarket>>;
}

export interface OddsSnapshot {
  schemaVersion: 2;
  league: { id: LeagueId; name: string };
  /** The Odds API sport key. */
  sport: string;
  source: {
    provider: 'The Odds API';
    /** Null means none of the configured bookmakers supplied a usable market. */
    bookmakerKey: BookmakerConfig['key'] | null;
    bookmakerName: BookmakerConfig['name'] | null;
  };
  fetchedAt: string;
  events: PublicOddsEvent[];
}

export type StaleReason =
  | 'refresh_in_progress'
  | 'refresh_backoff'
  | 'upstream_unavailable'
  | 'rate_limited'
  | 'budget_limit'
  | 'quota_exhausted';

export interface PublicOddsResponse extends OddsSnapshot {
  cache: {
    status: 'fresh' | 'stale';
    ageSeconds: number;
    freshForSeconds: number;
    maximumStaleSeconds: number;
    staleReason?: StaleReason;
  };
}

export interface ProviderQuotaObservation {
  remaining: number;
  used: number;
  last: number;
}

export type OddsErrorCode =
  | 'quota_exhausted'
  | 'budget_limit'
  | 'budget_unavailable'
  | 'upstream_rate_limited'
  | 'upstream_configuration'
  | 'upstream_unavailable'
  | 'upstream_malformed'
  | 'cache_unavailable';

export class OddsError extends Error {
  constructor(
    readonly code: OddsErrorCode,
    message: string,
    readonly details: {
      quota?: ProviderQuotaObservation;
      retryAfterMilliseconds?: number;
    } = {},
  ) {
    super(message);
    this.name = 'OddsError';
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OddsError('upstream_malformed', `${label} is malformed.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, maximum = 200): string {
  if (typeof value !== 'string' || value !== value.trim() || !value || value.length > maximum) {
    throw new OddsError('upstream_malformed', `${label} is malformed.`);
  }
  return value;
}

function timestamp(value: unknown, label: string, required = true): string | undefined {
  if (value === undefined || value === null) {
    if (required) throw new OddsError('upstream_malformed', `${label} is missing.`);
    return undefined;
  }
  const raw = text(value, label, 64);
  const milliseconds = Date.parse(raw);
  if (!Number.isFinite(milliseconds)) throw new OddsError('upstream_malformed', `${label} is malformed.`);
  return new Date(milliseconds).toISOString();
}

function price(value: unknown): number {
  if (!Number.isInteger(value) || Math.abs(value as number) < 100 || Math.abs(value as number) > 100_000) {
    throw new OddsError('upstream_malformed', 'An upstream American odds price is malformed.');
  }
  return value as number;
}

function point(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000) {
    throw new OddsError('upstream_malformed', 'An upstream market point is malformed.');
  }
  return value;
}

function outcomeSide(
  market: ProviderMarketKey,
  name: string,
  homeTeam: string,
  awayTeam: string,
  allowDraw: boolean,
): OutcomeSide {
  if (market === 'totals') {
    if (name === 'Over') return 'over';
    if (name === 'Under') return 'under';
  } else {
    if (name === homeTeam) return 'home';
    if (name === awayTeam) return 'away';
    if (market === 'h2h' && allowDraw && name.toLowerCase() === 'draw') return 'draw';
  }
  throw new OddsError('upstream_malformed', 'An upstream outcome does not match its event.');
}

function normalizeMarket(
  input: unknown,
  eventId: string,
  homeTeam: string,
  awayTeam: string,
  league: LeagueConfig,
): { publicKey: PublicMarketKey; market: PublicOddsMarket } {
  const record = object(input, 'Upstream market');
  if (!league.markets.includes(record.key as ProviderMarketKey)) {
    throw new OddsError('upstream_malformed', 'An upstream market key is unsupported for this league.');
  }
  const key = record.key as ProviderMarketKey;
  if (!Array.isArray(record.outcomes) || record.outcomes.length < 1 || record.outcomes.length > 3) {
    throw new OddsError('upstream_malformed', 'Upstream market outcomes are malformed.');
  }
  const sides = new Set<OutcomeSide>();
  const outcomes = record.outcomes.map((inputOutcome) => {
    const item = object(inputOutcome, 'Upstream outcome');
    const providerLabel = text(item.name, 'Upstream outcome name');
    const side = outcomeSide(key, providerLabel, homeTeam, awayTeam, league.allowDraw);
    if (sides.has(side)) throw new OddsError('upstream_malformed', 'Upstream outcomes contain a duplicate side.');
    sides.add(side);
    const applicablePoint = key === 'h2h' ? undefined : point(item.point);
    return {
      id: `${eventId}:${key}:${side}`,
      side,
      label: side === 'draw' ? 'Draw' : providerLabel,
      americanOdds: price(item.price),
      ...(applicablePoint === undefined ? {} : { point: applicablePoint }),
    } satisfies PublicOddsOutcome;
  });
  const requiredSides: readonly OutcomeSide[] = key === 'totals'
    ? ['over', 'under']
    : ['home', 'away'];
  if (!requiredSides.every((side) => sides.has(side))) {
    throw new OddsError('upstream_malformed', 'Upstream market is missing a required outcome.');
  }
  const updatedAt = timestamp(record.last_update, 'Upstream market update timestamp', false);
  const names = {
    h2h: ['moneyline', 'Moneyline'],
    spreads: ['spread', 'Spread'],
    totals: ['total', 'Total'],
  } as const;
  const [publicKey, name] = names[key];
  return { publicKey, market: { key, name, ...(updatedAt ? { updatedAt } : {}), outcomes } };
}

function configuredBookmaker(event: Record<string, unknown>, key: string): Record<string, unknown> | null {
  if (!Array.isArray(event.bookmakers)) throw new OddsError('upstream_malformed', 'Upstream bookmakers are malformed.');
  const matching = event.bookmakers.filter((candidate) => object(candidate, 'Upstream bookmaker').key === key);
  if (matching.length > 1) throw new OddsError('upstream_malformed', 'Upstream response contains duplicate bookmakers.');
  return matching.length === 0 ? null : object(matching[0], 'Configured upstream bookmaker');
}

function chooseBookmaker(
  events: Record<string, unknown>[],
  league: LeagueConfig,
  nowMilliseconds: number,
): BookmakerConfig | null {
  if (league.allowDraw) {
    let selected: BookmakerConfig | null = null;
    let greatestCoverage = 0;
    for (const candidate of league.bookmakers) {
      const coverage = events.reduce((count, event) => {
        const normalized = normalizeEvent(event, nowMilliseconds, league, candidate);
        return count + (normalized?.markets.moneyline ? 1 : 0);
      }, 0);
      if (coverage > greatestCoverage) {
        selected = candidate;
        greatestCoverage = coverage;
      }
    }
    return selected;
  }
  for (const candidate of league.bookmakers) {
    for (const event of events) {
      const bookmaker = configuredBookmaker(event, candidate.key);
      if (!bookmaker) continue;
      if (!Array.isArray(bookmaker.markets)) {
        throw new OddsError('upstream_malformed', 'Configured upstream bookmaker markets are malformed.');
      }
      if (bookmaker.markets.some((input) => {
        const market = object(input, 'Upstream market');
        return league.markets.includes(market.key as ProviderMarketKey)
          && Array.isArray(market.outcomes) && market.outcomes.length > 0;
      })) return candidate;
    }
  }
  return null;
}

function normalizeEvent(
  record: Record<string, unknown>,
  nowMilliseconds: number,
  league: LeagueConfig,
  bookmakerConfig: BookmakerConfig | null,
): PublicOddsEvent | null {
  if (record.sport_key !== league.sportKey) {
    throw new OddsError('upstream_malformed', 'Upstream event sport does not match the requested league.');
  }
  const providerId = text(record.id, 'Upstream event identifier', 128);
  if (!/^[A-Za-z0-9_-]+$/.test(providerId)) {
    throw new OddsError('upstream_malformed', 'Upstream event identifier is malformed.');
  }
  const commenceTime = timestamp(record.commence_time, 'Upstream event start time')!;
  if (Date.parse(commenceTime) <= nowMilliseconds) return null;
  const homeTeam = text(record.home_team, 'Upstream home team');
  const awayTeam = text(record.away_team, 'Upstream away team');
  if (homeTeam === awayTeam) throw new OddsError('upstream_malformed', 'Upstream teams must be distinct.');
  const id = `${league.id}:${providerId}`;
  const bookmaker = bookmakerConfig ? configuredBookmaker(record, bookmakerConfig.key) : null;
  if (!bookmaker) return { id, commenceTime, homeTeam, awayTeam, markets: {} };
  if (!Array.isArray(bookmaker.markets)) {
    throw new OddsError('upstream_malformed', 'Configured upstream bookmaker markets are malformed.');
  }
  const markets: PublicOddsEvent['markets'] = {};
  for (const inputMarket of bookmaker.markets) {
    const normalized = normalizeMarket(inputMarket, id, homeTeam, awayTeam, league);
    if (markets[normalized.publicKey]) {
      throw new OddsError('upstream_malformed', 'Configured bookmaker contains a duplicate market.');
    }
    markets[normalized.publicKey] = normalized.market;
  }
  const bookmakerUpdatedAt = timestamp(bookmaker.last_update, 'Bookmaker update timestamp', false);
  return { id, commenceTime, homeTeam, awayTeam,
    ...(bookmakerUpdatedAt ? { bookmakerUpdatedAt } : {}), markets };
}

export function normalizeOdds(input: unknown, fetchedAt: Date, league: LeagueConfig): OddsSnapshot {
  if (!Number.isFinite(fetchedAt.getTime())) {
    throw new OddsError('upstream_malformed', 'Server fetch timestamp is invalid.');
  }
  if (!Array.isArray(input) || input.length > MAX_EVENTS) {
    throw new OddsError('upstream_malformed', 'Upstream schedule is malformed.');
  }
  const records = input.map((event) => object(event, 'Upstream event'));
  const bookmaker = chooseBookmaker(records, league, fetchedAt.getTime());
  const identifiers = new Set<string>();
  const events: PublicOddsEvent[] = [];
  for (const record of records) {
    const event = normalizeEvent(record, fetchedAt.getTime(), league, bookmaker);
    if (!event) continue;
    if (identifiers.has(event.id)) throw new OddsError('upstream_malformed', 'Upstream schedule has a duplicate event.');
    identifiers.add(event.id);
    events.push(event);
  }
  events.sort((left, right) => left.commenceTime.localeCompare(right.commenceTime) || left.id.localeCompare(right.id));
  return {
    schemaVersion: 2,
    league: { id: league.id, name: league.name },
    sport: league.sportKey,
    source: { provider: 'The Odds API', bookmakerKey: bookmaker?.key ?? null, bookmakerName: bookmaker?.name ?? null },
    fetchedAt: fetchedAt.toISOString(),
    events,
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null
    && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > ODDS_MAXIMUM_RESPONSE_BYTES)) {
    throw new OddsError('upstream_malformed', 'Upstream response exceeds the size limit.');
  }
  if (!response.body) throw new OddsError('upstream_malformed', 'Upstream response body is missing.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > ODDS_MAXIMUM_RESPONSE_BYTES) {
        await reader.cancel();
        throw new OddsError('upstream_malformed', 'Upstream response exceeds the size limit.');
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    throw new OddsError('upstream_malformed', 'Upstream response is not valid JSON.');
  }
}

function integerHeader(headers: Headers, name: string): number | null {
  const value = headers.get(name);
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= 1_000_000_000 ? parsed : null;
}

export function quotaObservation(headers: Headers): ProviderQuotaObservation | null {
  const remaining = integerHeader(headers, 'x-requests-remaining');
  const used = integerHeader(headers, 'x-requests-used');
  const last = integerHeader(headers, 'x-requests-last');
  return remaining === null || used === null || last === null ? null : { remaining, used, last };
}

function retryAfterMilliseconds(headers: Headers, now: Date): number | undefined {
  const value = headers.get('retry-after');
  if (!value) return undefined;
  const milliseconds = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now.getTime();
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return undefined;
  return Math.min(milliseconds, 24 * 60 * 60 * 1000);
}

function providerErrorCode(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const code = (value as Record<string, unknown>).error_code;
  return typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code) ? code : null;
}

export interface ProviderFetchResult { snapshot: OddsSnapshot; quota: ProviderQuotaObservation | null }

export async function fetchLeagueOdds(options: {
  apiKey: string;
  league: LeagueConfig;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeoutMilliseconds?: number;
}): Promise<ProviderFetchResult> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new OddsError('upstream_configuration', 'Odds provider credential is unavailable.');
  const url = new URL(`/v4/sports/${options.league.sportKey}/odds`, UPSTREAM_ORIGIN);
  url.searchParams.set('apiKey', apiKey);
  url.searchParams.set('bookmakers', options.league.bookmakers.map(({ key }) => key).join(','));
  url.searchParams.set('markets', options.league.markets.join(','));
  url.searchParams.set('oddsFormat', 'american');
  url.searchParams.set('dateFormat', 'iso');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMilliseconds ?? ODDS_UPSTREAM_TIMEOUT_MILLISECONDS);
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: 'GET', headers: { accept: 'application/json' }, redirect: 'error', signal: controller.signal,
    });
    const quota = quotaObservation(response.headers);
    if (!response.ok) {
      let code: string | null = null;
      if ((response.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
        try { code = providerErrorCode(await readBoundedJson(response)); }
        catch { code = null; }
      }
      const retry = retryAfterMilliseconds(response.headers, (options.now ?? (() => new Date()))());
      const details = { ...(quota ? { quota } : {}), ...(retry === undefined ? {} : { retryAfterMilliseconds: retry }) };
      if (code === 'OUT_OF_USAGE_CREDITS') throw new OddsError('quota_exhausted', 'Odds provider quota is exhausted.', details);
      if (code === 'EXCEEDED_FREQ_LIMIT' || response.status === 429) {
        throw new OddsError('upstream_rate_limited', 'Odds provider rate limit was reached.', details);
      }
      if (response.status === 401 || response.status === 403
        || ['INVALID_KEY', 'API_KEY_DISABLED', 'KEY_NOT_FOUND'].includes(code ?? '')) {
        throw new OddsError('upstream_configuration', 'Odds provider credential was rejected.', details);
      }
      throw new OddsError('upstream_unavailable', `Odds provider returned HTTP ${response.status}.`, details);
    }
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.startsWith('application/json')) {
      throw new OddsError('upstream_malformed', 'Odds provider response type is not JSON.', quota ? { quota } : {});
    }
    const now = (options.now ?? (() => new Date()))();
    return { snapshot: normalizeOdds(await readBoundedJson(response), now, options.league), quota };
  } catch (error) {
    if (error instanceof OddsError) throw error;
    throw new OddsError('upstream_unavailable', controller.signal.aborted
      ? 'Odds provider request timed out.' : 'Odds provider request failed.');
  } finally {
    clearTimeout(timeout);
  }
}

export interface OddsCacheEntry { snapshot: OddsSnapshot; fetchedAtMilliseconds: number }

export type OddsRefreshClaim =
  | { kind: 'acquired'; previous: OddsCacheEntry | null }
  | { kind: 'fresh'; entry: OddsCacheEntry }
  | { kind: 'busy'; entry: OddsCacheEntry | null }
  | { kind: 'backoff'; entry: OddsCacheEntry | null; reason: StaleReason };

export interface OddsCache {
  load(): Promise<OddsCacheEntry | null>;
  claim(now: Date, token: string): Promise<OddsRefreshClaim>;
  store(token: string, entry: OddsCacheEntry): Promise<void>;
  markFailure(token: string, retryAt: Date, reason: StaleReason): Promise<void>;
}

export interface BudgetReservation { token: string; credits: number; quotaRecheck: boolean }
export type BudgetClaim =
  | { kind: 'acquired'; reservation: BudgetReservation }
  | { kind: 'blocked'; reason: 'budget_limit' | 'quota_exhausted'; retryAt: Date };

export interface OddsBudget {
  reserve(now: Date, token: string, credits: number): Promise<BudgetClaim>;
  settle(
    reservation: BudgetReservation,
    now: Date,
    result: { quota: ProviderQuotaObservation | null; quotaExhausted: boolean; successful: boolean },
  ): Promise<{ retryAt?: Date }>;
}

function cacheAge(entry: OddsCacheEntry, now: Date): number { return now.getTime() - entry.fetchedAtMilliseconds; }
function isFresh(entry: OddsCacheEntry, now: Date): boolean {
  const age = cacheAge(entry, now); return age >= 0 && age < ODDS_FRESH_MILLISECONDS;
}
function canServeStale(entry: OddsCacheEntry | null, now: Date): entry is OddsCacheEntry {
  if (!entry) return false;
  const age = cacheAge(entry, now); return age >= ODDS_FRESH_MILLISECONDS && age <= ODDS_MAXIMUM_STALE_MILLISECONDS;
}

function publicResponse(entry: OddsCacheEntry, now: Date, status: 'fresh' | 'stale', staleReason?: StaleReason): PublicOddsResponse {
  return {
    ...entry.snapshot,
    events: entry.snapshot.events.filter((event) => Date.parse(event.commenceTime) > now.getTime()),
    cache: {
      status,
      ageSeconds: Math.max(0, Math.floor(cacheAge(entry, now) / 1000)),
      freshForSeconds: ODDS_FRESH_MILLISECONDS / 1000,
      maximumStaleSeconds: ODDS_MAXIMUM_STALE_MILLISECONDS / 1000,
      ...(staleReason ? { staleReason } : {}),
    },
  };
}

async function waitForColdRefresh(cache: OddsCache, now: () => Date, sleep: (milliseconds: number) => Promise<void>) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(250);
    const entry = await cache.load();
    if (entry && isFresh(entry, now())) return entry;
  }
  return null;
}

function failureReason(code: OddsErrorCode): StaleReason {
  if (code === 'quota_exhausted') return 'quota_exhausted';
  if (code === 'budget_limit') return 'budget_limit';
  if (code === 'upstream_rate_limited') return 'rate_limited';
  return 'upstream_unavailable';
}

function failureRetryAt(error: OddsError, now: Date, budgetRetryAt?: Date): Date {
  if (budgetRetryAt) return budgetRetryAt;
  if (error.code === 'upstream_rate_limited') {
    return new Date(now.getTime() + (error.details.retryAfterMilliseconds ?? ODDS_TRANSIENT_BACKOFF_MILLISECONDS));
  }
  if (error.code === 'upstream_configuration') return new Date(now.getTime() + ODDS_CONFIGURATION_BACKOFF_MILLISECONDS);
  return new Date(now.getTime() + ODDS_TRANSIENT_BACKOFF_MILLISECONDS);
}

export async function resolveOdds(options: {
  apiKey: string;
  league: LeagueConfig;
  cache: OddsCache;
  budget: OddsBudget;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  token?: () => string;
}): Promise<PublicOddsResponse> {
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const requestTime = now();
  let initial: OddsCacheEntry | null;
  try { initial = await options.cache.load(); }
  catch { throw new OddsError('cache_unavailable', 'Shared odds cache is unavailable.'); }
  if (initial && isFresh(initial, requestTime)) return publicResponse(initial, requestTime, 'fresh');

  const refreshToken = (options.token ?? randomUUID)();
  let claim: OddsRefreshClaim;
  try { claim = await options.cache.claim(requestTime, refreshToken); }
  catch { throw new OddsError('cache_unavailable', 'Shared odds cache is unavailable.'); }
  if (claim.kind === 'fresh') return publicResponse(claim.entry, requestTime, 'fresh');
  if (claim.kind === 'backoff') {
    if (canServeStale(claim.entry, requestTime)) return publicResponse(claim.entry, requestTime, 'stale', claim.reason);
    throw new OddsError(claim.reason === 'quota_exhausted' ? 'quota_exhausted' : 'upstream_unavailable',
      'Odds refresh is temporarily unavailable.');
  }
  if (claim.kind === 'busy') {
    if (canServeStale(claim.entry, requestTime)) return publicResponse(claim.entry, requestTime, 'stale', 'refresh_in_progress');
    try {
      const refreshed = await waitForColdRefresh(options.cache, now, sleep);
      if (refreshed) return publicResponse(refreshed, now(), 'fresh');
    } catch { throw new OddsError('cache_unavailable', 'Shared odds cache is unavailable.'); }
    throw new OddsError('upstream_unavailable', 'Initial odds refresh did not complete in time.');
  }

  const budgetToken = `${options.league.id}:${refreshToken}`;
  let budgetClaim: BudgetClaim;
  try { budgetClaim = await options.budget.reserve(requestTime, budgetToken, options.league.estimatedCredits); }
  catch {
    try {
      await options.cache.markFailure(refreshToken,
        new Date(requestTime.getTime() + ODDS_TRANSIENT_BACKOFF_MILLISECONDS), 'refresh_backoff');
    } catch { /* The budget failure remains authoritative. */ }
    if (canServeStale(claim.previous, requestTime)) return publicResponse(claim.previous, requestTime, 'stale', 'refresh_backoff');
    throw new OddsError('budget_unavailable', 'Shared odds budget is unavailable.');
  }
  if (budgetClaim.kind === 'blocked') {
    const code = budgetClaim.reason === 'quota_exhausted' ? 'quota_exhausted' : 'budget_limit';
    const reason = failureReason(code);
    try { await options.cache.markFailure(refreshToken, budgetClaim.retryAt, reason); }
    catch { /* A blocked budget still prevents the upstream call. */ }
    if (canServeStale(claim.previous, requestTime)) return publicResponse(claim.previous, requestTime, 'stale', reason);
    throw new OddsError(code, 'Odds provider budget does not permit a refresh.');
  }

  let result: ProviderFetchResult;
  try {
    result = await fetchLeagueOdds({ apiKey: options.apiKey, league: options.league,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}), now });
  } catch (error) {
    const oddsError = error instanceof OddsError ? error : new OddsError('upstream_unavailable', 'Odds provider request failed.');
    let budgetRetryAt: Date | undefined;
    try {
      budgetRetryAt = (await options.budget.settle(budgetClaim.reservation, now(), {
        quota: oddsError.details.quota ?? null, quotaExhausted: oddsError.code === 'quota_exhausted', successful: false,
      })).retryAt;
    } catch {
      if (!canServeStale(claim.previous, now())) throw new OddsError('budget_unavailable', 'Shared odds budget could not be reconciled.');
    }
    const fallbackTime = now();
    const reason = failureReason(oddsError.code);
    try { await options.cache.markFailure(refreshToken, failureRetryAt(oddsError, fallbackTime, budgetRetryAt), reason); }
    catch {
      if (!canServeStale(claim.previous, fallbackTime)) {
        throw new OddsError('cache_unavailable', 'Shared odds cache failure could not be recorded.');
      }
    }
    if (canServeStale(claim.previous, fallbackTime)) return publicResponse(claim.previous, fallbackTime, 'stale', reason);
    throw oddsError;
  }

  try {
    await options.budget.settle(budgetClaim.reservation, now(), {
      quota: result.quota, quotaExhausted: false, successful: true,
    });
  }
  catch { throw new OddsError('budget_unavailable', 'Shared odds budget could not be reconciled.'); }
  const entry = { snapshot: result.snapshot, fetchedAtMilliseconds: Date.parse(result.snapshot.fetchedAt) } satisfies OddsCacheEntry;
  try { await options.cache.store(refreshToken, entry); }
  catch { throw new OddsError('cache_unavailable', 'Validated odds could not be stored in the shared cache.'); }
  return publicResponse(entry, now(), 'fresh');
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function validIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validOutcome(value: unknown, event: Record<string, unknown>, market: ProviderMarketKey, league: LeagueConfig): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const outcome = value as Record<string, unknown>;
  const expectedSides = market === 'totals' ? ['over', 'under']
    : market === 'h2h' && league.allowDraw ? ['home', 'away', 'draw'] : ['home', 'away'];
  const expectedLabel = outcome.side === 'home' ? event.homeTeam
    : outcome.side === 'away' ? event.awayTeam
      : outcome.side === 'draw' ? 'Draw'
        : outcome.side === 'over' ? 'Over' : 'Under';
  return exactKeys(outcome, market === 'h2h'
    ? ['id', 'side', 'label', 'americanOdds'] : ['id', 'side', 'label', 'americanOdds', 'point'])
    && typeof outcome.side === 'string' && expectedSides.includes(outcome.side)
    && outcome.id === `${event.id}:${market}:${outcome.side}` && outcome.label === expectedLabel
    && Number.isInteger(outcome.americanOdds) && Math.abs(outcome.americanOdds as number) >= 100
    && Math.abs(outcome.americanOdds as number) <= 100_000
    && (market === 'h2h' ? !('point' in outcome)
      : typeof outcome.point === 'number' && Number.isFinite(outcome.point) && Math.abs(outcome.point) <= 1_000);
}

/** Rejects malformed or manually altered Firestore cache payloads before they are served. */
export function isOddsSnapshot(value: unknown, expectedLeagueId?: LeagueId): value is OddsSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  const leagueRecord = snapshot.league as Record<string, unknown> | undefined;
  const league = typeof leagueRecord?.id === 'string' ? leagueById(leagueRecord.id) : null;
  const source = snapshot.source as Record<string, unknown> | undefined;
  if (!exactKeys(snapshot, ['schemaVersion', 'league', 'sport', 'source', 'fetchedAt', 'events'])
    || snapshot.schemaVersion !== 2 || !league || (expectedLeagueId && league.id !== expectedLeagueId)
    || !leagueRecord || !exactKeys(leagueRecord, ['id', 'name']) || leagueRecord.name !== league.name
    || snapshot.sport !== league.sportKey || !source || source.provider !== 'The Odds API'
    || !exactKeys(source, ['provider', 'bookmakerKey', 'bookmakerName'])
    || !validIsoTimestamp(snapshot.fetchedAt) || !Array.isArray(snapshot.events)
    || snapshot.events.length > MAX_EVENTS) return false;
  const configured = league.bookmakers.find(({ key }) => key === source.bookmakerKey);
  if (source.bookmakerKey === null || source.bookmakerName === null) {
    if (source.bookmakerKey !== null || source.bookmakerName !== null) return false;
  } else if (!configured || configured.name !== source.bookmakerName) return false;
  const eventIds = new Set<string>();
  for (const inputEvent of snapshot.events) {
    if (!inputEvent || typeof inputEvent !== 'object' || Array.isArray(inputEvent)) return false;
    const event = inputEvent as Record<string, unknown>;
    if (!exactKeys(event, ['id', 'commenceTime', 'homeTeam', 'awayTeam', 'bookmakerUpdatedAt', 'markets'])
      || typeof event.id !== 'string' || !event.id.startsWith(`${league.id}:`) || event.id.length > 160
      || eventIds.has(event.id) || typeof event.homeTeam !== 'string' || !event.homeTeam
      || typeof event.awayTeam !== 'string' || !event.awayTeam || event.homeTeam === event.awayTeam
      || !validIsoTimestamp(event.commenceTime)
      || ('bookmakerUpdatedAt' in event && !validIsoTimestamp(event.bookmakerUpdatedAt))
      || !event.markets || typeof event.markets !== 'object' || Array.isArray(event.markets)) return false;
    eventIds.add(event.id);
    const markets = event.markets as Record<string, unknown>;
    const publicNames = { h2h: 'moneyline', spreads: 'spread', totals: 'total' } as const;
    const allowedPublicKeys = league.markets.map((key) => publicNames[key]);
    if (!Object.keys(markets).every((key) => allowedPublicKeys.includes(key as PublicMarketKey))) return false;
    for (const [publicKey, providerKey, name] of [
      ['moneyline', 'h2h', 'Moneyline'], ['spread', 'spreads', 'Spread'], ['total', 'totals', 'Total'],
    ] as const) {
      if (!(publicKey in markets)) continue;
      const market = markets[publicKey] as Record<string, unknown>;
      const outcomeSides = Array.isArray(market?.outcomes)
        ? new Set(market.outcomes.map((outcome) => (outcome as Record<string, unknown>)?.side))
        : new Set<unknown>();
      const requiredSides = providerKey === 'totals' ? ['over', 'under'] : ['home', 'away'];
      if (!market || typeof market !== 'object' || Array.isArray(market)
        || !exactKeys(market, ['key', 'name', 'updatedAt', 'outcomes'])
        || market.key !== providerKey || market.name !== name || !league.markets.includes(providerKey)
        || ('updatedAt' in market && !validIsoTimestamp(market.updatedAt))
        || !Array.isArray(market.outcomes) || market.outcomes.length < 1 || market.outcomes.length > 3
        || outcomeSides.size !== market.outcomes.length
        || !requiredSides.every((side) => outcomeSides.has(side))
        || !market.outcomes.every((outcome) => validOutcome(outcome, event, providerKey, league))) return false;
    }
  }
  return true;
}
