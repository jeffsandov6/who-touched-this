import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import type { Firestore } from 'firebase-admin/firestore';
import {
  firestoreOddsBudget,
  ODDS_BUDGET_DOCUMENT,
  ODDS_CREDIT_SAFETY_MARGIN,
  ODDS_MONTHLY_CREDIT_LIMIT,
  ODDS_RESERVATION_MILLISECONDS,
} from '../src/odds/firestore-budget.js';
import { firestoreOddsCache, oddsCacheDocument } from '../src/odds/firestore-cache.js';
import { handleOddsRequest } from '../src/odds/http.js';
import { LEAGUES, SUPPORTED_LEAGUES, type LeagueConfig } from '../src/odds/leagues.js';
import {
  fetchLeagueOdds,
  isOddsSnapshot,
  normalizeOdds,
  ODDS_FRESH_MILLISECONDS,
  ODDS_MAXIMUM_RESPONSE_BYTES,
  ODDS_MAXIMUM_STALE_MILLISECONDS,
  ODDS_TRANSIENT_BACKOFF_MILLISECONDS,
  OddsError,
  quotaObservation,
  resolveOdds,
  type BudgetClaim,
  type BudgetReservation,
  type OddsBudget,
  type OddsCache,
  type OddsCacheEntry,
  type OddsRefreshClaim,
  type OddsSnapshot,
  type ProviderQuotaObservation,
  type StaleReason,
} from '../src/odds/odds.js';

const NOW = new Date('2026-11-01T12:00:00.000Z');
const START = '2026-11-08T18:00:00.000Z';

function upstreamEvent(league: LeagueConfig, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const soccer = league.allowDraw;
  const home = soccer ? 'Arsenal' : league.id === 'nba' ? 'Chicago Bulls' : 'Chicago Bears';
  const away = soccer ? 'Liverpool' : league.id === 'nba' ? 'Milwaukee Bucks' : 'Green Bay Packers';
  const h2h = [
    { name: home, price: 135 },
    ...(soccer ? [{ name: 'Draw', price: 240 }] : []),
    { name: away, price: -155 },
  ];
  const markets: Record<string, unknown>[] = [{
    key: 'h2h', last_update: '2026-11-01T11:58:00Z', outcomes: h2h,
  }];
  if (!soccer) markets.push(
    {
      key: 'spreads', last_update: '2026-11-01T11:57:00Z',
      outcomes: [{ name: home, price: -110, point: 3.5 }, { name: away, price: -110, point: -3.5 }],
    },
    {
      key: 'totals', last_update: '2026-11-01T11:56:00Z',
      outcomes: [{ name: 'Over', price: -105, point: 44.5 }, { name: 'Under', price: -115, point: 44.5 }],
    },
  );
  return {
    id: 'event_123', sport_key: league.sportKey, commence_time: START,
    home_team: home, away_team: away,
    bookmakers: [{
      key: league.bookmakers[0]!.key, title: league.bookmakers[0]!.name,
      last_update: '2026-11-01T11:59:00Z', markets,
    }],
    ...overrides,
  };
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(value), { status: init.status ?? 200, headers });
}

function snapshot(league: LeagueConfig = LEAGUES.nfl, fetchedAt = NOW): OddsSnapshot {
  return normalizeOdds([upstreamEvent(league)], fetchedAt, league);
}

function cacheEntry(league: LeagueConfig = LEAGUES.nfl, fetchedAt = NOW): OddsCacheEntry {
  return { snapshot: snapshot(league, fetchedAt), fetchedAtMilliseconds: fetchedAt.getTime() };
}

class MemoryCache implements OddsCache {
  entry: OddsCacheEntry | null;
  refreshToken: string | null = null;
  retryAt = 0;
  retryReason: StaleReason = 'refresh_backoff';
  claims = 0;
  stores = 0;
  failures = 0;

  constructor(entry: OddsCacheEntry | null = null) { this.entry = entry; }
  async load(): Promise<OddsCacheEntry | null> { return this.entry; }
  async claim(now: Date, token: string): Promise<OddsRefreshClaim> {
    this.claims += 1;
    const age = this.entry ? now.getTime() - this.entry.fetchedAtMilliseconds : -1;
    if (this.entry && age >= 0 && age < ODDS_FRESH_MILLISECONDS) return { kind: 'fresh', entry: this.entry };
    if (this.retryAt > now.getTime()) return {
      kind: 'backoff', entry: this.entry, reason: this.retryReason,
    };
    if (this.refreshToken) return { kind: 'busy', entry: this.entry };
    this.refreshToken = token;
    return { kind: 'acquired', previous: this.entry };
  }
  async store(token: string, entry: OddsCacheEntry): Promise<void> {
    assert.equal(token, this.refreshToken);
    this.entry = entry; this.refreshToken = null; this.retryAt = 0; this.stores += 1;
  }
  async markFailure(token: string, retryAt: Date, reason: StaleReason): Promise<void> {
    if (token !== this.refreshToken) return;
    this.refreshToken = null; this.retryAt = retryAt.getTime(); this.retryReason = reason; this.failures += 1;
  }
}

