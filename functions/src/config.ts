import { defineSecret, defineString } from 'firebase-functions/params';

export const resendApiKey = defineSecret('RESEND_API_KEY');
export const githubWebhookSecret = defineSecret('GITHUB_WEBHOOK_SECRET');
export const appOrigin = defineString('APP_ORIGIN', {
  default: 'https://whotouchedthis.website',
  description: 'Canonical public application origin used in transactional email links.',
});
export const emailProviderMode = defineString('EMAIL_PROVIDER_MODE', {
  default: 'resend',
  description: 'Production uses resend. The emulator forces local unless set to failure.',
});
export const githubRepository = defineString('GITHUB_REPOSITORY', {
  default: 'jeffsandov6/who-touched-this',
  description: 'Canonical GitHub owner/repository accepted by the webhook.',
});
export const githubBaseBranch = defineString('GITHUB_BASE_BRANCH', {
  default: 'main',
  description: 'Canonical base branch accepted for contributor pull requests.',
});

const PRODUCTION_APP_ORIGIN = 'https://whotouchedthis.website';

export function configuredAppOrigin(): string {
  const configured = appOrigin.value();
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    return configured === PRODUCTION_APP_ORIGIN ? 'http://localhost:4321' : configured;
  }
  return configured;
}
