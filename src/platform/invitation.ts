export const DEFAULT_TURN_DURATION_HOURS = 72;
export const MIN_TURN_DURATION_HOURS = 1;
export const MAX_TURN_DURATION_HOURS = 720;
export const MAX_INVITATION_WINDOW_HOURS = 168;

export class InvitationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvitationValidationError';
  }
}

export function validateTurnDurationHours(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_TURN_DURATION_HOURS ||
    value > MAX_TURN_DURATION_HOURS
  ) {
    throw new InvitationValidationError(
      `contribution duration must be a whole number from ${MIN_TURN_DURATION_HOURS} to ${MAX_TURN_DURATION_HOURS} hours.`,
    );
  }
  return value;
}

export function validateInvitationDeadline(acceptBy: Date, nowMillis = Date.now()): Date {
  const acceptByMillis = acceptBy.getTime();
  const latest = nowMillis + MAX_INVITATION_WINDOW_HOURS * 60 * 60 * 1_000;
  if (!Number.isFinite(acceptByMillis) || acceptByMillis <= nowMillis || acceptByMillis > latest) {
    throw new InvitationValidationError(
      `invitation deadline must be within the next ${MAX_INVITATION_WINDOW_HOURS} hours.`,
    );
  }
  return acceptBy;
}

export function calculateTurnDueAtMillis(
  acceptedAtMillis: number,
  turnDurationHours: number,
): number {
  validateTurnDurationHours(turnDurationHours);
  if (!Number.isFinite(acceptedAtMillis)) {
    throw new InvitationValidationError('acceptance time is invalid.');
  }
  return acceptedAtMillis + turnDurationHours * 60 * 60 * 1_000;
}

export function canExpireInvitation(
  status: string,
  acceptByMillis: number,
  nowMillis: number,
): boolean {
  return status === 'pending' && Number.isFinite(acceptByMillis) && nowMillis >= acceptByMillis;
}

export function formatTurnDuration(turnDurationHours: number): string {
  validateTurnDurationHours(turnDurationHours);
  if (turnDurationHours % 24 === 0) {
    const days = turnDurationHours / 24;
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  return `${turnDurationHours} ${turnDurationHours === 1 ? 'hour' : 'hours'}`;
}
