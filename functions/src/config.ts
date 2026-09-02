import { defineSecret, defineString } from 'firebase-functions/params';

export const resendApiKey = defineSecret('RESEND_API_KEY');
export const appOrigin = defineString('APP_ORIGIN', {
  default: 'https://whotouchedthis.website',
  description: 'Canonical public application origin used in transactional email links.',
});
export const emailProviderMode = defineString('EMAIL_PROVIDER_MODE', {
  default: 'resend',
  description: 'Production uses resend. The emulator forces local unless set to failure.',
});

const PRODUCTION_APP_ORIGIN = 'https://whotouchedthis.website';

export function configuredAppOrigin(): string {
  const configured = appOrigin.value();
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    return configured === PRODUCTION_APP_ORIGIN ? 'http://localhost:4321' : configured;
  }
  return configured;
}