class MemoryBudget implements OddsBudget {
  claims = 0;
  settlements = 0;
  blocked: BudgetClaim | null = null;
  async reserve(_now: Date, token: string, credits: number): Promise<BudgetClaim> {
    this.claims += 1;
    return this.blocked ?? { kind: 'acquired', reservation: { token, credits, quotaRecheck: false } };
  }
  async settle(
    _reservation: BudgetReservation,
    _now: Date,
    _result: { quota: ProviderQuotaObservation | null; quotaExhausted: boolean; successful: boolean },
  ): Promise<{ retryAt?: Date }> { this.settlements += 1; return {}; }
}

function fakeFirestore() {
  const documents = new Map<string, Record<string, unknown>>();
  let transactionTail: Promise<unknown> = Promise.resolve();
  const firestore = {
    doc(path: string) {
      return {
        path,
        async get() { return { data: () => documents.get(path) }; },
      };
    },
    runTransaction<T>(callback: (transaction: {
      get(reference: { path: string }): Promise<{ data(): Record<string, unknown> | undefined }>;
      set(reference: { path: string }, value: Record<string, unknown>, options?: { merge?: boolean }): void;
    }) => Promise<T>): Promise<T> {
      const result = transactionTail.then(() => callback({
        async get(reference) { return { data: () => documents.get(reference.path) }; },
        set(reference, value, options) {
          documents.set(reference.path, options?.merge
            ? { ...(documents.get(reference.path) ?? {}), ...value } : { ...value });
        },
      }));
      transactionTail = result.catch(() => undefined);
      return result;
    },
  } as unknown as Firestore;
  return { firestore, documents };
}

test('seven-league allowlist fixes routes, provider sports, markets, and estimated costs', () => {
  assert.deepEqual(SUPPORTED_LEAGUES.map(({ id, path, sportKey, markets, estimatedCredits }) => ({
    id, path, sportKey, markets: [...markets], estimatedCredits,
  })), [
    { id: 'nfl', path: '/api/odds/nfl', sportKey: 'americanfootball_nfl', markets: ['h2h', 'spreads', 'totals'], estimatedCredits: 3 },
    { id: 'nba', path: '/api/odds/nba', sportKey: 'basketball_nba', markets: ['h2h', 'spreads', 'totals'], estimatedCredits: 3 },
    { id: 'epl', path: '/api/odds/epl', sportKey: 'soccer_epl', markets: ['h2h'], estimatedCredits: 1 },
    { id: 'la-liga', path: '/api/odds/la-liga', sportKey: 'soccer_spain_la_liga', markets: ['h2h'], estimatedCredits: 1 },
    { id: 'serie-a', path: '/api/odds/serie-a', sportKey: 'soccer_italy_serie_a', markets: ['h2h'], estimatedCredits: 1 },
    { id: 'bundesliga', path: '/api/odds/bundesliga', sportKey: 'soccer_germany_bundesliga', markets: ['h2h'], estimatedCredits: 1 },
    { id: 'champions-league', path: '/api/odds/champions-league', sportKey: 'soccer_uefa_champs_league', markets: ['h2h'], estimatedCredits: 1 },
  ]);
});

test('NFL and NBA normalize moneyline, spread, and total with league-scoped stable IDs', () => {
  for (const league of [LEAGUES.nfl, LEAGUES.nba]) {
    const result = normalizeOdds([upstreamEvent(league)], NOW, league);
    assert.equal(result.schemaVersion, 2);
    assert.deepEqual(result.league, { id: league.id, name: league.name });
    const event = result.events[0]!;
    assert.equal(event.id, `${league.id}:event_123`);
    assert.deepEqual(event.markets.moneyline?.outcomes.map(({ id, americanOdds }) => [id, americanOdds]), [
      [`${league.id}:event_123:h2h:home`, 135], [`${league.id}:event_123:h2h:away`, -155],
    ]);
    assert.deepEqual(event.markets.spread?.outcomes.map(({ side, point }) => [side, point]), [['home', 3.5], ['away', -3.5]]);
    assert.deepEqual(event.markets.total?.outcomes.map(({ side, point }) => [side, point]), [['over', 44.5], ['under', 44.5]]);
    assert.ok(isOddsSnapshot(result, league.id));
  }
});

