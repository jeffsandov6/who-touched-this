import type { SendEmailInput } from './types.js';
import { copy, escapeHtml, renderContributorEmail, type EmailCopy } from './email-shell.js';
import { applicationUrl, formatInvitationDate, formatTurnDurationAdjective } from './template.js';

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
  turnDurationHours: number;
}

interface ContributionInput extends BaseInput {
  contributionNumber: number;
  summary: string;
  prUrl: string;
}

function numberLabel(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Contribution number is invalid.');
  return String(value).padStart(3, '0');
}

function supportSentence(prefix: string, suffix: string): EmailCopy {
  return {
    text: `${prefix}hello@whotouchedthis.website${suffix}`,
    html: `${escapeHtml(prefix)}<a href="mailto:hello@whotouchedthis.website" style="color:#171717">hello@whotouchedthis.website</a>${escapeHtml(suffix)}`,
  };
}

export function buildInvitationReminderEmail(input: InvitationReminderInput): SendEmailInput {
  const deadline = formatInvitationDate(input.acceptBy);
  const duration = formatTurnDurationAdjective(input.turnDurationHours);
  return renderContributorEmail({
    ...input,
    subject: 'your who touched this invitation expires soon',
    preheader: `your invitation expires at ${deadline}.`,
    journeyState: 'invited', eyebrow: 'invited', headline: 'still want it?',
    paragraphs: [
      copy(`your invitation expires at ${deadline}.`),
      copy(`your ${duration} clock still hasn't started, but the invitation clock definitely has.`),
      copy('if you want the turn, accept before the deadline.'),
    ],
    primaryAction: { label: 'review your invitation', url: applicationUrl(input.appOrigin, '/join') },
  });
}

export function buildTurnStartedEmail(input: TurnInput): SendEmailInput {
  const number = numberLabel(input.targetContributionNumber);
  const deadline = formatInvitationDate(input.dueAt);
  formatTurnDurationAdjective(input.turnDurationHours);
  return renderContributorEmail({
    ...input,
    subject: "it's your turn on who touched this",
    preheader: `the clock is officially running for Contribution #${number}.`,
    journeyState: 'turn', eyebrow: 'your turn', headline: "okay. don't break it.",
    paragraphs: [
      copy(`the clock is officially running for Contribution #${number}.`),
      copy(`you've got ${input.turnDurationHours} hours. your deadline is ${deadline}.`),
      copy('make one small contribution. make it yours.'),
    ],
    primaryAction: { label: 'view your turn', url: applicationUrl(input.appOrigin, '/join') },
  });
}

export function buildTurnReminderEmail(input: TurnInput, threshold: 72 | 24): SendEmailInput {
  formatTurnDurationAdjective(input.turnDurationHours);
  const number = numberLabel(input.targetContributionNumber);
  const subject = threshold === 72
    ? '3 days left on your who touched this turn'
    : '24 hours left on your who touched this turn';
  return renderContributorEmail({
    ...input,
    subject,
    preheader: `about ${threshold} hours remain for Contribution #${number}.`,
    journeyState: 'turn', eyebrow: 'your turn', headline: "clock's ticking.",
    paragraphs: [
      copy(`about ${threshold} hours remain for Contribution #${number}.`),
      copy(`your deadline is ${formatInvitationDate(input.dueAt)}.`),
      supportSentence("think you'll need more time? email ", ' before the deadline.'),
      copy("extensions aren't guaranteed, but disappearing into the void won't help :("),
    ],
    primaryAction: { label: 'view your turn', url: applicationUrl(input.appOrigin, '/join') },
  });
}

export function buildDeadlinePassedEmail(input: TurnInput): SendEmailInput {
  const number = numberLabel(input.targetContributionNumber);
  const duration = formatTurnDurationAdjective(input.turnDurationHours);
  return renderContributorEmail({
    ...input,
    subject: 'your who touched this deadline has passed',
    preheader: `the ${duration} window for Contribution #${number} has ended.`,
    journeyState: 'missed', eyebrow: 'your turn', headline: "well... time's up.",
    paragraphs: [
      copy(`the ${duration} window for Contribution #${number} ended at ${formatInvitationDate(input.dueAt)}.`),
      copy("if you've already got a pull request ready, send it now. we may still review a late submission, but no promises."),
      supportSentence("if not, that's probably the end of this turn (we get it, life). want another shot later? email ", ' :)'),
    ],
    primaryAction: { label: 'view your turn', url: applicationUrl(input.appOrigin, '/join') },
  });
}

export function buildContributionCompletedEmail(input: ContributionInput): SendEmailInput {
  const number = numberLabel(input.contributionNumber);
  const summary = input.summary.trim();
  if (!summary || summary.length > 160) throw new Error('Contribution summary is invalid.');
  const pr = new URL(input.prUrl);
  if (pr.protocol !== 'https:' || pr.hostname !== 'github.com' || pr.username || pr.password
    || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*\/?$/.test(pr.pathname)) {
    throw new Error('PR URL is invalid.');
  }
  const contributionUrl = applicationUrl(input.appOrigin, `/history/${input.contributionNumber}`);
  const claimUrl = applicationUrl(input.appOrigin, '/wtt/claim');
  return renderContributorEmail({
    ...input,
    subject: `Contribution #${number} is live on who touched this`,
    preheader: `Contribution #${number} is live.`,
    journeyState: 'complete', eyebrow: 'touched it', headline: 'you actually did it.',
    paragraphs: [
      copy(`Contribution #${number} is live.`),
      copy(summary),
      copy('the website is slightly more yours now.'),
    ],
    detail: [{
      text: `GitHub pull request: ${pr.toString()}`,
      html: `GitHub pull request: <a href="${escapeHtml(pr.toString())}" style="color:#171717">${escapeHtml(pr.toString())}</a>`,
    }],
    primaryAction: { label: 'view contribution', url: contributionUrl },
    secondary: {
      heading: 'unfortunately, you earned 1 wtt.',
      paragraphs: [
        copy('you touched the website. this is the consequence.'),
        copy("wtt is a crypto token on Solana. claiming it is optional & free. you don't need to buy SOL or pay anything to claim it (we pay the fees)."),
      ],
      action: { label: 'claim your wtt', url: claimUrl },
    },
    closing: [copy("new to Solana wallets? we'll walk you through it on the claim page.")],
  });
}
