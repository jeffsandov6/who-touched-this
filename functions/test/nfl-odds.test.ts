import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import type { Firestore } from 'firebase-admin/firestore';
import { firestoreNflOddsCache } from '../src/odds/firestore-cache.js';
import { handleNflOddsRequest } from '../src/odds/http.js';
import {
  fetchNflOdds,
  NFL_BOOKMAKER_KEY,
  NFL_SPORT,
  NflOddsError,
  normalizeNflOdds,
  ODDS_FRESH_MILLISECONDS,
  ODDS_MAXIMUM_RESPONSE_BYTES,
  resolveNflOdds,
  type NflOddsCache,
  type NflOddsSnapshot,
  type OddsCacheEntry,
  type OddsRefreshClaim,
} from '../src/odds/nfl-odds.js';

const NOW = new Date('2026-11-01T12:00:00.000Z');
const START = '2026-11-08T18:00:00.000Z';

function upstreamEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'event_123',
    sport_key: NFL_SPORT,
    sport_title: 'NFL',
    commence_time: START,
    home_team: 'Chicago Bears',
    away_team: 'Green Bay Packers',
    bookmakers: [{
      key: NFL_BOOKMAKER_KEY,
      title: 'DraftKings',
      last_update: '2026-11-01T11:59:00Z',
      markets: [
        {
          key: 'h2h', last_update: '2026-11-01T11:58:00Z',
          outcomes: [
            { name: 'Chicago Bears', price: 135 },
            { name: 'Green Bay Packers', price: -155 },
          ],
        },
        {
          key: 'spreads', last_update: '2026-11-01T11:57:00Z',
          outcomes: [
            { name: 'Chicago Bears', price: -110, point: 3.5 },
            { name: 'Green Bay Packers', price: -110, point: -3.5 },
          ],
        },
        {
          key: 'totals', last_update: '2026-11-01T11:56:00Z',
          outcomes: [
            { name: 'Over', price: -105, point: 44.5 },
            { name: 'Under', price: -115, point: 44.5 },
          ],
        },
      ],
    }],
    ...overrides,
  };
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

function snapshot(fetchedAt = NOW): NflOddsSnapshot {
  return normalizeNflOdds([upstreamEvent()], fetchedAt);
}

function cacheEntry(fetchedAt = NOW): OddsCacheEntry {
  return { snapshot: snapshot(fetchedAt), fetchedAtMilliseconds: fetchedAt.getTime() };
}

class MemoryCache implements NflOddsCache {
  entry: OddsCacheEntry | null;
  refreshToken: string | null = null;
  retryAt = 0;
  claims = 0;
  stores = 0;
  failures = 0;

  constructor(entry: OddsCacheEntry | null = null) {
    this.entry = entry;
  }

  async load(): Promise<OddsCacheEntry | null> {
    return this.entry;
  }

  async claim(now: Date, token: string): Promise<OddsRefreshClaim> {
    this.claims += 1;
    if (this.entry && now.getTime() - this.entry.fetchedAtMilliseconds >= 0
      && now.getTime() - this.entry.fetchedAtMilliseconds < ODDS_FRESH_MILLISECONDS) {
      return { kind: 'fresh', entry: this.entry };
    }
    if (this.retryAt > now.getTime()) return { kind: 'backoff', entry: this.entry };
    if (this.refreshToken) return { kind: 'busy', entry: this.entry };
    this.refreshToken = token;
    return { kind: 'acquired', previous: this.entry };
  }

  async store(token: string, entry: OddsCacheEntry): Promise<void> {
    assert.equal(token, this.refreshToken);
    this.entry = entry;
    this.refreshToken = null;
    this.retryAt = 0;
    this.stores += 1;
  }

  async markFailure(token: string, retryAt: Date): Promise<void> {
    if (token !== this.refreshToken) return;
    this.refreshToken = null;
    this.retryAt = retryAt.getTime();
    this.failures += 1;
  }
}

test('normalizes NFL moneyline, spread, and total markets into stable public identifiers', () => {
  const result = normalizeNflOdds([upstreamEvent()], NOW);
  assert.deepEqual(result.source, {
    provider: 'The Odds API', bookmakerKey: 'draftkings', bookmakerName: 'DraftKings',
  });
  assert.equal(result.fetchedAt, NOW.toISOString());
  assert.equal(result.events.length, 1);
  const event = result.events[0]!;
  assert.equal(event.commenceTime, START);
  assert.equal(event.bookmakerUpdatedAt, '2026-11-01T11:59:00.000Z');
  assert.deepEqual(event.markets.moneyline?.outcomes.map((outcome) => [outcome.id, outcome.americanOdds]), [
    ['event_123:h2h:home', 135], ['event_123:h2h:away', -155],
  ]);
  assert.deepEqual(event.markets.spread?.outcomes.map((outcome) => [outcome.id, outcome.point]), [
    ['event_123:spreads:home', 3.5], ['event_123:spreads:away', -3.5],
  ]);
  assert.deepEqual(event.markets.total?.outcomes.map((outcome) => [outcome.id, outcome.point]), [
    ['event_123:totals:over', 44.5], ['event_123:totals:under', 44.5],
  ]);
});