test('soccer normalizes home, draw, and away and permits an absent draw', () => {
  const result = normalizeOdds([upstreamEvent(LEAGUES.epl)], NOW, LEAGUES.epl);
  assert.deepEqual(result.events[0]?.markets.moneyline?.outcomes.map(({ side, id }) => [side, id]), [
    ['home', 'epl:event_123:h2h:home'], ['draw', 'epl:event_123:h2h:draw'], ['away', 'epl:event_123:h2h:away'],
  ]);
  const input = upstreamEvent(LEAGUES.epl);
  const markets = ((input.bookmakers as Array<Record<string, unknown>>)[0]!.markets as Array<Record<string, unknown>>);
  markets[0]!.outcomes = (markets[0]!.outcomes as Array<Record<string, unknown>>).filter(({ name }) => name !== 'Draw');
  assert.deepEqual(normalizeOdds([input], NOW, LEAGUES.epl).events[0]?.markets.moneyline?.outcomes.map(({ side }) => side), ['home', 'away']);
});

test('soccer selects the bookmaker covering the greatest number of upcoming games', () => {
  const first = upstreamEvent(LEAGUES.epl, { id: 'first' });
  const second = upstreamEvent(LEAGUES.epl, { id: 'second' });
  const expired = upstreamEvent(LEAGUES.epl, { id: 'expired', commence_time: NOW.toISOString() });
  const draftKings = structuredClone((first.bookmakers as unknown[])[0]);
  const fanDuel = { ...structuredClone(draftKings as object), key: 'fanduel', title: 'FanDuel' };
  first.bookmakers = [draftKings, fanDuel];
  second.bookmakers = [structuredClone(fanDuel)];
  expired.bookmakers = [structuredClone(draftKings)];
  const result = normalizeOdds([first, second, expired], NOW, LEAGUES.epl);
  assert.equal(result.source.bookmakerKey, 'fanduel');
  assert.equal(result.events.length, 2);
  assert.ok(result.events.every(({ markets }) => markets.moneyline));
});

test('soccer coverage ties use configured bookmaker priority without mixing prices', () => {
  const first = upstreamEvent(LEAGUES.epl, { id: 'first' });
  const second = upstreamEvent(LEAGUES.epl, { id: 'second' });
  const draftKings = structuredClone((first.bookmakers as unknown[])[0]);
  const fanDuel = { ...structuredClone(draftKings as object), key: 'fanduel', title: 'FanDuel' };
  first.bookmakers = [draftKings];
  second.bookmakers = [fanDuel];
  const result = normalizeOdds([first, second], NOW, LEAGUES.epl);
  assert.equal(result.source.bookmakerKey, 'draftkings');
  assert.ok(result.events.find(({ id }) => id === 'epl:first')?.markets.moneyline);
  assert.deepEqual(result.events.find(({ id }) => id === 'epl:second')?.markets, {});
});

test('soccer coverage ignores bookmaker entries with missing match-winner markets', () => {
  const first = upstreamEvent(LEAGUES.epl, { id: 'first' });
  const second = upstreamEvent(LEAGUES.epl, { id: 'second' });
  const draftKings = structuredClone((first.bookmakers as Array<Record<string, unknown>>)[0]!);
  const fanDuel = { ...structuredClone(draftKings), key: 'fanduel', title: 'FanDuel' };
  first.bookmakers = [{ ...draftKings, markets: [] }, fanDuel];
  second.bookmakers = [{ ...structuredClone(draftKings), markets: [] }, structuredClone(fanDuel)];
  const result = normalizeOdds([first, second], NOW, LEAGUES.epl);
  assert.equal(result.source.bookmakerKey, 'fanduel');
  assert.ok(result.events.every(({ markets }) => markets.moneyline));
});

test('missing bookmaker/markets, empty schedules, and expired events remain safe', () => {
  const missing = normalizeOdds([upstreamEvent(LEAGUES.nfl, { bookmakers: [] })], NOW, LEAGUES.nfl);
  assert.deepEqual(missing.source, { provider: 'The Odds API', bookmakerKey: null, bookmakerName: null });
  assert.deepEqual(missing.events[0]?.markets, {});
  const input = upstreamEvent(LEAGUES.nfl);
  ((input.bookmakers as Array<Record<string, unknown>>)[0]!).markets = [];
  assert.deepEqual(normalizeOdds([input], NOW, LEAGUES.nfl).events[0]?.markets, {});
  assert.deepEqual(normalizeOdds([], NOW, LEAGUES.nfl).events, []);
  assert.deepEqual(normalizeOdds([upstreamEvent(LEAGUES.nfl, { commence_time: NOW.toISOString() })], NOW, LEAGUES.nfl).events, []);
});

