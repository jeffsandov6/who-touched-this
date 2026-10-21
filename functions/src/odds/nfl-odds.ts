import { randomUUID } from 'node:crypto';

export const NFL_SPORT = 'americanfootball_nfl' as const;
export const NFL_BOOKMAKER_KEY = 'draftkings' as const;
export const NFL_BOOKMAKER_NAME = 'DraftKings' as const;
export const ODDS_FRESH_MILLISECONDS = 6 * 60 * 60 * 1000;
export const ODDS_MAXIMUM_STALE_MILLISECONDS = 24 * 60 * 60 * 1000;
export const ODDS_REFRESH_LEASE_MILLISECONDS = 20 * 1000;
export const ODDS_REFRESH_BACKOFF_MILLISECONDS = 6 * 60 * 60 * 1000;
export const ODDS_RATE_LIMIT_BACKOFF_MILLISECONDS = 24 * 60 * 60 * 1000;
export const ODDS_UPSTREAM_TIMEOUT_MILLISECONDS = 8 * 1000;
export const ODDS_MAXIMUM_RESPONSE_BYTES = 2 * 1024 * 1024;

const UPSTREAM_URL = 'https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds';
const MAX_EVENTS = 500;

export type PublicMarketKey = 'moneyline' | 'spread' | 'total';
export type ProviderMarketKey = 'h2h' | 'spreads' | 'totals';
export type OutcomeSide = 'home' | 'away' | 'over' | 'under';

export interface PublicOddsOutcome {
  /** Stable across price and point changes for the same event, market, and side. */
  id: string;
  side: OutcomeSide;
  label: string;
  americanOdds: number;
  point?: number;
}

export interface PublicOddsMarket {
  /** Provider market key; object placement supplies the canvas-facing market name. */
  key: ProviderMarketKey;
  name: 'Moneyline' | 'Spread' | 'Total';
  updatedAt?: string;
  outcomes: PublicOddsOutcome[];
}

export interface PublicNflOddsEvent {
  /** The Odds API event id, stable for the life of the scheduled event. */
  id: string;
  /** ISO 8601 UTC timestamp. Events at or after kickoff are omitted when served. */
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  bookmakerUpdatedAt?: string;
  markets: {
    moneyline?: PublicOddsMarket;
    spread?: PublicOddsMarket;
    total?: PublicOddsMarket;
  };
}

export interface NflOddsSnapshot {
  schemaVersion: 1;
  sport: typeof NFL_SPORT;
  source: {
    provider: 'The Odds API';
    bookmakerKey: typeof NFL_BOOKMAKER_KEY;
    bookmakerName: typeof NFL_BOOKMAKER_NAME;
  };
  fetchedAt: string;
  events: PublicNflOddsEvent[];
}

/**
 * Versioned JSON returned by GET /api/odds/nfl. All timestamps are ISO 8601 UTC.
 * `stale` is never used for a current refresh; consumers must surface it explicitly.
 */
export interface PublicNflOddsResponse extends NflOddsSnapshot {
  cache: {
    status: 'fresh' | 'stale';
    ageSeconds: number;
    freshForSeconds: number;
    maximumStaleSeconds: number;
    staleReason?: 'refresh_in_progress' | 'refresh_backoff' | 'upstream_unavailable';
  };
}

export type OddsErrorCode =
  | 'upstream_rate_limited'
  | 'upstream_unavailable'
  | 'upstream_malformed'
  | 'cache_unavailable';

