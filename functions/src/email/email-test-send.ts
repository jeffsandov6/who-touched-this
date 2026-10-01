import { randomUUID } from 'node:crypto';
import type { EmailProvider, SendEmailInput } from './types.js';
import {
  buildEmailTestFixtures,
  REAL_INBOX_TEST_TEMPLATE_NAMES,
  type EmailTestTemplateName,
} from './email-test-fixtures.js';

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PRODUCTION_DELIVERY_KEY = /^(?:invitation_|invitation_reminder_|turn_started_|turn_72h_reminder_|turn_24h_reminder_|turn_deadline_passed_|contribution_completed_)/;

export interface EmailTestSendOptions {
  argv: string[];
  env: NodeJS.ProcessEnv;
  createProvider(apiKey: string): EmailProvider;
  fetchImpl?: typeof fetch;
  randomId?: () => string;
  log?: (line: string) => void;
}

export interface EmailTestSendResult {
  template: EmailTestTemplateName;
  subject: string;
  messageId: string;
}

export function parseEmailTestSendArguments(argv: readonly string[]): {
  to: string;
  confirmed: boolean;
} {
  let to: string | undefined;
  let confirmed = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--confirm-real-send') {
      if (confirmed) throw new Error('--confirm-real-send may only be supplied once.');
      confirmed = true;
      continue;
    }
    if (argument === '--to') {
      if (to !== undefined) throw new Error('Exactly one --to recipient is required.');
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error('A recipient must follow --to.');
      }
      to = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument ?? ''}`);
  }
  if (!confirmed) {
    throw new Error('This command sends real email through Resend. Add --confirm-real-send to continue.');
  }
  if (to === undefined) throw new Error('Exactly one --to recipient is required.');
  return { to: validateSingleRecipient(to), confirmed };
}

export function validateSingleRecipient(value: string): string {
  if (value !== value.trim() || value.length > 254 || value.includes(',') || value.includes(';')
    || /[\r\n]/.test(value) || !EMAIL_PATTERN.test(value)) {
    throw new Error('Recipient must be exactly one valid email address.');
  }
  return value;
}

function validateRenderedEmails(
  emails: Map<EmailTestTemplateName, SendEmailInput>,
  recipient: string,
): void {
  if (emails.size !== REAL_INBOX_TEST_TEMPLATE_NAMES.length) {
    throw new Error('Real inbox test must render exactly five approved templates.');
  }
  for (const name of REAL_INBOX_TEST_TEMPLATE_NAMES) {
    const email = emails.get(name);
    if (!email || email.to !== recipient || !email.subject || !email.html || !email.text
      || !email.idempotencyKey.startsWith('local_test_')
      || PRODUCTION_DELIVERY_KEY.test(email.idempotencyKey)) {
      throw new Error(`Rendered real inbox test email is invalid: ${name}.`);
    }
  }
}

export function renderedRemoteImageUrls(
  emails: Map<EmailTestTemplateName, SendEmailInput>,
): string[] {
  const urls = new Set<string>();
  for (const name of REAL_INBOX_TEST_TEMPLATE_NAMES) {
    const email = emails.get(name);
    if (!email) throw new Error(`Rendered real inbox test email is missing: ${name}.`);
    const matches = [...email.html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)];
    if (matches.length === 0) throw new Error(`Rendered email has no remote image: ${name}.`);
    for (const match of matches) {
      const source = match[1]!.replaceAll('&amp;', '&');
      const url = new URL(source);
      if (url.protocol !== 'https:' || url.username || url.password) {
        throw new Error(`Rendered email image URL is unsafe: ${name}.`);
      }
      urls.add(url.toString());
    }
  }
  return [...urls];
}

async function preflightRenderedImages(
  emails: Map<EmailTestTemplateName, SendEmailInput>,
  fetchImpl: typeof fetch,
): Promise<void> {
  for (const url of renderedRemoteImageUrls(emails)) {
    let response: Response;
    try {
      response = await fetchImpl(url, { method: 'GET', redirect: 'follow' });
    } catch {
      throw new Error(`Journey artwork preflight failed: ${url}`);
    }
    const contentType = response.headers.get('content-type');
    const bytes = new Uint8Array(await response.arrayBuffer());
    const validJpeg = bytes.length >= 4
      && bytes[0] === 0xff && bytes[1] === 0xd8
      && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
    if (!response.ok || contentType === null
      || !contentType.toLowerCase().startsWith('image/jpeg') || !validJpeg) {
      throw new Error(`Journey artwork preflight failed: ${url}`);
    }
  }
}

export async function runEmailTestSend(options: EmailTestSendOptions): Promise<EmailTestSendResult[]> {
  const { to } = parseEmailTestSendArguments(options.argv);
  const apiKey = options.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error('RESEND_API_KEY is unavailable.');

  const runId = (options.randomId ?? randomUUID)();
  const emails = buildEmailTestFixtures(REAL_INBOX_TEST_TEMPLATE_NAMES, { to, runId });
  validateRenderedEmails(emails, to);
  await preflightRenderedImages(emails, options.fetchImpl ?? fetch);

  const log = options.log ?? console.log;
  log('REAL INBOX TEST');
  log('fake lifecycle data');
  log('no production state will be changed');

  const provider = options.createProvider(apiKey);
  const results: EmailTestSendResult[] = [];
  for (const name of REAL_INBOX_TEST_TEMPLATE_NAMES) {
    const email = emails.get(name)!;
    try {
      const result = await provider.sendEmail(email);
      results.push({ template: name, subject: email.subject, messageId: result.messageId });
      log(`${name} | ${email.subject} | ${result.messageId}`);
    } catch {
      throw new Error(`Real inbox test send failed for template: ${name}.`);
    }
  }
  return results;
}