test('missing configured bookmaker and absent markets produce usable empty market records', () => {
  const noBookmaker = normalizeNflOdds([upstreamEvent({ bookmakers: [] })], NOW);
  assert.deepEqual(noBookmaker.events[0]?.markets, {});

  const event = upstreamEvent();
  const bookmaker = (event.bookmakers as Array<Record<string, unknown>>)[0]!;
  bookmaker.markets = [(bookmaker.markets as unknown[])[0]];
  const oneMarket = normalizeNflOdds([event], NOW);
  assert.ok(oneMarket.events[0]?.markets.moneyline);
  assert.equal(oneMarket.events[0]?.markets.spread, undefined);
  assert.equal(oneMarket.events[0]?.markets.total, undefined);
});

test('empty schedules are successful and already-started events are excluded', () => {
  assert.deepEqual(normalizeNflOdds([], NOW).events, []);
  assert.deepEqual(normalizeNflOdds([
    upstreamEvent({ commence_time: NOW.toISOString() }),
    upstreamEvent({ id: 'old_event', commence_time: '2026-10-01T00:00:00Z' }),
  ], NOW).events, []);
});

test('malformed odds, points, outcomes, event identifiers, and payloads are rejected', () => {
  const mutations: Array<(event: Record<string, unknown>) => unknown> = [
    (event) => {
      const market = (((event.bookmakers as Array<Record<string, unknown>>)[0]!.markets as Array<Record<string, unknown>>)[0]!);
      (market.outcomes as Array<Record<string, unknown>>)[0]!.price = -99;
      return [event];
    },
    (event) => {
      const market = (((event.bookmakers as Array<Record<string, unknown>>)[0]!.markets as Array<Record<string, unknown>>)[1]!);
      delete (market.outcomes as Array<Record<string, unknown>>)[0]!.point;
      return [event];
    },
    (event) => {
      const market = (((event.bookmakers as Array<Record<string, unknown>>)[0]!.markets as Array<Record<string, unknown>>)[2]!);
      (market.outcomes as Array<Record<string, unknown>>)[0]!.name = 'Push';
      return [event];
    },
    (event) => [{ ...event, id: 'unsafe/id' }],
  ];
  for (const mutate of mutations) {
    assert.throws(() => normalizeNflOdds(mutate(upstreamEvent()), NOW), NflOddsError);
  }
  assert.throws(() => normalizeNflOdds({}, NOW), /schedule is malformed/);
});

test('provider request uses only the fixed NFL, DraftKings, market, and format parameters', async () => {
  let requested: URL | null = null;
  const fetchImpl: typeof fetch = async (input) => {
    requested = new URL(String(input));
    return jsonResponse([upstreamEvent()]);
  };
  const result = await fetchNflOdds({ apiKey: 'synthetic-key', fetchImpl, now: () => NOW });
  assert.equal(result.events.length, 1);
  assert.equal(requested!.origin, 'https://api.the-odds-api.com');
  assert.equal(requested!.pathname, '/v4/sports/americanfootball_nfl/odds');
  assert.deepEqual([...requested!.searchParams.keys()].sort(), [
    'apiKey', 'bookmakers', 'dateFormat', 'markets', 'oddsFormat',
  ]);
  assert.equal(requested!.searchParams.get('bookmakers'), 'draftkings');
  assert.equal(requested!.searchParams.get('markets'), 'h2h,spreads,totals');
  assert.equal(requested!.searchParams.get('oddsFormat'), 'american');
});