export class NflOddsError extends Error {
  constructor(readonly code: OddsErrorCode, message: string) {
    super(message);
    this.name = 'NflOddsError';
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new NflOddsError('upstream_malformed', `${label} is malformed.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, maximum = 200): string {
  if (typeof value !== 'string' || value !== value.trim() || !value || value.length > maximum) {
    throw new NflOddsError('upstream_malformed', `${label} is malformed.`);
  }
  return value;
}

function timestamp(value: unknown, label: string, required = true): string | undefined {
  if (value === undefined || value === null) {
    if (required) throw new NflOddsError('upstream_malformed', `${label} is missing.`);
    return undefined;
  }
  const raw = text(value, label, 64);
  const milliseconds = Date.parse(raw);
  if (!Number.isFinite(milliseconds)) {
    throw new NflOddsError('upstream_malformed', `${label} is malformed.`);
  }
  return new Date(milliseconds).toISOString();
}

function price(value: unknown): number {
  if (!Number.isInteger(value) || Math.abs(value as number) < 100 || Math.abs(value as number) > 100_000) {
    throw new NflOddsError('upstream_malformed', 'An upstream American odds price is malformed.');
  }
  return value as number;
}

function point(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000) {
    throw new NflOddsError('upstream_malformed', 'An upstream market point is malformed.');
  }
  return value;
}

function outcomeSide(
  market: ProviderMarketKey,
  name: string,
  homeTeam: string,
  awayTeam: string,
): OutcomeSide {
  if (market === 'totals') {
    if (name === 'Over') return 'over';
    if (name === 'Under') return 'under';
  } else {
    if (name === homeTeam) return 'home';
    if (name === awayTeam) return 'away';
  }
  throw new NflOddsError('upstream_malformed', 'An upstream outcome does not match its NFL event.');
}

function normalizeMarket(
  input: unknown,
  eventId: string,
  homeTeam: string,
  awayTeam: string,
): { publicKey: PublicMarketKey; market: PublicOddsMarket } {
  const record = object(input, 'Upstream market');
  if (!['h2h', 'spreads', 'totals'].includes(String(record.key))) {
    throw new NflOddsError('upstream_malformed', 'An upstream market key is unsupported.');
  }
  const key = record.key as ProviderMarketKey;
  if (!Array.isArray(record.outcomes) || record.outcomes.length < 1 || record.outcomes.length > 3) {
    throw new NflOddsError('upstream_malformed', 'Upstream market outcomes are malformed.');
  }
  const sides = new Set<OutcomeSide>();
  const outcomes = record.outcomes.map((inputOutcome) => {
    const item = object(inputOutcome, 'Upstream outcome');
    const label = text(item.name, 'Upstream outcome name');
    const side = outcomeSide(key, label, homeTeam, awayTeam);
    if (sides.has(side)) {
      throw new NflOddsError('upstream_malformed', 'Upstream market outcomes contain a duplicate side.');
    }
    sides.add(side);
    const applicablePoint = key === 'h2h' ? undefined : point(item.point);
    return {
      id: `${eventId}:${key}:${side}`,
      side,
      label,
      americanOdds: price(item.price),
      ...(applicablePoint === undefined ? {} : { point: applicablePoint }),
    } satisfies PublicOddsOutcome;
  });
  const updatedAt = timestamp(record.last_update, 'Upstream market update timestamp', false);
  const names = {
    h2h: ['moneyline', 'Moneyline'],
    spreads: ['spread', 'Spread'],
    totals: ['total', 'Total'],
  } as const;
  const [publicKey, name] = names[key];
  return {
    publicKey,
    market: { key, name, ...(updatedAt ? { updatedAt } : {}), outcomes },
  };
}

function normalizeEvent(input: unknown, nowMilliseconds: number): PublicNflOddsEvent | null {
  const record = object(input, 'Upstream event');
  if (record.sport_key !== NFL_SPORT) {
    throw new NflOddsError('upstream_malformed', 'Upstream event sport is not NFL.');
  }
  const id = text(record.id, 'Upstream event identifier', 128);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new NflOddsError('upstream_malformed', 'Upstream event identifier is malformed.');
  }
  const commenceTime = timestamp(record.commence_time, 'Upstream event start time')!;
  if (Date.parse(commenceTime) <= nowMilliseconds) return null;
  const homeTeam = text(record.home_team, 'Upstream home team');
  const awayTeam = text(record.away_team, 'Upstream away team');
  if (homeTeam === awayTeam) {
    throw new NflOddsError('upstream_malformed', 'Upstream NFL teams must be distinct.');
  }
  if (!Array.isArray(record.bookmakers)) {
    throw new NflOddsError('upstream_malformed', 'Upstream bookmakers are malformed.');
  }
  const matching = record.bookmakers.filter((candidate) => {
    const bookmaker = object(candidate, 'Upstream bookmaker');
    return bookmaker.key === NFL_BOOKMAKER_KEY;
  });
  if (matching.length > 1) {
    throw new NflOddsError('upstream_malformed', 'Upstream response contains duplicate configured bookmakers.');
  }
  if (matching.length === 0) {
    return { id, commenceTime, homeTeam, awayTeam, markets: {} };
  }
  const bookmaker = object(matching[0], 'Configured upstream bookmaker');
  if (!Array.isArray(bookmaker.markets)) {
    throw new NflOddsError('upstream_malformed', 'Configured upstream bookmaker markets are malformed.');
  }
  const markets: PublicNflOddsEvent['markets'] = {};
  for (const inputMarket of bookmaker.markets) {
    const normalized = normalizeMarket(inputMarket, id, homeTeam, awayTeam);
    if (markets[normalized.publicKey]) {
      throw new NflOddsError('upstream_malformed', 'Configured bookmaker contains a duplicate market.');
    }
    markets[normalized.publicKey] = normalized.market;
  }
  const bookmakerUpdatedAt = timestamp(
    bookmaker.last_update,
    'Configured bookmaker update timestamp',
    false,
  );
  return {
    id,
    commenceTime,
    homeTeam,
    awayTeam,
    ...(bookmakerUpdatedAt ? { bookmakerUpdatedAt } : {}),
    markets,
  };
}

export function normalizeNflOdds(input: unknown, fetchedAt: Date): NflOddsSnapshot {
  if (!Number.isFinite(fetchedAt.getTime())) {
    throw new NflOddsError('upstream_malformed', 'Server fetch timestamp is invalid.');
  }
  if (!Array.isArray(input) || input.length > MAX_EVENTS) {
    throw new NflOddsError('upstream_malformed', 'Upstream NFL schedule is malformed.');
  }
  const identifiers = new Set<string>();
  const events: PublicNflOddsEvent[] = [];
  for (const inputEvent of input) {
    const event = normalizeEvent(inputEvent, fetchedAt.getTime());
    if (!event) continue;
    if (identifiers.has(event.id)) {
      throw new NflOddsError('upstream_malformed', 'Upstream NFL schedule contains a duplicate event.');
    }
    identifiers.add(event.id);
    events.push(event);
  }
  events.sort((left, right) => left.commenceTime.localeCompare(right.commenceTime)
    || left.id.localeCompare(right.id));
  return {
    schemaVersion: 1,
    sport: NFL_SPORT,
    source: {
      provider: 'The Odds API',
      bookmakerKey: NFL_BOOKMAKER_KEY,
      bookmakerName: NFL_BOOKMAKER_NAME,
    },
    fetchedAt: fetchedAt.toISOString(),
    events,
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null
    && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > ODDS_MAXIMUM_RESPONSE_BYTES)) {
    throw new NflOddsError('upstream_malformed', 'Upstream response exceeds the size limit.');
  }
  if (!response.body) {
    throw new NflOddsError('upstream_malformed', 'Upstream response body is missing.');
  }
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
        throw new NflOddsError('upstream_malformed', 'Upstream response exceeds the size limit.');
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    throw new NflOddsError('upstream_malformed', 'Upstream response is not valid JSON.');
  }
}

export async function fetchNflOdds(options: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeoutMilliseconds?: number;
}): Promise<NflOddsSnapshot> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new NflOddsError('upstream_unavailable', 'Odds provider credential is unavailable.');
  const url = new URL(UPSTREAM_URL);
  url.searchParams.set('apiKey', apiKey);
  url.searchParams.set('bookmakers', NFL_BOOKMAKER_KEY);
  url.searchParams.set('markets', 'h2h,spreads,totals');
  url.searchParams.set('oddsFormat', 'american');
  url.searchParams.set('dateFormat', 'iso');
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMilliseconds ?? ODDS_UPSTREAM_TIMEOUT_MILLISECONDS,
  );
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (response.status === 429) {
      throw new NflOddsError('upstream_rate_limited', 'Odds provider rate limit was reached.');
    }
    if (!response.ok) {
      throw new NflOddsError('upstream_unavailable', `Odds provider returned HTTP ${response.status}.`);
    }
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.startsWith('application/json')) {
      throw new NflOddsError('upstream_malformed', 'Odds provider response type is not JSON.');
    }
    return normalizeNflOdds(await readBoundedJson(response), (options.now ?? (() => new Date()))());
  } catch (error) {
    if (error instanceof NflOddsError) throw error;
    throw new NflOddsError(
      'upstream_unavailable',
      controller.signal.aborted ? 'Odds provider request timed out.' : 'Odds provider request failed.',
    );
  } finally {
    clearTimeout(timeout);
  }
}

export interface OddsCacheEntry {
  snapshot: NflOddsSnapshot;
  fetchedAtMilliseconds: number;
}

export type OddsRefreshClaim =
  | { kind: 'acquired'; previous: OddsCacheEntry | null }
  | { kind: 'fresh'; entry: OddsCacheEntry }
  | { kind: 'busy'; entry: OddsCacheEntry | null }
  | { kind: 'backoff'; entry: OddsCacheEntry | null };

export interface NflOddsCache {
  load(): Promise<OddsCacheEntry | null>;
  claim(now: Date, token: string): Promise<OddsRefreshClaim>;
  store(token: string, entry: OddsCacheEntry): Promise<void>;
  markFailure(token: string, retryAt: Date): Promise<void>;
}

function cacheAge(entry: OddsCacheEntry, now: Date): number {
  return now.getTime() - entry.fetchedAtMilliseconds;
}

function isFresh(entry: OddsCacheEntry, now: Date): boolean {
  const age = cacheAge(entry, now);
  return age >= 0 && age < ODDS_FRESH_MILLISECONDS;
}

function canServeStale(entry: OddsCacheEntry | null, now: Date): entry is OddsCacheEntry {
  if (!entry) return false;
  const age = cacheAge(entry, now);
  return age >= ODDS_FRESH_MILLISECONDS && age <= ODDS_MAXIMUM_STALE_MILLISECONDS;
}

function publicResponse(
  entry: OddsCacheEntry,
  now: Date,
  status: 'fresh' | 'stale',
  staleReason?: PublicNflOddsResponse['cache']['staleReason'],
): PublicNflOddsResponse {
  return {
    ...entry.snapshot,
    // A six-hour cache can outlive an event's pregame window. Re-filter at serve time
    // so a previously valid snapshot never exposes an already-started game.
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

async function waitForColdRefresh(
  cache: NflOddsCache,
  now: () => Date,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<OddsCacheEntry | null> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(250);
    const entry = await cache.load();
    if (entry && isFresh(entry, now())) return entry;
  }
  return null;
}

export async function resolveNflOdds(options: {
  apiKey: string;
  cache: NflOddsCache;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  token?: () => string;
}): Promise<PublicNflOddsResponse> {
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const requestTime = now();
  let initial: OddsCacheEntry | null;
  try {
    initial = await options.cache.load();
  } catch {
    throw new NflOddsError('cache_unavailable', 'Shared odds cache is unavailable.');
  }
  if (initial && isFresh(initial, requestTime)) return publicResponse(initial, requestTime, 'fresh');

  const token = (options.token ?? randomUUID)();
  let claim: OddsRefreshClaim;
  try {
    claim = await options.cache.claim(requestTime, token);
  } catch {
    throw new NflOddsError('cache_unavailable', 'Shared odds cache is unavailable.');
  }
  if (claim.kind === 'fresh') return publicResponse(claim.entry, requestTime, 'fresh');
  if (claim.kind === 'backoff') {
    if (canServeStale(claim.entry, requestTime)) {
      return publicResponse(claim.entry, requestTime, 'stale', 'refresh_backoff');
    }
    throw new NflOddsError('upstream_unavailable', 'Odds refresh is temporarily unavailable.');
  }
  if (claim.kind === 'busy') {
    if (canServeStale(claim.entry, requestTime)) {
      return publicResponse(claim.entry, requestTime, 'stale', 'refresh_in_progress');
    }
    let refreshed: OddsCacheEntry | null;
    try {
      refreshed = await waitForColdRefresh(options.cache, now, sleep);
    } catch {
      throw new NflOddsError('cache_unavailable', 'Shared odds cache is unavailable.');
    }
    if (refreshed) return publicResponse(refreshed, now(), 'fresh');
    throw new NflOddsError('upstream_unavailable', 'Initial odds refresh did not complete in time.');
  }

  let snapshot: NflOddsSnapshot;
  try {
    snapshot = await fetchNflOdds({
      apiKey: options.apiKey,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      now,
    });
  } catch (error) {
    const oddsError = error instanceof NflOddsError
      ? error
      : new NflOddsError('upstream_unavailable', 'Odds provider request failed.');
    const backoff = oddsError.code === 'upstream_rate_limited'
      ? ODDS_RATE_LIMIT_BACKOFF_MILLISECONDS
      : ODDS_REFRESH_BACKOFF_MILLISECONDS;
    try {
      await options.cache.markFailure(token, new Date(now().getTime() + backoff));
    } catch {
      if (!canServeStale(claim.previous, now())) {
        throw new NflOddsError('cache_unavailable', 'Shared odds cache failure could not be recorded.');
      }
    }
    const fallbackTime = now();
    if (canServeStale(claim.previous, fallbackTime)) {
      return publicResponse(claim.previous, fallbackTime, 'stale', 'upstream_unavailable');
    }
    throw oddsError;
  }

  const entry = {
    snapshot,
    fetchedAtMilliseconds: Date.parse(snapshot.fetchedAt),
  } satisfies OddsCacheEntry;
  try {
    await options.cache.store(token, entry);
  } catch {
    throw new NflOddsError('cache_unavailable', 'Validated odds could not be stored in the shared cache.');
  }
  return publicResponse(entry, now(), 'fresh');
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function validIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validOutcome(
  value: unknown,
  event: Record<string, unknown>,
  market: ProviderMarketKey,
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const outcome = value as Record<string, unknown>;
  const expectedSides = market === 'totals' ? ['over', 'under'] : ['home', 'away'];
  const expectedLabel = outcome.side === 'home' ? event.homeTeam
    : outcome.side === 'away' ? event.awayTeam
      : outcome.side === 'over' ? 'Over' : 'Under';
  return exactKeys(outcome, market === 'h2h'
    ? ['id', 'side', 'label', 'americanOdds']
    : ['id', 'side', 'label', 'americanOdds', 'point'])
    && typeof outcome.side === 'string' && expectedSides.includes(outcome.side)
    && outcome.id === `${event.id}:${market}:${outcome.side}`
    && outcome.label === expectedLabel
    && typeof outcome.label === 'string' && outcome.label.length > 0
    && Number.isInteger(outcome.americanOdds) && Math.abs(outcome.americanOdds as number) >= 100
    && Math.abs(outcome.americanOdds as number) <= 100_000
    && (market === 'h2h'
      ? !('point' in outcome)
      : typeof outcome.point === 'number' && Number.isFinite(outcome.point) && Math.abs(outcome.point) <= 1_000);
}

/** Rejects malformed or manually altered Firestore cache payloads before they are served. */
export function isNflOddsSnapshot(value: unknown): value is NflOddsSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  const source = snapshot.source as Record<string, unknown> | undefined;
  if (!exactKeys(snapshot, ['schemaVersion', 'sport', 'source', 'fetchedAt', 'events'])
    || snapshot.schemaVersion !== 1 || snapshot.sport !== NFL_SPORT
    || !source || source.provider !== 'The Odds API'
    || !exactKeys(source, ['provider', 'bookmakerKey', 'bookmakerName'])
    || source.bookmakerKey !== NFL_BOOKMAKER_KEY || source.bookmakerName !== NFL_BOOKMAKER_NAME
    || !validIsoTimestamp(snapshot.fetchedAt)
    || !Array.isArray(snapshot.events) || snapshot.events.length > MAX_EVENTS) return false;
  const eventIds = new Set<string>();
  for (const inputEvent of snapshot.events) {
    if (!inputEvent || typeof inputEvent !== 'object' || Array.isArray(inputEvent)) return false;
    const event = inputEvent as Record<string, unknown>;
    if (!exactKeys(event, ['id', 'commenceTime', 'homeTeam', 'awayTeam', 'bookmakerUpdatedAt', 'markets'])
      || typeof event.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(event.id)
      || eventIds.has(event.id) || typeof event.homeTeam !== 'string' || !event.homeTeam
      || typeof event.awayTeam !== 'string' || !event.awayTeam || event.homeTeam === event.awayTeam
      || !validIsoTimestamp(event.commenceTime)
      || ('bookmakerUpdatedAt' in event && !validIsoTimestamp(event.bookmakerUpdatedAt))
      || !event.markets || typeof event.markets !== 'object' || Array.isArray(event.markets)) return false;
    eventIds.add(event.id);
    const markets = event.markets as Record<string, unknown>;
    if (!Object.keys(markets).every((key) => ['moneyline', 'spread', 'total'].includes(key))) return false;
    for (const [publicKey, providerKey, name] of [
      ['moneyline', 'h2h', 'Moneyline'],
      ['spread', 'spreads', 'Spread'],
      ['total', 'totals', 'Total'],
    ] as const) {
      if (!(publicKey in markets)) continue;
      const market = markets[publicKey] as Record<string, unknown>;
      if (!market || typeof market !== 'object' || Array.isArray(market)
        || !exactKeys(market, ['key', 'name', 'updatedAt', 'outcomes'])
        || market.key !== providerKey || market.name !== name
        || ('updatedAt' in market && !validIsoTimestamp(market.updatedAt))
        || !Array.isArray(market.outcomes) || market.outcomes.length < 1 || market.outcomes.length > 3
        || new Set(market.outcomes.map((outcome) => (outcome as Record<string, unknown>)?.side)).size !== market.outcomes.length
        || !market.outcomes.every((outcome) => validOutcome(outcome, event, providerKey))) return false;
    }
  }
  return true;
}
