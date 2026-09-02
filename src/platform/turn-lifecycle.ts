export const PULL_REQUEST_URL_MAX_LENGTH = 500;

export interface PullRequestSubmission {
  prNumber: number;
  prUrl: string;
}

export type CurrentPublicTurnStatus = 'none' | 'active' | 'submitted' | 'under_review';

export interface PublicTurnPresentation {
  statusLabel: string;
  targetLabel: string | null;
  showCountdown: boolean;
}

export class PullRequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PullRequestValidationError';
  }
}

function parsePullRequestNumber(value: string | number): number {
  const normalized = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw new PullRequestValidationError('Enter a valid positive pull request number.');
  }
  return normalized;
}

export function normalizePullRequestSubmission(
  rawUrl: string,
  rawNumber: string | number,
): PullRequestSubmission {
  const candidate = rawUrl.trim();
  if (!candidate || candidate.length > PULL_REQUEST_URL_MAX_LENGTH) {
    throw new PullRequestValidationError('Enter a valid GitHub pull request URL.');
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new PullRequestValidationError('Enter a valid GitHub pull request URL.');
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname.toLowerCase() !== 'github.com' ||
    parsed.port ||
    parsed.username ||
    parsed.password
  ) {
    throw new PullRequestValidationError('Use an HTTPS github.com pull request URL.');
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (
    segments.length !== 4 ||
    !/^[A-Za-z0-9_.-]+$/.test(segments[0] ?? '') ||
    !/^[A-Za-z0-9_.-]+$/.test(segments[1] ?? '') ||
    segments[2] !== 'pull' ||
    !/^[1-9][0-9]*$/.test(segments[3] ?? '')
  ) {
    throw new PullRequestValidationError(
      'Use a GitHub URL shaped like https://github.com/owner/repo/pull/123.',
    );
  }

  const urlNumber = Number(segments[3]);
  const enteredNumber = parsePullRequestNumber(rawNumber);
  if (!Number.isSafeInteger(urlNumber) || urlNumber !== enteredNumber) {
    throw new PullRequestValidationError('The pull request number must match the URL.');
  }

  return {
    prNumber: enteredNumber,
    prUrl: `https://github.com/${segments[0]}/${segments[1]}/pull/${enteredNumber}`,
  };
}

export function canExpireTurn(
  status: string,
  dueAtMillis: number,
  nowMillis: number,
): boolean {
  return status === 'active' && Number.isFinite(dueAtMillis) && nowMillis >= dueAtMillis;
}

export function getPublicTurnPresentation(
  status: CurrentPublicTurnStatus,
): PublicTurnPresentation {
  switch (status) {
    case 'active':
      return { statusLabel: 'Active', targetLabel: 'Working on', showCountdown: true };
    case 'submitted':
      return { statusLabel: 'PR submitted', targetLabel: 'Contribution', showCountdown: false };
    case 'under_review':
      return { statusLabel: 'Under review', targetLabel: 'Contribution', showCountdown: false };
    case 'none':
      return { statusLabel: 'No active turn', targetLabel: null, showCountdown: false };
  }
}