test('invalid, oversized, timed-out, rate-limited, and failed upstream responses are bounded', async () => {
  await assert.rejects(fetchNflOdds({
    apiKey: 'x', fetchImpl: async () => new Response('{', { headers: { 'content-type': 'application/json' } }),
  }), (error: unknown) => error instanceof NflOddsError && error.code === 'upstream_malformed');
  await assert.rejects(fetchNflOdds({
    apiKey: 'x', fetchImpl: async () => new Response('[]', {
      headers: { 'content-type': 'application/json', 'content-length': String(ODDS_MAXIMUM_RESPONSE_BYTES + 1) },
    }),
  }), /size limit/);
  await assert.rejects(fetchNflOdds({
    apiKey: 'x', fetchImpl: async () => jsonResponse({}, { status: 429 }),
  }), (error: unknown) => error instanceof NflOddsError && error.code === 'upstream_rate_limited');
  await assert.rejects(fetchNflOdds({
    apiKey: 'x', fetchImpl: async () => jsonResponse({}, { status: 500 }),
  }), (error: unknown) => error instanceof NflOddsError && error.code === 'upstream_unavailable');
  const neverFetch: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  await assert.rejects(fetchNflOdds({
    apiKey: 'x', fetchImpl: neverFetch, timeoutMilliseconds: 5,
  }), /timed out/);
  const hangingBody: typeof fetch = async (_input, init) => new Response(new ReadableStream({
    start(controller) {
      init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
    },
  }), { headers: { 'content-type': 'application/json' } });
  await assert.rejects(fetchNflOdds({
    apiKey: 'x', fetchImpl: hangingBody, timeoutMilliseconds: 5,
  }), /timed out/);
});

test('fresh shared cache hits never contact the provider', async () => {
  const cache = new MemoryCache(cacheEntry());
  let fetches = 0;
  const result = await resolveNflOdds({
    apiKey: 'x', cache, now: () => NOW,
    fetchImpl: async () => { fetches += 1; return jsonResponse([]); },
  });
  assert.equal(result.cache.status, 'fresh');
  assert.equal(fetches, 0);
  assert.equal(cache.claims, 0);
});

test('cached events are removed once their kickoff time passes', async () => {
  const kickoff = new Date(NOW.getTime() + 60 * 60 * 1000);
  const servedAt = new Date(NOW.getTime() + 2 * 60 * 60 * 1000);
  const cachedSnapshot = normalizeNflOdds([upstreamEvent({ commence_time: kickoff.toISOString() })], NOW);
  const cache = new MemoryCache({ snapshot: cachedSnapshot, fetchedAtMilliseconds: NOW.getTime() });
  const result = await resolveNflOdds({ apiKey: 'x', cache, now: () => servedAt });
  assert.equal(result.cache.status, 'fresh');
  assert.deepEqual(result.events, []);
});

test('expired cache refreshes once and stores a validated fresh response', async () => {
  const requestTime = new Date(NOW.getTime() + ODDS_FRESH_MILLISECONDS + 1);
  const cache = new MemoryCache(cacheEntry(NOW));
  let fetches = 0;
  const result = await resolveNflOdds({
    apiKey: 'x', cache, now: () => requestTime, token: () => 'refresh-one',
    fetchImpl: async () => { fetches += 1; return jsonResponse([upstreamEvent()]); },
  });
  assert.equal(result.cache.status, 'fresh');
  assert.equal(fetches, 1);
  assert.equal(cache.stores, 1);
  assert.equal(cache.entry?.snapshot.fetchedAt, requestTime.toISOString());
});

test('concurrent cold misses share one refresh instead of bursting upstream', async () => {
  const cache = new MemoryCache();
  let fetches = 0;
  let releaseFetch!: () => void;
  const fetchGate = new Promise<void>((resolve) => { releaseFetch = resolve; });
  let fetchStarted!: () => void;
  const started = new Promise<void>((resolve) => { fetchStarted = resolve; });
  const fetchImpl: typeof fetch = async () => {
    fetches += 1;
    fetchStarted();
    await fetchGate;
    return jsonResponse([upstreamEvent()]);
  };
  const first = resolveNflOdds({
    apiKey: 'x', cache, fetchImpl, now: () => NOW, token: () => 'first',
  });
  await started;
  const second = resolveNflOdds({
    apiKey: 'x', cache, fetchImpl, now: () => NOW, token: () => 'second',
    sleep: async () => { await first; },
  });
  releaseFetch();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(fetches, 1);
  assert.equal(left.fetchedAt, right.fetchedAt);
  assert.equal(cache.stores, 1);
});