test('stable identifiers ignore price/point changes and remain unique across leagues', () => {
  const before = snapshot(LEAGUES.nfl);
  const changedInput = upstreamEvent(LEAGUES.nfl);
  const markets = ((changedInput.bookmakers as Array<Record<string, unknown>>)[0]!.markets as Array<Record<string, unknown>>);
  (markets[0]!.outcomes as Array<Record<string, unknown>>)[0]!.price = 150;
  (markets[1]!.outcomes as Array<Record<string, unknown>>)[0]!.point = 4.5;
  const after = normalizeOdds([changedInput], NOW, LEAGUES.nfl);
  const ids = (value: OddsSnapshot) => Object.values(value.events[0]!.markets).flatMap((market) => market!.outcomes.map(({ id }) => id));
  assert.deepEqual(ids(before), ids(after));
  assert.notEqual(before.events[0]!.id, snapshot(LEAGUES.nba).events[0]!.id);
});

test('malformed odds, points, sport, outcomes, IDs, and payloads are rejected', () => {
  const mutations: Array<(event: Record<string, unknown>) => unknown> = [
    (event) => { const markets = ((event.bookmakers as Array<Record<string, unknown>>)[0]!.markets as Array<Record<string, unknown>>); (markets[0]!.outcomes as Array<Record<string, unknown>>)[0]!.price = -99; return [event]; },
    (event) => { const markets = ((event.bookmakers as Array<Record<string, unknown>>)[0]!.markets as Array<Record<string, unknown>>); delete (markets[1]!.outcomes as Array<Record<string, unknown>>)[0]!.point; return [event]; },
    (event) => ({ ...event, sport_key: 'basketball_nba' }),
    (event) => ({ ...event, id: 'unsafe/id' }),
    (event) => { const markets = ((event.bookmakers as Array<Record<string, unknown>>)[0]!.markets as Array<Record<string, unknown>>); (markets[2]!.outcomes as Array<Record<string, unknown>>)[0]!.name = 'Push'; return [event]; },
  ];
  for (const mutate of mutations) assert.throws(() => normalizeOdds(mutate(upstreamEvent(LEAGUES.nfl)), NOW, LEAGUES.nfl), OddsError);
  assert.throws(() => normalizeOdds({}, NOW, LEAGUES.nfl), /schedule is malformed/);
});

test('provider requests use only fixed league configuration and parse quota headers', async () => {
  for (const league of SUPPORTED_LEAGUES) {
    let requested: URL | null = null;
    const result = await fetchLeagueOdds({
      apiKey: 'synthetic-key', league, now: () => NOW,
      fetchImpl: async (input) => {
        requested = new URL(String(input));
        return jsonResponse([upstreamEvent(league)], { headers: {
          'x-requests-remaining': '480', 'x-requests-used': '20', 'x-requests-last': String(league.estimatedCredits),
        } });
      },
    });
    assert.equal(requested!.origin, 'https://api.the-odds-api.com');
    assert.equal(requested!.pathname, `/v4/sports/${league.sportKey}/odds`);
    assert.deepEqual([...requested!.searchParams.keys()].sort(), ['apiKey', 'bookmakers', 'dateFormat', 'markets', 'oddsFormat']);
    assert.equal(requested!.searchParams.get('markets'), league.markets.join(','));
    assert.deepEqual(result.quota, { remaining: 480, used: 20, last: league.estimatedCredits });
  }
  assert.equal(quotaObservation(new Headers({ 'x-requests-used': '1' })), null);
});

