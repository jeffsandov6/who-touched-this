import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildEmailTestFixtures,
  EMAIL_PREVIEW_TEMPLATE_NAMES,
  EMAIL_TEST_APP_ORIGIN,
  EMAIL_TEST_JOURNEY_ASSETS,
} from '../lib/src/email/email-test-fixtures.js';
import { buildAdminPrSubmittedEmail } from '../lib/src/email/admin-submission-delivery.js';

const outputDir = join(dirname(fileURLToPath(import.meta.url)), '..', '.email-previews');
const previewAssetDir = join(outputDir, 'assets');
const publicAssetDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'email', 'journey');
const previews = buildEmailTestFixtures(EMAIL_PREVIEW_TEMPLATE_NAMES, {
  to: 'jeffexample@example.test',
  runId: 'local_preview',
  now: new Date('2030-10-01T18:00:00.000Z'),
});
previews.set('admin-pr-submitted', buildAdminPrSubmittedEmail({
  displayName: 'JeffExample',
  githubUsername: 'jeff-example',
  contributionNumber: 42,
  prNumber: 42,
  prUrl: 'https://github.com/example/example/pull/42',
  submittedAt: new Date('2030-10-03T18:00:00.000Z'),
  appOrigin: EMAIL_TEST_APP_ORIGIN,
  expectedRepository: 'example/example',
  idempotencyKey: 'local_test_admin_pr_submitted_local_preview',
}));

await rm(outputDir, { recursive: true, force: true });
await mkdir(previewAssetDir, { recursive: true });
await Promise.all(EMAIL_TEST_JOURNEY_ASSETS.map((filename) => (
  copyFile(join(publicAssetDir, filename), join(previewAssetDir, filename))
)));
for (const [name, email] of previews) {
  const localHtml = email.html.replaceAll(`${EMAIL_TEST_APP_ORIGIN}/email/journey/`, './assets/');
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