test('Firestore cache transaction gives one concurrent caller the shared refresh lease', async () => {
  let data: Record<string, unknown> | undefined;
  let transactionTail: Promise<unknown> = Promise.resolve();
  const snapshot = () => ({ exists: data !== undefined, data: () => data });
  const reference = { get: async () => snapshot() };
  const transaction = {
    get: async () => snapshot(),
    set: (_reference: unknown, value: Record<string, unknown>, options?: { merge?: boolean }) => {
      data = options?.merge ? { ...(data ?? {}), ...value } : { ...value };
    },
  };
  const firestore = {
    doc(path: string) {
      assert.equal(path, 'platformCache/nflOdds');
      return reference;
    },
    runTransaction<T>(callback: (value: typeof transaction) => Promise<T>): Promise<T> {
      const result = transactionTail.then(() => callback(transaction));
      transactionTail = result.catch(() => undefined);
      return result;
    },
  } as unknown as Firestore;
  const cache = firestoreNflOddsCache(firestore);
  const [first, second] = await Promise.all([
    cache.claim(NOW, 'first-token'),
    cache.claim(NOW, 'second-token'),
  ]);
  assert.equal(first.kind, 'acquired');
  assert.equal(second.kind, 'busy');
  const entry = cacheEntry();
  await cache.store('first-token', entry);
  assert.deepEqual(await cache.load(), entry);
  assert.equal((await cache.claim(NOW, 'third-token')).kind, 'fresh');
});

test('temporary upstream failure serves eligible cache as explicitly stale and records backoff', async () => {
  const requestTime = new Date(NOW.getTime() + ODDS_FRESH_MILLISECONDS + 1);
  const cache = new MemoryCache(cacheEntry(NOW));
  const result = await resolveNflOdds({
    apiKey: 'x', cache, now: () => requestTime,
    fetchImpl: async () => { throw new Error('offline'); },
  });
  assert.equal(result.cache.status, 'stale');
  assert.equal(result.cache.staleReason, 'upstream_unavailable');
  assert.equal(cache.failures, 1);

  let fetches = 0;
  const duringBackoff = await resolveNflOdds({
    apiKey: 'x', cache, now: () => requestTime,
    fetchImpl: async () => { fetches += 1; return jsonResponse([]); },
  });
  assert.equal(duringBackoff.cache.staleReason, 'refresh_backoff');
  assert.equal(fetches, 0);
});

test('cache older than the maximum stale period is never served after upstream failure', async () => {
  const requestTime = new Date(NOW.getTime() + 24 * 60 * 60 * 1000 + 1);
  const cache = new MemoryCache(cacheEntry(NOW));
  await assert.rejects(resolveNflOdds({
    apiKey: 'x', cache, now: () => requestTime,
    fetchImpl: async () => { throw new Error('offline'); },
  }), (error: unknown) => error instanceof NflOddsError && error.code === 'upstream_unavailable');
  assert.equal(cache.failures, 1);
});

test('GET-only handler returns stable JSON and rejects methods and cache-key query variants', async () => {
  const cache = new MemoryCache(cacheEntry());
  const invoke = async (method: string, query: Record<string, string> = {}) => {
    const headers = new Map<string, string>();
    let statusCode = 0;
    let body: unknown;
    const response = {
      set(name: string, value: string) { headers.set(name, value); return this; },
      status(value: number) { statusCode = value; return this; },
      json(value: unknown) { body = value; return this; },
    };
    await handleNflOddsRequest({ method, query }, response, { apiKey: 'x', cache, now: () => NOW });
    return { headers, statusCode, body };
  };
  const success = await invoke('GET');
  assert.equal(success.statusCode, 200);
  assert.match(success.headers.get('Cache-Control') ?? '', /s-maxage=900/);
  assert.equal((success.body as { schemaVersion: number }).schemaVersion, 1);
  assert.equal((await invoke('POST')).statusCode, 405);
  assert.equal((await invoke('GET', { bookmaker: 'fanduel' })).statusCode, 400);
});

test('deployed function binds only ODDS_API_KEY and Hosting exposes one exact same-origin route', async () => {
  const [config, index, firebaseText, release] = await Promise.all([
    readFile(new URL('../../src/config.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../src/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../../firebase.json', import.meta.url), 'utf8'),
    readFile(new URL('../../../scripts/release/config.mjs', import.meta.url), 'utf8'),
  ]);
  assert.match(config, /oddsApiKey = defineSecret\('ODDS_API_KEY'\)/);
  assert.match(index, /export const nflOdds = onRequest\(\{[\s\S]*?secrets: \[oddsApiKey\]/);
  assert.doesNotMatch(index.match(/export const nflOdds[\s\S]*$/)?.[0] ?? '', /RESEND_API_KEY|GITHUB_WEBHOOK_SECRET|WTT_SOLANA_RPC_URL/);
  const firebase = JSON.parse(firebaseText);
  const rewrites = firebase.hosting.rewrites.filter((item: { source?: string }) => item.source === '/api/odds/nfl');
  assert.deepEqual(rewrites, [{ source: '/api/odds/nfl', function: { functionId: 'nflOdds', region: 'us-central1' } }]);
  assert.match(release, /'ODDS_API_KEY'/);
});
