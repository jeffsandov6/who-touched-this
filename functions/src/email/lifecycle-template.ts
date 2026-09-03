import type { SendEmailInput } from './types.js';
import {
  applicationUrl,
  escapeHtml,
  formatInvitationDate,
  formatTurnDuration,
} from './template.js';

interface BaseInput {
  to: string;
  displayName: string;
  appOrigin: string;
  idempotencyKey: string;
}

interface InvitationReminderInput extends BaseInput {
  acceptBy: Date;
  turnDurationHours: number;
}

interface TurnInput extends BaseInput {
  targetContributionNumber: number;
  dueAt: Date;
}

interface ContributionInput extends BaseInput {
  contributionNumber: number;
  summary: string;
  prUrl: string;
}

function validateName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 50) throw new Error('Contributor display name is invalid.');
  return name;
}

function emailDocument(subject: string, name: string, paragraphs: string[], cta: string, label: string) {
  const text = [`Hello ${name},`, '', ...paragraphs, '', `${label}: ${cta}`].join('\n');
  const htmlParagraphs = paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('\n      ');
  const html = `<!doctype html>
<html lang="en">
  <body style="font-family:system-ui,sans-serif;line-height:1.5;color:#202124">
    <main style="max-width:600px;margin:0 auto;padding:24px">
      <h1 style="font-size:22px">Who Touched This</h1>
      <p>Hello ${escapeHtml(name)},</p>
      ${htmlParagraphs}
      <p><a href="${escapeHtml(cta)}">${escapeHtml(label)}</a></p>
    </main>
  </body>
</html>`;
  return { subject, text, html };
}

function finish(input: BaseInput, content: ReturnType<typeof emailDocument>): SendEmailInput {
  return { to: input.to, idempotencyKey: input.idempotencyKey, ...content };
}

export function buildInvitationReminderEmail(input: InvitationReminderInput): SendEmailInput {
  const name = validateName(input.displayName);
  const deadline = formatInvitationDate(input.acceptBy);
  const duration = formatTurnDuration(input.turnDurationHours);
  return finish(input, emailDocument(
    'Your Who Touched This invitation expires soon', name,
    [
      `Your invitation expires at ${deadline}.`,
      `Your contribution clock has not started. After accepting, you will have ${duration}.`,
      'Sign in with the same GitHub account you used to join.',
    ],
    applicationUrl(input.appOrigin, '/join'), 'Review your invitation',
  ));
}

export function buildTurnStartedEmail(input: TurnInput): SendEmailInput {
  const name = validateName(input.displayName);
  return finish(input, emailDocument(
    'Your Who Touched This turn has started', name,
    [
      `The clock is now running for Contribution #${String(input.targetContributionNumber).padStart(3, '0')}.`,
      `Your absolute deadline is ${formatInvitationDate(input.dueAt)}.`,
    ],
    applicationUrl(input.appOrigin, '/join'), 'View your turn',
  ));
}

export function buildTurnReminderEmail(
  input: TurnInput,
  threshold: 72 | 24,
): SendEmailInput {
  const name = validateName(input.displayName);
  const subject = threshold === 72
    ? '3 days left on your Who Touched This turn'
    : '24 hours left on your Who Touched This turn';
  return finish(input, emailDocument(
    subject, name,
    [
      `About ${threshold} hours remain for Contribution #${String(input.targetContributionNumber).padStart(3, '0')}.`,
      `Your absolute deadline is ${formatInvitationDate(input.dueAt)}.`,
    ],
    applicationUrl(input.appOrigin, '/join'), 'View your turn',
  ));
}

export function buildDeadlinePassedEmail(input: TurnInput): SendEmailInput {
  const name = validateName(input.displayName);
  return finish(input, emailDocument(
    'Your Who Touched This deadline has passed', name,
    [
      `The deadline for Contribution #${String(input.targetContributionNumber).padStart(3, '0')} passed at ${formatInvitationDate(input.dueAt)}.`,
      'Your turn remains technically open until the owner explicitly closes it.',
      'If you already have a pull request ready, you may still submit it or contact the owner, but late acceptance is not guaranteed.',
    ],
    applicationUrl(input.appOrigin, '/join'), 'View your turn',
  ));
}

export function buildContributionCompletedEmail(input: ContributionInput): SendEmailInput {
  const name = validateName(input.displayName);
  const number = String(input.contributionNumber).padStart(3, '0');
  const summary = input.summary.trim();
  if (!summary || summary.length > 160) throw new Error('Contribution summary is invalid.');
  const pr = new URL(input.prUrl);
  if (pr.protocol !== 'https:' || pr.hostname !== 'github.com' || pr.username || pr.password
    || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*\/?$/.test(pr.pathname)) {
    throw new Error('PR URL is invalid.');
  }
  return finish(input, emailDocument(
    `Contribution #${number} is now part of Who Touched This`, name,
    [
      `Contribution #${number} is now a permanent part of Who Touched This.`,
      `Summary: ${summary}`,
      `GitHub pull request: ${pr.toString()}`,
      'Thank you for contributing to the experiment.',
    ],
    applicationUrl(input.appOrigin, '/history'), 'View public history',
  ));
}
