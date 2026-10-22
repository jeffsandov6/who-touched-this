/** @jsxImportSource react */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './MultiLeagueParlayBuilder.css';

type LeagueId = 'nfl' | 'nba' | 'epl' | 'la-liga' | 'serie-a' | 'bundesliga' | 'champions-league';
type MarketKey = 'h2h' | 'spreads' | 'totals';
type Side = 'home' | 'away' | 'draw' | 'over' | 'under';

type Outcome = { id: string; side: Side; label: string; americanOdds: number; point?: number };
type Market = { key: MarketKey; name: string; updatedAt?: string; outcomes: Outcome[] };
type OddsEvent = {
  id: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  bookmakerUpdatedAt?: string;
  markets: { moneyline?: Market; spread?: Market; total?: Market };
};
type OddsResponse = {
  schemaVersion: 2;
  league: { id: LeagueId; name: string };
  sport: string;
  source: { provider: 'The Odds API'; bookmakerKey: string | null; bookmakerName: string | null };
  fetchedAt: string;
  events: OddsEvent[];
  cache: {
    status: 'fresh' | 'stale';
    ageSeconds: number;
    freshForSeconds: number;
    maximumStaleSeconds: number;
    staleReason?: string;
  };
};

type LoadState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; data: OddsResponse }
  | { status: 'error'; kind: 'quota' | 'temporary' | 'network' | 'malformed' };

type SelectedLeg = {
  leagueId: LeagueId;
  leagueName: string;
  eventId: string;
  selectionId: string;
  market: MarketKey;
  side: Side;
  label: string;
  point?: number;
  americanOdds: number;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
};

const leagues = {
  nfl: { name: 'NFL', path: '/api/odds/nfl', sport: 'NFL' },
  nba: { name: 'NBA', path: '/api/odds/nba', sport: 'NBA' },
  epl: { name: 'Premier League', path: '/api/odds/epl', sport: 'Soccer' },
  'la-liga': { name: 'La Liga', path: '/api/odds/la-liga', sport: 'Soccer' },
  'serie-a': { name: 'Serie A', path: '/api/odds/serie-a', sport: 'Soccer' },
  bundesliga: { name: 'Bundesliga', path: '/api/odds/bundesliga', sport: 'Soccer' },
  'champions-league': { name: 'Champions League', path: '/api/odds/champions-league', sport: 'Soccer' },
} as const;

const SEARCH_EXAMPLES = {
  nfl: 'Chiefs',
  nba: 'Lakers',
  epl: 'Arsenal',
  'la-liga': 'Barcelona',
  'serie-a': 'Inter Milan',
  bundesliga: 'Bayern Munich',
  'champions-league': 'Real Madrid',
} as const;