test('malformed, oversized, timed-out, and failed provider responses are bounded and classified', async () => {
  const request = (fetchImpl: typeof fetch, timeoutMilliseconds?: number) => fetchLeagueOdds({
    apiKey: 'x', league: LEAGUES.nfl, fetchImpl, ...(timeoutMilliseconds ? { timeoutMilliseconds } : {}),
  });
  await assert.rejects(request(async () => new Response('{', { headers: { 'content-type': 'application/json' } })),
    (error: unknown) => error instanceof OddsError && error.code === 'upstream_malformed');
  await assert.rejects(request(async () => new Response('[]', { headers: {
    'content-type': 'application/json', 'content-length': String(ODDS_MAXIMUM_RESPONSE_BYTES + 1),
  } })), /size limit/);
  await assert.rejects(request(async () => jsonResponse({ error_code: 'EXCEEDED_FREQ_LIMIT' }, { status: 429, headers: { 'retry-after': '120' } })),
    (error: unknown) => error instanceof OddsError && error.code === 'upstream_rate_limited' && error.details.retryAfterMilliseconds === 120_000);
  await assert.rejects(request(async () => jsonResponse({ error_code: 'OUT_OF_USAGE_CREDITS' }, { status: 429 })),
    (error: unknown) => error instanceof OddsError && error.code === 'quota_exhausted');
  await assert.rejects(request(async () => jsonResponse({ error_code: 'INVALID_KEY' }, { status: 401 })),
    (error: unknown) => error instanceof OddsError && error.code === 'upstream_configuration');
  await assert.rejects(request(async () => jsonResponse({}, { status: 500 })),
    (error: unknown) => error instanceof OddsError && error.code === 'upstream_unavailable');
  const never: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  await assert.rejects(request(never, 5), /timed out/);
});

test('fresh shared cache hits avoid both provider and budget', async () => {
  const cache = new MemoryCache(cacheEntry());
  const budget = new MemoryBudget();
  let fetches = 0;
  const result = await resolveOdds({
    apiKey: 'x', league: LEAGUES.nfl, cache, budget, now: () => NOW,
    fetchImpl: async () => { fetches += 1; return jsonResponse([]); },
  });
  assert.equal(result.cache.status, 'fresh');
  assert.equal(result.cache.freshForSeconds, 43_200);
  assert.equal(fetches, 0); assert.equal(budget.claims, 0); assert.equal(cache.claims, 0);
});

test('expired cache reserves budget, refreshes once, and stores valid data', async () => {
  const requestTime = new Date(NOW.getTime() + ODDS_FRESH_MILLISECONDS + 1);
  const cache = new MemoryCache(cacheEntry());
  const budget = new MemoryBudget();
  const result = await resolveOdds({
    apiKey: 'x', league: LEAGUES.nfl, cache, budget, now: () => requestTime, token: () => 'refresh-one',
    fetchImpl: async () => jsonResponse([upstreamEvent(LEAGUES.nfl)]),
  });
  assert.equal(result.cache.status, 'fresh');
  assert.equal(cache.stores, 1); assert.equal(budget.claims, 1); assert.equal(budget.settlements, 1);
});

test('concurrent cold misses in one league share one refresh', async () => {
  const cache = new MemoryCache();
  const budget = new MemoryBudget();
  let fetches = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void;
  const fetchStarted = new Promise<void>((resolve) => { started = resolve; });
  const fetchImpl: typeof fetch = async () => { fetches += 1; started(); await gate; return jsonResponse([upstreamEvent(LEAGUES.nfl)]); };
  const first = resolveOdds({ apiKey: 'x', league: LEAGUES.nfl, cache, budget, fetchImpl, now: () => NOW, token: () => 'first' });
  await fetchStarted;
  const second = resolveOdds({
    apiKey: 'x', league: LEAGUES.nfl, cache, budget, fetchImpl, now: () => NOW, token: () => 'second',
    sleep: async () => { await new Promise<void>((resolve) => setImmediate(resolve)); },
  });
  release();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(fetches, 1); assert.equal(left.fetchedAt, right.fetchedAt); assert.equal(cache.stores, 1);
});

test('temporary failure and rate limiting serve eligible stale data with separate cooldowns', async () => {
  const requestTime = new Date(NOW.getTime() + ODDS_FRESH_MILLISECONDS + 1);
  for (const [error, reason, cooldown] of [
    [new Error('offline'), 'upstream_unavailable', ODDS_TRANSIENT_BACKOFF_MILLISECONDS],
    [new OddsError('upstream_rate_limited', 'limited', { retryAfterMilliseconds: 120_000 }), 'rate_limited', 120_000],
  ] as const) {
    const cache = new MemoryCache(cacheEntry());
    const result = await resolveOdds({
      apiKey: 'x', league: LEAGUES.nfl, cache, budget: new MemoryBudget(), now: () => requestTime,
      fetchImpl: async () => { throw error; },
    });
    assert.equal(result.cache.status, 'stale'); assert.equal(result.cache.staleReason, reason);
    assert.equal(cache.retryAt, requestTime.getTime() + cooldown);
  }
});

