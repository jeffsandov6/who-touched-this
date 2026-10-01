import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  parseEmailTestSendArguments,
  renderedRemoteImageUrls,
  runEmailTestSend,
  validateSingleRecipient,
} from '../src/email/email-test-send.js';
import {
  buildEmailTestFixtures,
  REAL_INBOX_TEST_TEMPLATE_NAMES,
} from '../src/email/email-test-fixtures.js';
import type { EmailProvider, SendEmailInput } from '../src/email/types.js';

class CapturingProvider implements EmailProvider {
  readonly sends: SendEmailInput[] = [];

  async sendEmail(input: SendEmailInput) {
    this.sends.push(input);
    return { messageId: `test-message-${this.sends.length}` };
  }
}

const successfulFetch: typeof fetch = async () => new Response(
  new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
  status: 200,
  headers: { 'content-type': 'image/jpeg' },
  },
);

test('real-send confirmation and one explicit recipient are mandatory', () => {
  assert.throws(
    () => parseEmailTestSendArguments(['--to', 'maintainer@example.com']),
    /sends real email through Resend.*--confirm-real-send/,
  );
  assert.throws(
    () => parseEmailTestSendArguments(['--confirm-real-send']),
    /Exactly one --to recipient/,
  );
  assert.deepEqual(parseEmailTestSendArguments([
    '--to', 'maintainer@example.com', '--confirm-real-send',
  ]), { to: 'maintainer@example.com', confirmed: true });
});

test('recipient validation rejects malformed, multiple, and injected values', () => {
  for (const value of [
    'not-an-email',
    'one@example.com,two@example.com',
    'one@example.com;two@example.com',
    'one@example.com\nBcc: attacker@example.com',
    ' one@example.com',
  ]) {
    assert.throws(() => validateSingleRecipient(value), /exactly one valid email address/);
  }
  assert.throws(() => parseEmailTestSendArguments([
    '--to', 'one@example.com', '--to', 'two@example.com', '--confirm-real-send',
  ]), /Exactly one --to recipient/);
});

test('real inbox test renders and sends only the five approved templates', async () => {
  const provider = new CapturingProvider();
  const logs: string[] = [];
  let providerKey: string | undefined;
  const fetched: string[] = [];
  const result = await runEmailTestSend({
    argv: ['--to', 'maintainer@example.com', '--confirm-real-send'],
    env: { RESEND_API_KEY: 're_test_fake_key' },
    createProvider(apiKey) { providerKey = apiKey; return provider; },
    randomId: () => 'test_run_12345678',
    fetchImpl: async (input, init) => {
      fetched.push(String(input));
      assert.equal(init?.method, 'GET');
      return await successfulFetch(input, init);
    },
    log: (line) => logs.push(line),
  });

  assert.equal(providerKey, 're_test_fake_key');
  assert.deepEqual(result.map(({ template }) => template), [...REAL_INBOX_TEST_TEMPLATE_NAMES]);
  assert.equal(provider.sends.length, 5);
  assert.deepEqual(new Set(provider.sends.map(({ to }) => to)), new Set(['maintainer@example.com']));
  assert.equal(fetched.length, 4);
  assert.deepEqual(fetched, [
    'https://whotouchedthis.website/email/journey/journey-invited@2x.jpg',
    'https://whotouchedthis.website/email/journey/journey-turn@2x.jpg',
    'https://whotouchedthis.website/email/journey/journey-missed@2x.jpg',
    'https://whotouchedthis.website/email/journey/journey-complete@2x.jpg',
  ]);
  assert.match(logs.join('\n'), /REAL INBOX TEST.*fake lifecycle data.*no production state/s);

  const names = result.map(({ template }) => template);
  assert.ok(!names.includes('invitation-reminder'));
  assert.ok(!names.includes('turn-72h'));
  assert.ok(!names.some((name) => String(name) === 'admin-pr-submitted'));

  const completion = provider.sends[4]!;
  assert.match(completion.text, /Contribution #042/);
  assert.match(completion.text, /added a suspiciously large red button/);
  assert.match(completion.text, /https:\/\/whotouchedthis\.website\/wtt\/claim/);
  for (const email of provider.sends) {
    assert.match(email.idempotencyKey, /^local_test_/);
    assert.doesNotMatch(email.idempotencyKey,
      /^(?:invitation_|turn_started_|turn_24h_reminder_|turn_deadline_passed_|contribution_completed_)/);
  }
});

test('all five templates are rendered before provider construction or any send', async () => {
  let providerConstructed = false;
  await assert.rejects(runEmailTestSend({
    argv: ['--to', 'maintainer@example.com', '--confirm-real-send'],
    env: { RESEND_API_KEY: 're_test_fake_key' },
    createProvider() { providerConstructed = true; return new CapturingProvider(); },
    randomId: () => 'test_run_12345678',
    fetchImpl: async (input, init) => String(input).includes('journey-missed@2x.jpg')
      ? new Response(null, { status: 404 })
      : await successfulFetch(input, init),
    log() {},
  }), /Journey artwork preflight failed: .*journey-missed@2x\.jpg/);
  assert.equal(providerConstructed, false);
});

test('fixtures use fake data, universal links, and test-only delivery keys', () => {
  const fixtures = buildEmailTestFixtures(REAL_INBOX_TEST_TEMPLATE_NAMES, {
    to: 'maintainer@example.com',
    runId: 'fixture_run_1234',
    now: new Date('2030-01-01T00:00:00.000Z'),
  });
  assert.equal(fixtures.size, 5);
  assert.match(fixtures.get('completion-community')!.text, /Contribution #042/);
  assert.match(fixtures.get('completion-community')!.text, /\/wtt\/claim/);
  assert.ok(renderedRemoteImageUrls(fixtures).includes(
    'https://whotouchedthis.website/email/journey/journey-missed@2x.jpg',
  ));
});

test('local-only test-send sources have no Firebase, delivery-store, or WTT mutation imports', async () => {
  const fixtureSource = await readFile(
    new URL('../../src/email/email-test-fixtures.ts', import.meta.url), 'utf8',
  );
  const coreSource = await readFile(
    new URL('../../src/email/email-test-send.ts', import.meta.url), 'utf8',
  );
  const scriptSource = await readFile(
    new URL('../../scripts/send-test-emails.mjs', import.meta.url), 'utf8',
  );
  assert.doesNotMatch(fixtureSource, /firebase(?:-admin|-functions)?|firestore/i);
  assert.doesNotMatch(fixtureSource, /admin-submission-delivery|lifecycle-delivery|delivery-store/i);
  for (const source of [coreSource, scriptSource]) {
    assert.doesNotMatch(source,
      /firebase(?:-admin|-functions)?|firestore|lifecycle-delivery|delivery-store|wtt\/(?:claims|challenges|entitlements)/i);
  }
});