const leagueIds = Object.keys(leagues) as LeagueId[];
const soccerIds = leagueIds.filter((id) => leagues[id].sport === 'Soccer');
const emptyLoads = Object.fromEntries(leagueIds.map((id) => [id, { status: 'idle' }])) as Record<LeagueId, LoadState>;
const fixtureMode = import.meta.env.DEV
  && (import.meta.env as Record<string, string | boolean | undefined>).PUBLIC_NFL_ODDS_FIXTURE === 'true';

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseResponse(value: unknown, expectedLeague: LeagueId): OddsResponse | null {
  if (!record(value) || value.schemaVersion !== 2 || !record(value.league)
    || value.league.id !== expectedLeague || typeof value.league.name !== 'string'
    || typeof value.sport !== 'string' || !record(value.source) || value.source.provider !== 'The Odds API'
    || !(typeof value.source.bookmakerKey === 'string' || value.source.bookmakerKey === null)
    || !(typeof value.source.bookmakerName === 'string' || value.source.bookmakerName === null)
    || typeof value.fetchedAt !== 'string' || !Number.isFinite(Date.parse(value.fetchedAt))
    || !Array.isArray(value.events) || !record(value.cache)
    || !['fresh', 'stale'].includes(String(value.cache.status))
    || typeof value.cache.ageSeconds !== 'number' || !Number.isFinite(value.cache.ageSeconds)) return null;

  const events: OddsEvent[] = [];
  for (const candidate of value.events) {
    if (!record(candidate) || typeof candidate.id !== 'string' || !candidate.id.startsWith(`${expectedLeague}:`)
      || typeof candidate.commenceTime !== 'string' || !Number.isFinite(Date.parse(candidate.commenceTime))
      || typeof candidate.homeTeam !== 'string' || typeof candidate.awayTeam !== 'string'
      || !record(candidate.markets)) return null;
    const markets: OddsEvent['markets'] = {};
    for (const [publicKey, providerKey] of [['moneyline', 'h2h'], ['spread', 'spreads'], ['total', 'totals']] as const) {
      const input = candidate.markets[publicKey];
      if (input === undefined) continue;
      if (!record(input) || input.key !== providerKey || typeof input.name !== 'string' || !Array.isArray(input.outcomes)) return null;
      const outcomes: Outcome[] = [];
      for (const item of input.outcomes) {
        if (!record(item) || typeof item.id !== 'string' || typeof item.label !== 'string'
          || !['home', 'away', 'draw', 'over', 'under'].includes(String(item.side))
          || !Number.isInteger(item.americanOdds) || Math.abs(Number(item.americanOdds)) < 100
          || ('point' in item && (typeof item.point !== 'number' || !Number.isFinite(item.point)))) return null;
        outcomes.push({
          id: item.id,
          side: item.side as Side,
          label: item.label,
          americanOdds: item.americanOdds as number,
          ...('point' in item ? { point: item.point as number } : {}),
        });
      }
      markets[publicKey] = { key: providerKey, name: input.name, outcomes };
    }
    events.push({
      id: candidate.id,
      commenceTime: candidate.commenceTime,
      homeTeam: candidate.homeTeam,
      awayTeam: candidate.awayTeam,
      markets,
    });
  }
  return {
    schemaVersion: 2,
    league: { id: expectedLeague, name: value.league.name },
    sport: value.sport,
    source: {
      provider: 'The Odds API',
      bookmakerKey: value.source.bookmakerKey,
      bookmakerName: value.source.bookmakerName,
    },
    fetchedAt: value.fetchedAt,
    events,
    cache: {
      status: value.cache.status as 'fresh' | 'stale',
      ageSeconds: value.cache.ageSeconds,
      freshForSeconds: typeof value.cache.freshForSeconds === 'number' ? value.cache.freshForSeconds : 43_200,
      maximumStaleSeconds: typeof value.cache.maximumStaleSeconds === 'number' ? value.cache.maximumStaleSeconds : 86_400,
      ...(typeof value.cache.staleReason === 'string' ? { staleReason: value.cache.staleReason } : {}),
    },
  };
}

const fixtureTeams: Record<LeagueId, Array<[string, string]>> = {
  nfl: [['Kansas City Chiefs', 'Denver Broncos'], ['Chicago Bears', 'Green Bay Packers'], ['Buffalo Bills', 'Miami Dolphins'], ['Dallas Cowboys', 'Philadelphia Eagles']],
  nba: [['Los Angeles Lakers', 'Boston Celtics'], ['Chicago Bulls', 'Milwaukee Bucks'], ['New York Knicks', 'Miami Heat'], ['Phoenix Suns', 'Denver Nuggets']],
  epl: [['Arsenal', 'Liverpool'], ['Chelsea', 'Manchester City'], ['Tottenham Hotspur', 'Newcastle United'], ['Everton', 'Aston Villa']],
  'la-liga': [['Real Madrid', 'Barcelona'], ['Atlético Madrid', 'Sevilla'], ['Valencia', 'Villarreal'], ['Real Betis', 'Athletic Club']],
  'serie-a': [['Inter Milan', 'AC Milan'], ['Juventus', 'Napoli'], ['Roma', 'Lazio'], ['Atalanta', 'Fiorentina']],
  bundesliga: [['Bayern Munich', 'Borussia Dortmund'], ['RB Leipzig', 'Bayer Leverkusen'], ['Stuttgart', 'Frankfurt'], ['Wolfsburg', 'Freiburg']],
  'champions-league': [['Paris Saint-Germain', 'Real Madrid'], ['Arsenal', 'Bayern Munich'], ['Barcelona', 'Inter Milan'], ['Liverpool', 'Juventus']],
};