test('budget and confirmed quota blocks serve eligible snapshots only as explicitly stale', async () => {
  const requestTime = new Date(NOW.getTime() + ODDS_FRESH_MILLISECONDS + 1);
  for (const reason of ['budget_limit', 'quota_exhausted'] as const) {
    const budget = new MemoryBudget();
    budget.blocked = { kind: 'blocked', reason, retryAt: new Date('2026-12-01T12:00:00Z') };
    const result = await resolveOdds({
      apiKey: 'x', league: LEAGUES.nfl, cache: new MemoryCache(cacheEntry()), budget, now: () => requestTime,
    });
    assert.equal(result.cache.status, 'stale');
    assert.equal(result.cache.staleReason, reason);
  }
});

test('expired stale snapshots are never served and cached events are filtered after kickoff', async () => {
  const oldTime = new Date(NOW.getTime() + ODDS_MAXIMUM_STALE_MILLISECONDS + 1);
  await assert.rejects(resolveOdds({
    apiKey: 'x', league: LEAGUES.nfl, cache: new MemoryCache(cacheEntry()), budget: new MemoryBudget(), now: () => oldTime,
    fetchImpl: async () => { throw new Error('offline'); },
  }), (error: unknown) => error instanceof OddsError && error.code === 'upstream_unavailable');
  const kickoff = new Date(NOW.getTime() + 60_000);
  const input = normalizeOdds([upstreamEvent(LEAGUES.nfl, { commence_time: kickoff.toISOString() })], NOW, LEAGUES.nfl);
  const cache = new MemoryCache({ snapshot: input, fetchedAtMilliseconds: NOW.getTime() });
  const result = await resolveOdds({
    apiKey: 'x', league: LEAGUES.nfl, cache, budget: new MemoryBudget(), now: () => new Date(NOW.getTime() + 120_000),
  });
  assert.deepEqual(result.events, []);
});

test('Firestore caches isolate leagues and coordinate distributed leases with exact cooldown fields', async () => {
  const { firestore, documents } = fakeFirestore();
  const nfl = firestoreOddsCache(firestore, LEAGUES.nfl);
  const nba = firestoreOddsCache(firestore, LEAGUES.nba);
  assert.equal(oddsCacheDocument(LEAGUES['champions-league']), 'platformCache/odds_champions_league');
  const [first, second, other] = await Promise.all([
    nfl.claim(NOW, 'nfl-first'), nfl.claim(NOW, 'nfl-second'), nba.claim(NOW, 'nba-first'),
  ]);
  assert.equal(first.kind, 'acquired'); assert.equal(second.kind, 'busy'); assert.equal(other.kind, 'acquired');
  await nfl.store('nfl-first', cacheEntry());
  assert.equal((await nfl.claim(NOW, 'later')).kind, 'fresh');
  const retryAt = new Date(NOW.getTime() + 30_000);
  await nba.markFailure('nba-first', retryAt, 'rate_limited');
  const nbaDocument = documents.get('platformCache/odds_nba')!;
  assert.equal(nbaDocument.leagueId, 'nba'); assert.equal(nbaDocument.retryReason, 'rate_limited'); assert.equal(nbaDocument.retryAt, retryAt);
  assert.ok(documents.has('platformCache/odds_nfl'));
});

test('concurrent cross-league reservations share one budget and preserve the safety margin', async () => {
  const { firestore, documents } = fakeFirestore();
  const budget = firestoreOddsBudget(firestore);
  const claims = await Promise.all(Array.from({ length: ODDS_MONTHLY_CREDIT_LIMIT - ODDS_CREDIT_SAFETY_MARGIN + 1 },
    (_, index) => budget.reserve(NOW, `${SUPPORTED_LEAGUES[index % SUPPORTED_LEAGUES.length]!.id}:${index}`, 1)));
  assert.equal(claims.filter(({ kind }) => kind === 'acquired').length, 475);
  assert.equal(claims.at(-1)?.kind, 'blocked');
  const state = documents.get(ODDS_BUDGET_DOCUMENT)!;
  assert.equal(Object.keys(state.reservations as object).length, 475);
});

