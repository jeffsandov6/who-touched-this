export type PublicMarketKey = 'moneyline' | 'spread' | 'total';
export type ProviderMarketKey = 'h2h' | 'spreads' | 'totals';
export type LeagueId = 'nfl' | 'nba' | 'epl' | 'la-liga' | 'serie-a' | 'bundesliga' | 'champions-league';

export interface BookmakerConfig {
  key: 'draftkings' | 'fanduel' | 'betmgm';
  name: 'DraftKings' | 'FanDuel' | 'BetMGM';
}

export interface LeagueConfig {
  id: LeagueId;
  path: string;
  name: string;
  sportKey: string;
  markets: readonly ProviderMarketKey[];
  bookmakers: readonly BookmakerConfig[];
  estimatedCredits: number;
  allowDraw: boolean;
}

const draftKings = { key: 'draftkings', name: 'DraftKings' } as const;
const soccerBookmakers = [
  draftKings,
  { key: 'fanduel', name: 'FanDuel' },
  { key: 'betmgm', name: 'BetMGM' },
] as const;

export const LEAGUES = {
  nfl: {
    id: 'nfl', path: '/api/odds/nfl', name: 'NFL', sportKey: 'americanfootball_nfl',
    markets: ['h2h', 'spreads', 'totals'], bookmakers: [draftKings], estimatedCredits: 3, allowDraw: false,
  },
  nba: {
    id: 'nba', path: '/api/odds/nba', name: 'NBA', sportKey: 'basketball_nba',
    markets: ['h2h', 'spreads', 'totals'], bookmakers: [draftKings], estimatedCredits: 3, allowDraw: false,
  },
  epl: {
    id: 'epl', path: '/api/odds/epl', name: 'Premier League', sportKey: 'soccer_epl',
    markets: ['h2h'], bookmakers: soccerBookmakers, estimatedCredits: 1, allowDraw: true,
  },
  'la-liga': {
    id: 'la-liga', path: '/api/odds/la-liga', name: 'La Liga', sportKey: 'soccer_spain_la_liga',
    markets: ['h2h'], bookmakers: soccerBookmakers, estimatedCredits: 1, allowDraw: true,
  },
  'serie-a': {
    id: 'serie-a', path: '/api/odds/serie-a', name: 'Serie A', sportKey: 'soccer_italy_serie_a',
    markets: ['h2h'], bookmakers: soccerBookmakers, estimatedCredits: 1, allowDraw: true,
  },
  bundesliga: {
    id: 'bundesliga', path: '/api/odds/bundesliga', name: 'Bundesliga', sportKey: 'soccer_germany_bundesliga',
    markets: ['h2h'], bookmakers: soccerBookmakers, estimatedCredits: 1, allowDraw: true,
  },
  'champions-league': {
    id: 'champions-league', path: '/api/odds/champions-league', name: 'Champions League',
    sportKey: 'soccer_uefa_champs_league', markets: ['h2h'], bookmakers: soccerBookmakers,
    estimatedCredits: 1, allowDraw: true,
  },
} as const satisfies Record<string, LeagueConfig>;

export const SUPPORTED_LEAGUES = Object.freeze(Object.values(LEAGUES)) as readonly LeagueConfig[];

export function leagueById(value: string): LeagueConfig | null {
  return Object.prototype.hasOwnProperty.call(LEAGUES, value)
    ? LEAGUES[value as LeagueId]
    : null;
}

export function leagueByPath(value: string): LeagueConfig | null {
  return SUPPORTED_LEAGUES.find((league) => league.path === value) ?? null;
}
