import { ResendEmailProvider } from '../lib/src/email/resend-provider.js';
import { runEmailTestSend } from '../lib/src/email/email-test-send.js';

try {
  await runEmailTestSend({
    argv: process.argv.slice(2),
    env: process.env,
    createProvider: (apiKey) => new ResendEmailProvider(apiKey),
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Real inbox test send failed.');
  process.exitCode = 1;
}