test('expired budget reservations are conservatively charged and provider headers reconcile usage', async () => {
  const { firestore, documents } = fakeFirestore();
  const budget = firestoreOddsBudget(firestore);
  const first = await budget.reserve(NOW, 'nfl:first', 3);
  assert.equal(first.kind, 'acquired');
  const later = new Date(NOW.getTime() + ODDS_RESERVATION_MILLISECONDS + 1);
  await budget.reserve(later, 'epl:second', 1);
  let state = documents.get(ODDS_BUDGET_DOCUMENT)!;
  assert.equal(state.estimatedUsed, 3);
  const second = (state.reservations as Record<string, unknown>)['epl:second'];
  assert.ok(second);
  await budget.settle({ token: 'epl:second', credits: 1, quotaRecheck: false }, later, {
    quota: { used: 40, remaining: 460, last: 1 }, quotaExhausted: false, successful: true,
  });
  state = documents.get(ODDS_BUDGET_DOCUMENT)!;
  assert.equal(state.estimatedUsed, 40); assert.equal(state.providerRemaining, 460); assert.equal(state.providerLastCost, 1);
});

test('month rollover preserves the last provider limit until new headers confirm reset', async () => {
  const { firestore } = fakeFirestore();
  const budget = firestoreOddsBudget(firestore);
  const monthEnd = new Date('2026-11-30T23:00:00Z');
  const seeded = await budget.reserve(monthEnd, 'nfl:month-end', 3);
  assert.equal(seeded.kind, 'acquired');
  if (seeded.kind !== 'acquired') return;
  await budget.settle(seeded.reservation, monthEnd, {
    quota: { used: 470, remaining: 30, last: 3 }, quotaExhausted: false, successful: true,
  });

  const rollover = new Date('2026-12-01T00:01:00Z');
  const first = await budget.reserve(rollover, 'epl:first-new-month', 3);
  const parallel = await budget.reserve(rollover, 'nba:parallel-new-month', 3);
  assert.equal(first.kind, 'acquired');
  assert.equal(parallel.kind, 'blocked');
  if (first.kind !== 'acquired') return;
  await budget.settle(first.reservation, rollover, {
    quota: { used: 3, remaining: 497, last: 3 }, quotaExhausted: false, successful: true,
  });
  assert.equal((await budget.reserve(rollover, 'nba:after-confirmed-reset', 3)).kind, 'acquired');
});

test('month rollover permits a bounded recheck when prior remaining credits equal the safety margin', async () => {
  const { firestore } = fakeFirestore();
  const budget = firestoreOddsBudget(firestore);
  const monthEnd = new Date('2026-11-30T23:00:00Z');
  const seeded = await budget.reserve(monthEnd, 'nfl:at-margin', 3);
  assert.equal(seeded.kind, 'acquired');
  if (seeded.kind !== 'acquired') return;
  await budget.settle(seeded.reservation, monthEnd, {
    quota: { used: 475, remaining: 25, last: 3 }, quotaExhausted: false, successful: true,
  });
  const early = await budget.reserve(new Date('2026-12-01T00:01:00Z'), 'epl:early-recheck', 1);
  assert.equal(early.kind, 'blocked');
  const bounded = await budget.reserve(new Date('2026-12-01T12:01:00Z'), 'epl:bounded-recheck', 1);
  assert.equal(bounded.kind, 'acquired');
  if (bounded.kind === 'acquired') assert.equal(bounded.reservation.quotaRecheck, true);
});

test('confirmed monthly exhaustion blocks all leagues then permits one bounded rollover recheck', async () => {
  const { firestore } = fakeFirestore();
  const budget = firestoreOddsBudget(firestore);
  const acquired = await budget.reserve(NOW, 'nfl:first', 3);
  assert.equal(acquired.kind, 'acquired');
  await budget.settle((acquired as { kind: 'acquired'; reservation: BudgetReservation }).reservation, NOW, {
    quota: { used: 500, remaining: 0, last: 3 }, quotaExhausted: true, successful: false,
  });
  const blocked = await budget.reserve(new Date('2026-11-20T00:00:00Z'), 'nba:blocked', 3);
  assert.equal(blocked.kind, 'blocked');
  if (blocked.kind !== 'blocked') return;
  assert.equal(blocked.reason, 'quota_exhausted');
  assert.equal(blocked.retryAt.toISOString(), '2026-12-01T12:00:00.000Z');
  const recheck = await budget.reserve(new Date('2026-12-01T12:01:00Z'), 'epl:recheck', 1);
  assert.equal(recheck.kind, 'acquired');
  if (recheck.kind !== 'acquired') return;
  assert.equal(recheck.reservation.quotaRecheck, true);
  const parallel = await budget.reserve(new Date('2026-12-01T12:01:01Z'), 'nba:parallel', 3);
  assert.equal(parallel.kind, 'blocked');
  await budget.settle(recheck.reservation, new Date('2026-12-01T12:01:02Z'), {
    quota: null, quotaExhausted: false, successful: false,
  });
  const coolingDown = await budget.reserve(new Date('2026-12-01T13:00:00Z'), 'nba:still-blocked', 3);
  assert.equal(coolingDown.kind, 'blocked');
  const recovered = await budget.reserve(new Date('2026-12-01T18:02:00Z'), 'epl:recovered-check', 1);
  assert.equal(recovered.kind, 'acquired');
  if (recovered.kind !== 'acquired') return;
  await budget.settle(recovered.reservation, new Date('2026-12-01T18:02:01Z'), {
    quota: { used: 1, remaining: 499, last: 1 }, quotaExhausted: false, successful: true,
  });
  assert.equal((await budget.reserve(new Date('2026-12-01T18:03:00Z'), 'nba:recovered', 3)).kind, 'acquired');
});