function makeFixture(id: LeagueId): OddsResponse {
  const soccer = leagues[id].sport === 'Soccer';
  const bookmakerName = id === 'bundesliga' ? 'BetMGM' : id === 'champions-league' ? 'FanDuel' : 'DraftKings';
  const bookmakerKey = bookmakerName.toLowerCase().replace('kings', 'kings');
  const events = fixtureTeams[id].map(([homeTeam, awayTeam], index): OddsEvent => {
    const eventId = `${id}:demo_${index + 1}`;
    const h2h: Outcome[] = [
      { id: `${eventId}:h2h:home`, side: 'home', label: homeTeam, americanOdds: 120 + index * 10 },
      ...(soccer ? [{ id: `${eventId}:h2h:draw`, side: 'draw' as const, label: 'Draw', americanOdds: 235 + index * 5 }] : []),
      { id: `${eventId}:h2h:away`, side: 'away', label: awayTeam, americanOdds: -140 - index * 5 },
    ];
    return {
      id: eventId,
      commenceTime: `2030-01-${String(15 + index).padStart(2, '0')}T${18 + index}:00:00.000Z`,
      homeTeam,
      awayTeam,
      markets: {
        moneyline: { key: 'h2h', name: 'Moneyline', outcomes: h2h },
        ...(soccer ? {} : {
          spread: { key: 'spreads' as const, name: 'Spread', outcomes: [
            { id: `${eventId}:spreads:home`, side: 'home' as const, label: homeTeam, americanOdds: -110, point: 3.5 },
            { id: `${eventId}:spreads:away`, side: 'away' as const, label: awayTeam, americanOdds: -110, point: -3.5 },
          ] },
          total: { key: 'totals' as const, name: 'Total', outcomes: [
            { id: `${eventId}:totals:over`, side: 'over' as const, label: 'Over', americanOdds: -105, point: id === 'nba' ? 224.5 : 44.5 },
            { id: `${eventId}:totals:under`, side: 'under' as const, label: 'Under', americanOdds: -115, point: id === 'nba' ? 224.5 : 44.5 },
          ] },
        }),
      },
    };
  });
  return {
    schemaVersion: 2,
    league: { id, name: leagues[id].name },
    sport: id,
    source: { provider: 'The Odds API', bookmakerKey, bookmakerName },
    fetchedAt: '2030-01-10T13:09:00.000Z',
    events,
    cache: { status: 'fresh', ageSeconds: 0, freshForSeconds: 43_200, maximumStaleSeconds: 86_400 },
  };
}

