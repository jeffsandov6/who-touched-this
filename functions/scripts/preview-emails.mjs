import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildInvitationEmail } from '../lib/src/email/template.js';
import {
  buildContributionCompletedEmail,
  buildDeadlinePassedEmail,
  buildInvitationReminderEmail,
  buildTurnReminderEmail,
  buildTurnStartedEmail,
} from '../lib/src/email/lifecycle-template.js';
import { buildAdminPrSubmittedEmail } from '../lib/src/email/admin-submission-delivery.js';

const outputDir = join(dirname(fileURLToPath(import.meta.url)), '..', '.email-previews');
const previewAssetDir = join(outputDir, 'assets');
const publicAssetDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'email', 'journey');
const appOrigin = 'https://whotouchedthis.website';
const journeyAssets = [
  'journey-invited@2x.jpg',
  'journey-turn@2x.jpg',
  'journey-missed@2x.jpg',
  'journey-complete@2x.jpg',
];
const contributor = {
  to: 'jeffexample@example.test',
  displayName: 'JeffExample',
  appOrigin,
};
const invitationDeadline = new Date('2026-10-01T18:00:00.000Z');
const turnDeadline = new Date('2026-10-04T18:00:00.000Z');

const previews = new Map([
  ['invitation', buildInvitationEmail({
    ...contributor, acceptBy: invitationDeadline, turnDurationHours: 72,
    idempotencyKey: 'preview_invitation',
  })],
  ['invitation-reminder', buildInvitationReminderEmail({
    ...contributor, acceptBy: invitationDeadline, turnDurationHours: 72,
    idempotencyKey: 'preview_invitation_reminder',
  })],
  ['turn-started', buildTurnStartedEmail({
    ...contributor, targetContributionNumber: 42, dueAt: turnDeadline,
    turnDurationHours: 72, idempotencyKey: 'preview_turn_started',
  })],
  ['turn-72h', buildTurnReminderEmail({
    ...contributor, targetContributionNumber: 42, dueAt: turnDeadline,
    turnDurationHours: 168, idempotencyKey: 'preview_turn_72h',
  }, 72)],
  ['turn-24h', buildTurnReminderEmail({
    ...contributor, targetContributionNumber: 42, dueAt: turnDeadline,
    turnDurationHours: 72, idempotencyKey: 'preview_turn_24h',
  }, 24)],
  ['deadline-passed', buildDeadlinePassedEmail({
    ...contributor, targetContributionNumber: 42, dueAt: turnDeadline,
    turnDurationHours: 72, idempotencyKey: 'preview_deadline',
  })],
  ['completion-000', buildContributionCompletedEmail({
    ...contributor, contributionNumber: 0, summary: 'built the beginning of the website',
    prUrl: 'https://github.com/example/who-touched-this/pull/1',
    idempotencyKey: 'preview_completion_000',
  })],
  ['completion-community', buildContributionCompletedEmail({
    ...contributor, contributionNumber: 42, summary: 'added a suspiciously large red button',
    prUrl: 'https://github.com/example/who-touched-this/pull/420',
    idempotencyKey: 'preview_completion_042',
  })],
  ['admin-pr-submitted', buildAdminPrSubmittedEmail({
    displayName: 'JeffExample', githubUsername: 'jeff-example', contributionNumber: 42,
    prNumber: 420, prUrl: 'https://github.com/example/who-touched-this/pull/420',
    submittedAt: new Date('2026-10-03T14:30:00.000Z'), appOrigin,
    expectedRepository: 'example/who-touched-this', idempotencyKey: 'preview_admin_pr',
  })],
]);

await rm(outputDir, { recursive: true, force: true });
await mkdir(previewAssetDir, { recursive: true });
await Promise.all(journeyAssets.map((filename) => (
  copyFile(join(publicAssetDir, filename), join(previewAssetDir, filename))
)));
for (const [name, email] of previews) {
  const localHtml = email.html.replaceAll(`${appOrigin}/email/journey/`, './assets/');
  await writeFile(join(outputDir, `${name}.html`), localHtml, 'utf8');
  await writeFile(join(outputDir, `${name}.txt`), `${email.subject}\n\n${email.text}\n`, 'utf8');
}

const links = [...previews.keys()].map((name) => (
  `<li><a href="./${name}.html">${name}</a> · <a href="./${name}.txt">plain text</a></li>`
)).join('\n');
await writeFile(join(outputDir, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>local email previews</title></head>
<body style="font:16px/1.5 system-ui,sans-serif;max-width:680px;margin:40px auto;padding:0 20px">
<h1>who touched this — local email previews</h1>
<p><strong>local preview — no email sent</strong></p><ul>${links}</ul>
</body></html>`, 'utf8');

console.log(`Generated ${previews.size} local email previews in ${outputDir}`);