test('HTTP routing is GET-only, exact, query-free, cache-aware, and exposes safe quota errors', async () => {
  const invoke = async (
    path: string,
    method = 'GET',
    query: Record<string, string> = {},
    budget = new MemoryBudget(),
    options: { cache?: MemoryCache; fetchImpl?: typeof fetch; now?: Date } = {},
  ) => {
    const headers = new Map<string, string>(); let statusCode = 0; let body: unknown;
    const response = {
      set(name: string, value: string) { headers.set(name, value); return this; },
      status(value: number) { statusCode = value; return this; },
      json(value: unknown) { body = value; return this; },
    };
    await handleOddsRequest({ path, method, query }, response, {
      apiKey: 'x', budget, now: () => options.now ?? NOW,
      cacheForLeague: (league) => options.cache ?? new MemoryCache(budget.blocked ? null : cacheEntry(league)),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    return { headers, statusCode, body };
  };
  for (const league of SUPPORTED_LEAGUES) {
    const response = await invoke(league.path);
    assert.equal(response.statusCode, 200); assert.match(response.headers.get('Cache-Control') ?? '', /s-maxage=900/);
    assert.equal((response.body as OddsSnapshot).league.id, league.id);
  }
  assert.equal((await invoke('/api/odds/nfl', 'POST')).statusCode, 405);
  assert.equal((await invoke('/api/odds/nfl', 'GET', { bookmaker: 'fanduel' })).statusCode, 400);
  assert.equal((await invoke('/api/odds/mlb')).statusCode, 404);

  const staleTime = new Date(NOW.getTime() + ODDS_FRESH_MILLISECONDS + 1);
  const stale = await invoke('/api/odds/nfl', 'GET', {}, new MemoryBudget(), {
    cache: new MemoryCache(cacheEntry()), now: staleTime,
    fetchImpl: async () => { throw new Error('offline'); },
  });
  assert.equal(stale.statusCode, 200);
  assert.equal(stale.headers.get('Cache-Control'), 'public, max-age=30, s-maxage=60');

  const budget = new MemoryBudget();
  budget.blocked = { kind: 'blocked', reason: 'quota_exhausted', retryAt: new Date('2026-12-01T12:00:00Z') };
  const quota = await invoke('/api/odds/nfl', 'GET', {}, budget);
  assert.equal(quota.statusCode, 503); assert.equal(quota.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(quota.body, { error: {
    code: 'ODDS_QUOTA_EXHAUSTED',
    message: 'Odds data is unavailable because the monthly provider quota is exhausted.',
  } });
});

test('deployed function binds only ODDS_API_KEY and Hosting exposes one generalized route', async () => {
  const [config, index, firebaseText, release] = await Promise.all([
    readFile(new URL('../../src/config.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../src/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../../firebase.json', import.meta.url), 'utf8'),
    readFile(new URL('../../../scripts/release/config.mjs', import.meta.url), 'utf8'),
  ]);
  assert.match(config, /oddsApiKey = defineSecret\('ODDS_API_KEY'\)/);
  assert.match(index, /export const odds = onRequest\(\{[\s\S]*?secrets: \[oddsApiKey\]/);
  assert.doesNotMatch(index.match(/export const odds[\s\S]*$/)?.[0] ?? '', /RESEND_API_KEY|GITHUB_WEBHOOK_SECRET|WTT_SOLANA_RPC_URL/);
  const firebase = JSON.parse(firebaseText);
  const rewrites = firebase.hosting.rewrites.filter((item: { source?: string }) => item.source === '/api/odds/**');
  assert.deepEqual(rewrites, [{ source: '/api/odds/**', function: { functionId: 'odds', region: 'us-central1' } }]);
  assert.match(release, /'ODDS_API_KEY'/);
  assert.equal(ODDS_CREDIT_SAFETY_MARGIN, 25);
});
