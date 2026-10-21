# Odds API backend

The maintainer-owned `odds` HTTPS Function provides normalized, read-only odds for the contributor canvas. It does not place wagers. The browser never receives `ODDS_API_KEY` and never calls The Odds API directly.

## Public routes

All routes accept `GET` with no query parameters:

| Route | League | Provider sport | Markets | Estimated credits |
| --- | --- | --- | --- | ---: |
| `/api/odds/nfl` | NFL | `americanfootball_nfl` | h2h, spreads, totals | 3 |
| `/api/odds/nba` | NBA | `basketball_nba` | h2h, spreads, totals | 3 |
| `/api/odds/epl` | Premier League | `soccer_epl` | h2h | 1 |
| `/api/odds/la-liga` | La Liga | `soccer_spain_la_liga` | h2h | 1 |
| `/api/odds/serie-a` | Serie A | `soccer_italy_serie_a` | h2h | 1 |
| `/api/odds/bundesliga` | Bundesliga | `soccer_germany_bundesliga` | h2h | 1 |
| `/api/odds/champions-league` | Champions League | `soccer_uefa_champs_league` | h2h | 1 |

Unsupported routes return `404`; methods other than `GET` return `405`; query parameters return `400`. Error responses and validation failures are never CDN cached.

## Response contract

Successful responses use schema version 2:

```ts
interface OddsResponse {
  schemaVersion: 2;
  league: { id: string; name: string };
  sport: string;
  source: {
    provider: "The Odds API";
    bookmakerKey: "draftkings" | "fanduel" | "betmgm" | null;
    bookmakerName: "DraftKings" | "FanDuel" | "BetMGM" | null;
  };
  fetchedAt: string; // server retrieval time, ISO 8601
  events: Array<{
    id: string; // `${leagueId}:${providerEventId}`
    commenceTime: string;
    homeTeam: string;
    awayTeam: string;
    bookmakerUpdatedAt?: string;
    markets: {
      moneyline?: Market; // provider key h2h
      spread?: Market;    // provider key spreads
      total?: Market;     // provider key totals
    };
  }>;
  cache: {
    status: "fresh" | "stale";
    ageSeconds: number;
    freshForSeconds: 43200;
    maximumStaleSeconds: 86400;
    staleReason?: "refresh_in_progress" | "refresh_backoff" |
      "upstream_unavailable" | "rate_limited" | "budget_limit" |
      "quota_exhausted";
  };
}

interface Market {
  key: "h2h" | "spreads" | "totals";
  name: "Moneyline" | "Spread" | "Total";
  updatedAt?: string;
  outcomes: Array<{
    id: string; // `${eventId}:${marketKey}:${side}`
    side: "home" | "away" | "draw" | "over" | "under";
    label: string;
    americanOdds: number;
    point?: number; // required only for spreads and totals
  }>;
}
```

An empty schedule is a normal `200` response with `events: []`. Missing bookmakers or markets are represented honestly by nullable source bookmaker fields and/or empty event markets. Events at or after kickoff are filtered both during normalization and whenever cached data is served.

Outcome IDs deliberately exclude price and point. A client must retain the accepted price and point and require confirmation when refreshed terms differ.

## Bookmakers

NFL and NBA use DraftKings only. Soccer requests DraftKings, FanDuel, and BetMGM in one US-region-equivalent bookmaker request, then selects the bookmaker with valid match-winner markets for the greatest number of upcoming games. Coverage ties use that priority order. Events are never assembled from different bookmakers. If the selected bookmaker lacks a market for an event, that event has empty markets; if no configured bookmaker has usable data, source bookmaker fields are `null`.

Provider availability and public display/licensing terms must be reviewed before production launch. Attribution should identify The Odds API and the returned bookmaker; this integration does not imply endorsement by a bookmaker.

## Shared cache and cooldowns

Each league has one Firestore document: `platformCache/odds_<league_id>`, with hyphens converted to underscores. Its fields are:

- `schemaVersion`, `leagueId`, validated `snapshot`, and `fetchedAt`;
- `refreshToken` and `refreshLeaseUntil` for the 20-second distributed refresh lease;
- `retryAt` and `retryReason` for shared cooldown state;
- `updatedAt`.

Validated snapshots are fresh for 12 hours and may be served explicitly stale for at most 24 hours. Ordinary failures cool down for 30 minutes. Credential/configuration failures cool down for 24 hours. Rate limits honor a valid `Retry-After`, bounded to 24 hours, or use 30 minutes. Stale responses receive a short CDN lifetime; fresh responses use a 15-minute shared CDN lifetime. There are no schedules, forced refresh parameters, or cross-league prefetches.

## Shared monthly budget

`platformCache/odds_budget` coordinates every league with these fields:

- `schemaVersion` and UTC bookkeeping `periodKey`;
- `estimatedUsed`;
- `providerUsed`, `providerRemaining`, `providerLastCost`, and `providerObservedAt`;
- `reservations`, a map of token to estimated credits and two-minute expiry;
- `quotaExhausted`, `quotaExhaustedAt`, and `quotaRecheckAt`;
- `updatedAt`.

A Firestore transaction reserves credits before each provider request. The local ceiling is 475 of 500 credits, preserving a 25-credit safety margin. Active reservations count against the ceiling. Expired reservations are conservatively charged because the process may have stopped after sending a billable request. Settlement reconciles the estimate with valid `x-requests-used`, `x-requests-remaining`, and `x-requests-last` headers. At local month rollover, the last provider observation remains authoritative until a new response confirms that provider counters reset.

Confirmed `OUT_OF_USAGE_CREDITS` state blocks all leagues. The first recheck is permitted no earlier than noon UTC on the first day of the next month; noon is a conservative implementation boundary, not a claim about the provider's reset timezone. A failed recheck waits six hours before one later request may retry. A successful provider response clears exhaustion. `EXCEEDED_FREQ_LIMIT` and generic HTTP 429 responses are temporary rate limits, not quota exhaustion.

If shared Firestore coordination is unavailable, requests fail closed without contacting the provider. The budget cannot account for requests made with the same key outside this project; a separate key and provider-side usage alerts are recommended.

Without eligible stale data, confirmed exhaustion returns:

```json
{
  "error": {
    "code": "ODDS_QUOTA_EXHAUSTED",
    "message": "Odds data is unavailable because the monthly provider quota is exhausted."
  }
}
```

Other unavailable conditions use `ODDS_TEMPORARILY_UNAVAILABLE` without provider payloads, credentials, URLs, or internal budget details.

## Production setup

Before deployment, a maintainer must provision the Firebase Secret Manager secret `ODDS_API_KEY`, confirm Firestore access for the Functions runtime, review The Odds API plan/display terms, build Functions, and deploy Functions before Hosting. No key is required by the browser or contributor build.
