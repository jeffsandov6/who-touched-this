import type { SendEmailInput } from './types.js';
import { buildInvitationEmail } from './template.js';
import {
  buildContributionCompletedEmail,
  buildDeadlinePassedEmail,
  buildInvitationReminderEmail,
  buildTurnReminderEmail,
  buildTurnStartedEmail,
} from './lifecycle-template.js';

export const EMAIL_TEST_APP_ORIGIN = 'https://whotouchedthis.website';

export const EMAIL_TEST_JOURNEY_ASSETS = [
  'journey-invited@2x.jpg',
  'journey-turn@2x.jpg',
  'journey-missed@2x.jpg',
  'journey-complete@2x.jpg',
] as const;

export const EMAIL_PREVIEW_TEMPLATE_NAMES = [
  'invitation',
  'invitation-reminder',
  'turn-started',
  'turn-72h',
  'turn-24h',
  'deadline-passed',
  'completion-000',
  'completion-community',
] as const;

export const REAL_INBOX_TEST_TEMPLATE_NAMES = [
  'invitation',
  'turn-started',
  'turn-24h',
  'deadline-passed',
  'completion-community',
] as const;

export type EmailTestTemplateName = typeof EMAIL_PREVIEW_TEMPLATE_NAMES[number];

export interface EmailTestFixtureOptions {
  to: string;
  runId: string;
  now?: Date;
}

function idempotencyKey(name: EmailTestTemplateName, runId: string): string {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(runId)) throw new Error('Email test run ID is invalid.');
  return `local_test_${name.replaceAll('-', '_')}_${runId}`;
}

function buildFixture(
  name: EmailTestTemplateName,
  options: Required<EmailTestFixtureOptions>,
): SendEmailInput {
  const invitationDeadline = new Date(options.now.getTime() + 24 * 60 * 60 * 1_000);
  const turnDeadline = new Date(options.now.getTime() + 72 * 60 * 60 * 1_000);
  const contributor = {
    to: options.to,
    displayName: 'JeffExample',
    appOrigin: EMAIL_TEST_APP_ORIGIN,
    idempotencyKey: idempotencyKey(name, options.runId),
  };
  switch (name) {
    case 'invitation':
      return buildInvitationEmail({
        ...contributor, acceptBy: invitationDeadline, turnDurationHours: 72,
      });
    case 'invitation-reminder':
      return buildInvitationReminderEmail({
        ...contributor, acceptBy: invitationDeadline, turnDurationHours: 72,
      });
    case 'turn-started':
      return buildTurnStartedEmail({
        ...contributor, targetContributionNumber: 42, dueAt: turnDeadline,
        turnDurationHours: 72,
      });
    case 'turn-72h':
      return buildTurnReminderEmail({
        ...contributor, targetContributionNumber: 42, dueAt: turnDeadline,
        turnDurationHours: 168,
      }, 72);
    case 'turn-24h':
      return buildTurnReminderEmail({
        ...contributor, targetContributionNumber: 42, dueAt: turnDeadline,
        turnDurationHours: 72,
      }, 24);
    case 'deadline-passed':
      return buildDeadlinePassedEmail({
        ...contributor, targetContributionNumber: 42, dueAt: turnDeadline,
        turnDurationHours: 72,
      });
    case 'completion-000':
      return buildContributionCompletedEmail({
        ...contributor,
        contributionNumber: 0,
        summary: 'built the beginning of the website',
        prUrl: 'https://github.com/example/example/pull/1',
      });
    case 'completion-community':
      return buildContributionCompletedEmail({
        ...contributor,
        contributionNumber: 42,
        summary: 'added a suspiciously large red button',
        prUrl: 'https://github.com/example/example/pull/42',
      });
  }
}

export function buildEmailTestFixtures(
  names: readonly EmailTestTemplateName[],
  options: EmailTestFixtureOptions,
): Map<EmailTestTemplateName, SendEmailInput> {
  if (!options.to) throw new Error('Email test recipient is required.');
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('Email test fixture date is invalid.');
  const completeOptions = { ...options, now };
  return new Map(names.map((name) => [name, buildFixture(name, completeOptions)]));
}
