import type { SendEmailInput } from './types.js';
import { copy, renderContributorEmail } from './email-shell.js';

export { escapeHtml } from './email-shell.js';

export const INVITATION_EMAIL_SUBJECT = "you're next on who touched this";

export interface InvitationEmailTemplateInput {
  to: string;
  displayName: string;
  acceptBy: Date;
  turnDurationHours: number;
  appOrigin: string;
  idempotencyKey: string;
}

export function invitationJoinUrl(appOrigin: string): string {
  return applicationUrl(appOrigin, '/join');
}

export function applicationUrl(
  appOrigin: string,
  pathname: '/join' | '/history' | '/admin' | '/wtt/claim' | `/history/${number}`,
): string {
  const origin = new URL(appOrigin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) {
    throw new Error('APP_ORIGIN must be an HTTP(S) origin without credentials.');
  }
  return new URL(pathname, origin).toString();
}

export function formatInvitationDate(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new Error('Invitation deadline is invalid.');
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long', timeStyle: 'long', timeZone: 'UTC',
  }).format(date);
}

function validateTurnDuration(hours: number): void {
  if (!Number.isSafeInteger(hours) || hours < 1 || hours > 720) {
    throw new Error('Contribution duration is invalid.');
  }
}

export function formatTurnDuration(hours: number): string {
  validateTurnDuration(hours);
  if (hours % 24 === 0) {
    const days = hours / 24;
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

export function formatTurnDurationAdjective(hours: number): string {
  validateTurnDuration(hours);
  return `${hours}-hour`;
}

export function buildInvitationEmail(input: InvitationEmailTemplateInput): SendEmailInput {
  const joinUrl = invitationJoinUrl(input.appOrigin);
  const deadline = formatInvitationDate(input.acceptBy);
  const duration = formatTurnDurationAdjective(input.turnDurationHours);
  return renderContributorEmail({
    to: input.to,
    subject: INVITATION_EMAIL_SUBJECT,
    preheader: `accept your invitation by ${deadline}.`,
    appOrigin: input.appOrigin,
    idempotencyKey: input.idempotencyKey,
    journeyState: 'invited',
    eyebrow: 'invited',
    headline: "you're up next.",
    displayName: input.displayName,
    paragraphs: [
      copy('thanks for taking part in who touched this. seriously, we appreciate it :)'),
      copy("you've been invited to take the next turn."),
      copy(`accept by ${deadline}.`),
      copy(`your ${duration} clock won't start until you accept, so no panic yet.`),
      copy('sign in with the same GitHub account you used to join.'),
    ],
    primaryAction: { label: 'accept your turn', url: joinUrl },
  });
}
