import type { SendEmailInput } from './types.js';

export const INVITATION_EMAIL_SUBJECT = 'your turn on who touched this';

export interface InvitationEmailTemplateInput {
  to: string;
  displayName: string;
  acceptBy: Date;
  turnDurationHours: number;
  appOrigin: string;
  idempotencyKey: string;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character] ?? character);
}

export function invitationJoinUrl(appOrigin: string): string {
  const origin = new URL(appOrigin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) {
    throw new Error('APP_ORIGIN must be an HTTP(S) origin without credentials.');
  }
  return new URL('/join', origin).toString();
}

export function applicationUrl(appOrigin: string, pathname: '/join' | '/history' | '/admin'): string {
  const origin = new URL(appOrigin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) {
    throw new Error('APP_ORIGIN must be an HTTP(S) origin without credentials.');
  }
  return new URL(pathname, origin).toString();
}

export function formatInvitationDate(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new Error('Invitation deadline is invalid.');
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
    timeStyle: 'long',
    timeZone: 'UTC',
  }).format(date);
}

export function formatTurnDuration(hours: number): string {
  if (!Number.isSafeInteger(hours) || hours < 1 || hours > 720) {
    throw new Error('Contribution duration is invalid.');
  }
  if (hours % 24 === 0) {
    const days = hours / 24;
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

export function buildInvitationEmail(input: InvitationEmailTemplateInput): SendEmailInput {
  const joinUrl = invitationJoinUrl(input.appOrigin);
  const deadline = formatInvitationDate(input.acceptBy);
  const duration = formatTurnDuration(input.turnDurationHours);
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 50) throw new Error('Contributor display name is invalid.');

  const text = [
    `hello ${displayName},`,
    '',
    "you've been selected for the next turn on who touched this.",
    `accept your invitation by ${deadline}.`,
    `your contribution timer has not started yet. after accepting, you'll have ${duration}.`,
    'sign in with the same GitHub account you used to join.',
    '',
    `accept your turn: ${joinUrl}`,
  ].join('\n');

  const htmlName = escapeHtml(displayName);
  const htmlDeadline = escapeHtml(deadline);
  const htmlDuration = escapeHtml(duration);
  const htmlJoinUrl = escapeHtml(joinUrl);
  const html = `<!doctype html>
<html lang="en">
  <body style="font-family:system-ui,sans-serif;line-height:1.5;color:#202124">
    <main style="max-width:600px;margin:0 auto;padding:24px">
      <h1 style="font-size:22px">who touched this</h1>
      <p>hello ${htmlName},</p>
      <p>you&rsquo;ve been selected for the next turn on who touched this.</p>
      <p>accept your invitation by <strong>${htmlDeadline}</strong>.</p>
      <p>your contribution timer has not started yet. after accepting, you&rsquo;ll have ${htmlDuration}.</p>
      <p>sign in with the same GitHub account you used to join.</p>
      <p><a href="${htmlJoinUrl}">accept your turn</a></p>
    </main>
  </body>
</html>`;

  return {
    to: input.to,
    subject: INVITATION_EMAIL_SUBJECT,
    text,
    html,
    idempotencyKey: input.idempotencyKey,
  };
}
