const HOUR_MS = 60 * 60 * 1000;

export const INVITATION_REMINDER_HOURS = 6;
export const TURN_REMINDER_72_HOURS = 72;
export const TURN_REMINDER_24_HOURS = 24;

interface InvitationTiming {
  status: string;
  invitedAt: Date;
  acceptBy: Date;
}

interface TurnTiming {
  status: string;
  startedAt: Date;
  dueAt: Date;
}

export function isInvitationReminderEligible(value: InvitationTiming, now: Date): boolean {
  const originalWindow = value.acceptBy.getTime() - value.invitedAt.getTime();
  const remaining = value.acceptBy.getTime() - now.getTime();
  return value.status === 'pending'
    && originalWindow > INVITATION_REMINDER_HOURS * HOUR_MS
    && remaining > 0
    && remaining <= INVITATION_REMINDER_HOURS * HOUR_MS;
}

export function isTurn72HourReminderEligible(value: TurnTiming, now: Date): boolean {
  const originalDuration = value.dueAt.getTime() - value.startedAt.getTime();
  const remaining = value.dueAt.getTime() - now.getTime();
  return value.status === 'active'
    && originalDuration > TURN_REMINDER_72_HOURS * HOUR_MS
    && remaining > TURN_REMINDER_24_HOURS * HOUR_MS
    && remaining <= TURN_REMINDER_72_HOURS * HOUR_MS;
}

export function isTurn24HourReminderEligible(value: TurnTiming, now: Date): boolean {
  const originalDuration = value.dueAt.getTime() - value.startedAt.getTime();
  const remaining = value.dueAt.getTime() - now.getTime();
  return value.status === 'active'
    && originalDuration > TURN_REMINDER_24_HOURS * HOUR_MS
    && remaining > 0
    && remaining <= TURN_REMINDER_24_HOURS * HOUR_MS;
}

export function isTurnDeadlinePassedEmailEligible(value: TurnTiming, now: Date): boolean {
  return value.status === 'active' && value.dueAt.getTime() <= now.getTime();
}

function safeId(value: string, label: string): string {
  if (!value || value.includes('/')) throw new Error(`${label} is invalid.`);
  return value;
}

export const deliveryIds = {
  invitation: (id: string) => `invitation_${safeId(id, 'Invitation ID')}`,
  invitationReminder: (id: string) => `invitation_reminder_${safeId(id, 'Invitation ID')}`,
  turnStarted: (id: string) => `turn_started_${safeId(id, 'Turn ID')}`,
  turn72HourReminder: (id: string) => `turn_72h_reminder_${safeId(id, 'Turn ID')}`,
  turn24HourReminder: (id: string) => `turn_24h_reminder_${safeId(id, 'Turn ID')}`,
  turnDeadlinePassed: (id: string) => `turn_deadline_passed_${safeId(id, 'Turn ID')}`,
  prSubmitted: (id: string) => `pr_submitted_${safeId(id, 'Turn ID')}`,
  contributionCompleted: (number: number) => {
    if (!Number.isSafeInteger(number) || number < 0) throw new Error('Contribution number is invalid.');
    return `contribution_completed_${number}`;
  },
  contributionCompletedResend: (number: number, requestId: string) => {
    if (!Number.isSafeInteger(number) || number < 0) throw new Error('Contribution number is invalid.');
    return `contribution_completed_resend_${number}_${safeId(requestId, 'Resend request ID')}`;
  },
} as const;