function formatOdds(value: number) { return value > 0 ? `+${value}` : String(value); }
function formatPoint(point: number | undefined) { return point === undefined ? '' : `${point > 0 ? '+' : ''}${point}`; }
function decimalOdds(american: number) { return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american); }
function combinedAmerican(decimal: number) {
  return Math.round(decimal >= 2 ? (decimal - 1) * 100 : -100 / (decimal - 1));
}
function money(value: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(value);
}
function kickoff(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value));
}
function fetchedAt(value: string) {
  const date = new Date(value);
  const today = new Date();
  const includeDate = date.toDateString() !== today.toDateString();
  return new Intl.DateTimeFormat(undefined, {
    ...(includeDate ? { month: 'short', day: 'numeric' } : {}),
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(date);
}
function betDescription(leg: Pick<SelectedLeg, 'market' | 'label' | 'point'>) {
  if (leg.market === 'h2h') return `${leg.label} moneyline`;
  if (leg.market === 'spreads') return `${leg.label} ${formatPoint(leg.point)}`;
  return `${leg.label} ${leg.point ?? ''}`.trim();
}

export default function MultiLeagueParlayBuilder() {
  const [selectedLeague, setSelectedLeague] = useState<LeagueId>('nfl');
  const [loads, setLoads] = useState<Record<LeagueId, LoadState>>(emptyLoads);
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [legs, setLegs] = useState<SelectedLeg[]>([]);
  const [wager, setWager] = useState('10');
  const activeRequests = useRef(new Map<LeagueId, AbortController>());

  const loadLeague = useCallback(async (id: LeagueId, retry = false) => {
    if (activeRequests.current.has(id)) return;
    if (!retry && loads[id].status !== 'idle') return;
    setLoads((current) => ({ ...current, [id]: { status: 'loading' } }));
    if (fixtureMode) {
      setLoads((current) => ({ ...current, [id]: { status: 'ready', data: makeFixture(id) } }));
      return;
    }
    const controller = new AbortController();
    activeRequests.current.set(id, controller);
    try {
      const response = await fetch(leagues[id].path, { method: 'GET', headers: { accept: 'application/json' }, signal: controller.signal });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const code = record(body) && record(body.error) ? body.error.code : null;
        setLoads((current) => ({ ...current, [id]: {
          status: 'error', kind: code === 'ODDS_QUOTA_EXHAUSTED' ? 'quota' : 'temporary',
        } }));
        return;
      }
      const parsed = parseResponse(body, id);
      setLoads((current) => ({ ...current, [id]: parsed
        ? { status: 'ready', data: parsed }
        : { status: 'error', kind: 'malformed' } }));
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        setLoads((current) => ({ ...current, [id]: { status: 'error', kind: 'network' } }));
      }
    } finally {
      activeRequests.current.delete(id);
    }
  }, [loads]);

  useEffect(() => { void loadLeague(selectedLeague); }, [loadLeague, selectedLeague]);
  useEffect(() => () => { activeRequests.current.forEach((controller) => controller.abort()); }, []);
  useEffect(() => { setSearch(''); setShowAll(false); }, [selectedLeague]);

  const state = loads[selectedLeague];
  const data = state.status === 'ready' ? state.data : null;
  const events = useMemo(() => [...(data?.events ?? [])]
    .filter((event) => Date.parse(event.commenceTime) > Date.now())
    .sort((a, b) => a.commenceTime.localeCompare(b.commenceTime)), [data]);
  const query = search.trim().toLowerCase();
  const matches = query
    ? events.filter((event) => `${event.homeTeam} ${event.awayTeam}`.toLowerCase().includes(query))
    : events;
  const visibleEvents = query || showAll ? matches : matches.slice(0, 3);

  const resolvedLegs = legs.map((leg) => {
    const loaded = loads[leg.leagueId];
    if (loaded.status !== 'ready') return { leg, status: 'unavailable' as const };
    const event = loaded.data.events.find(({ id }) => id === leg.eventId);
    if (!event || Date.parse(event.commenceTime) <= Date.now()) return { leg, status: 'unavailable' as const };
    const marketName = leg.market === 'h2h' ? 'moneyline' : leg.market === 'spreads' ? 'spread' : 'total';
    const outcome = event.markets[marketName]?.outcomes.find(({ id }) => id === leg.selectionId);
    if (!outcome) return { leg, status: 'unavailable' as const };
    const changed = outcome.americanOdds !== leg.americanOdds || outcome.point !== leg.point;
    return { leg, status: changed ? 'changed' as const : 'valid' as const, outcome };
  });
  const hasIssues = resolvedLegs.some(({ status }) => status !== 'valid');
  const wagerNumber = Number(wager);
  const validWager = wager.trim() !== '' && Number.isFinite(wagerNumber) && wagerNumber > 0 && wagerNumber <= 100_000;
  const combinedDecimal = !hasIssues && legs.length
    ? legs.reduce((total, leg) => total * decimalOdds(leg.americanOdds), 1)
    : null;

  function select(event: OddsEvent, market: Market, outcome: Outcome) {
    const leg: SelectedLeg = {
      leagueId: selectedLeague,
      leagueName: leagues[selectedLeague].name,
      eventId: event.id,
      selectionId: outcome.id,
      market: market.key,
      side: outcome.side,
      label: outcome.label,
      ...(outcome.point === undefined ? {} : { point: outcome.point }),
      americanOdds: outcome.americanOdds,
      homeTeam: event.homeTeam,
      awayTeam: event.awayTeam,
      commenceTime: event.commenceTime,
    };
    setLegs((current) => [...current.filter(({ eventId }) => eventId !== event.id), leg]);
  }

  function acceptUpdate(index: number, outcome: Outcome) {
    setLegs((current) => current.map((leg, legIndex) => legIndex === index ? {
      ...leg,
      label: outcome.label,
      americanOdds: outcome.americanOdds,
      ...(outcome.point === undefined ? { point: undefined } : { point: outcome.point }),
    } : leg));
  }

  const selectedSport = leagues[selectedLeague].sport;
  return (
    <section className="parlay-builder" aria-labelledby="parlay-title">
      <header className="parlay-builder-hero">
        <h2 id="parlay-title">Parlay Builder</h2>
        <p className="parlay-builder-disclaimer">For entertainment and informational use only. Odds may be outdated. This is not a sportsbook.</p>
      </header>

      <nav className="parlay-sport-tabs" aria-label="Choose a sport">
        {(['NFL', 'NBA', 'Soccer'] as const).map((sport) => (
          <button key={sport} type="button" className={selectedSport === sport ? 'is-active' : ''}
            aria-pressed={selectedSport === sport}
            onClick={() => setSelectedLeague(sport === 'NFL' ? 'nfl' : sport === 'NBA' ? 'nba' : 'epl')}>
            {sport}
          </button>
        ))}
      </nav>
      {selectedSport === 'Soccer' && (
        <nav className="parlay-league-tabs" aria-label="Choose a soccer competition">
          {soccerIds.map((id) => <button key={id} type="button" className={selectedLeague === id ? 'is-active' : ''}
            aria-pressed={selectedLeague === id} onClick={() => setSelectedLeague(id)}>{leagues[id].name}</button>)}
        </nav>
      )}

      <div className="parlay-builder-layout">
        <div className="parlay-board">
          <div className="parlay-board-tools">
            <label htmlFor="parlay-team-search">Find your team</label>
            <input id="parlay-team-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)}
              placeholder={`Try ${SEARCH_EXAMPLES[selectedLeague]}…`} />
          </div>

          {fixtureMode && <p className="parlay-data-note is-demo">DEMO DATA · development fixture · not live odds</p>}
          {state.status === 'loading' && <div className="parlay-state" role="status"><b>Loading odds…</b><span>Getting {leagues[selectedLeague].name} games.</span></div>}
          {state.status === 'error' && state.kind === 'quota' && (
            <div className="parlay-state is-error" role="status"><b>THE ODDS AREN&apos;T IN OUR FAVOR.</b><span>We&apos;ve used up our monthly odds data. The parlay builder will be back when our credits reset.</span></div>
          )}
          {state.status === 'error' && state.kind !== 'quota' && (
            <div className="parlay-state is-error" role="status"><b>Odds unavailable</b><span>Live odds could not be loaded. Your existing slip is still here.</span>
              <button type="button" onClick={() => void loadLeague(selectedLeague, true)}>Try again</button></div>
          )}
          {data && (
            <>
              <div className="parlay-source-row">
                <p>{fixtureMode ? `Sample odds timestamp: ${fetchedAt(data.fetchedAt)}.` : `These were the live odds as of ${fetchedAt(data.fetchedAt)}.`}</p>
                <span>{data.source.bookmakerName ?? 'Markets unavailable'}</span>
              </div>
              {(data.cache.status === 'stale' || data.cache.ageSeconds >= 43_200) && (
                <p className="parlay-data-note">Heads up: this league&apos;s cached odds are old and may have changed.</p>
              )}
              {!events.length && <div className="parlay-state"><b>No upcoming games</b><span>There are no upcoming {data.league.name} markets right now.</span></div>}
              {!!events.length && !matches.length && <div className="parlay-state"><b>No games found</b><span>Try a city, full team name, or nickname.</span></div>}
              <div className="parlay-games">
                {visibleEvents.map((event) => {
                  const currentLeg = legs.find(({ eventId }) => eventId === event.id);
                  const availableMarkets = Object.values(event.markets).filter(Boolean) as Market[];
                  return <article className="parlay-game-card" key={event.id}>
                    <header><div><span>{kickoff(event.commenceTime)}</span><h3>{event.awayTeam} <em>at</em> {event.homeTeam}</h3></div><span className="parlay-game-league">{data.league.name}</span></header>
                    {!availableMarkets.length && <p className="parlay-market-empty">No selectable markets for this game.</p>}
                    {availableMarkets.map((market) => <fieldset key={market.key} className="parlay-market">
                      <legend>{market.name}</legend>
                      <div>{market.outcomes.map((outcome) => {
                        const selected = currentLeg?.selectionId === outcome.id
                          && currentLeg.americanOdds === outcome.americanOdds && currentLeg.point === outcome.point;
                        return <button type="button" key={outcome.id} className={selected ? 'is-selected' : ''}
                          aria-pressed={selected} onClick={() => select(event, market, outcome)}>
                          <span>{outcome.label}{outcome.point === undefined ? '' : ` ${formatPoint(outcome.point)}`}</span>
                          <strong>{formatOdds(outcome.americanOdds)}</strong>
                          {currentLeg && !selected && <small>replace pick</small>}
                        </button>;
                      })}</div>
                    </fieldset>)}
                  </article>;
                })}
              </div>
              {!query && events.length > 3 && <button type="button" className="parlay-show-more" onClick={() => setShowAll((value) => !value)}>
                {showAll ? 'Show fewer games' : `Show more games (${events.length - 3})`}
              </button>}
            </>
          )}
        </div>

        <aside className="parlay-ticket" aria-label="Your hypothetical parlay slip">
          <div className="parlay-ticket-top"><h3>Parlay Slip</h3><b>{legs.length} {legs.length === 1 ? 'LEG' : 'LEGS'}</b></div>
          {!legs.length && <div className="parlay-ticket-empty"><b>No selections yet</b><span>Choose an outcome to add a leg.</span></div>}
          {!!legs.length && <ol className="parlay-ticket-legs">
            {resolvedLegs.map(({ leg, status, outcome }, index) => <li key={leg.eventId} className={status !== 'valid' ? 'has-issue' : ''}>
              <div className="parlay-ticket-leg-head"><span>{leg.leagueName}</span><button type="button" aria-label={`Remove ${betDescription(leg)}`} onClick={() => setLegs((current) => current.filter((_, i) => i !== index))}>×</button></div>
              <b>{betDescription(leg)}</b><small>{leg.awayTeam} at {leg.homeTeam}</small>
              <strong>{formatOdds(leg.americanOdds)}</strong>
              {status === 'changed' && <div className="parlay-leg-alert"><span>Odds or points changed. Accept the new terms to count this leg.</span>
                <button type="button" onClick={() => acceptUpdate(index, outcome!)}>Accept {formatOdds(outcome!.americanOdds)}{outcome!.point === undefined ? '' : ` · ${formatPoint(outcome!.point)}`}</button></div>}
              {status === 'unavailable' && <div className="parlay-leg-alert"><span>This market is no longer available. Remove it to calculate a payout.</span></div>}
            </li>)}
          </ol>}
          {!!legs.length && <button type="button" className="parlay-clear" onClick={() => setLegs([])}>Clear all</button>}
          <div className="parlay-wager">
            <label htmlFor="parlay-wager">Hypothetical wager</label><div><span>$</span><input id="parlay-wager" inputMode="decimal" value={wager} onChange={(event) => setWager(event.target.value)} aria-describedby="parlay-wager-help" /></div>
            <small id="parlay-wager-help">Enter an amount from $0.01 to $100,000.</small>
          </div>
          <dl className="parlay-totals">
            <div><dt>Combined odds</dt><dd>{combinedDecimal ? formatOdds(combinedAmerican(combinedDecimal)) : '—'}</dd></div>
            <div><dt>Potential return</dt><dd>{combinedDecimal && validWager ? money(wagerNumber * combinedDecimal) : '—'}</dd></div>
            <div><dt>Potential profit</dt><dd>{combinedDecimal && validWager ? money(wagerNumber * (combinedDecimal - 1)) : '—'}</dd></div>
          </dl>
          {hasIssues && <p className="parlay-ticket-warning">Resolve changed or unavailable legs before trusting the math.</p>}
          {!validWager && <p className="parlay-ticket-warning">Enter a valid hypothetical wager.</p>}
        </aside>
      </div>
    </section>
  );
}
