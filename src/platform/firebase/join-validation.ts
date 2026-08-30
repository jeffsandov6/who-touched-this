export const DISPLAY_NAME_MAX_LENGTH = 50;
export const EMAIL_MAX_LENGTH = 254;
export const SOCIAL_URL_MAX_LENGTH = 2048;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EXPLICIT_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const PLAUSIBLE_HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

export interface JoinFormValues {
  displayName: string;
  email: string;
  socialUrl: string;
  rulesAcknowledged: boolean;
}

export interface ValidatedJoinFormValues {
  displayName: string;
  email: string;
  socialUrl?: string;
}

export class JoinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JoinError';
  }
}

export function normalizeSocialUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const candidate = EXPLICIT_SCHEME_PATTERN.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(candidate);
  } catch {
    throw new JoinError('Enter a valid social link, such as https://instagram.com/yourname.');
  }

  if (
    (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') ||
    !PLAUSIBLE_HOSTNAME_PATTERN.test(parsedUrl.hostname) ||
    parsedUrl.username ||
    parsedUrl.password
  ) {
    throw new JoinError(
      'Social link must use http or https, include a valid hostname, and contain no credentials.',
    );
  }

  const normalized = parsedUrl.toString();
  if (normalized.length > SOCIAL_URL_MAX_LENGTH) {
    throw new JoinError(`Social link must be ${SOCIAL_URL_MAX_LENGTH} characters or fewer.`);
  }

  return normalized;
}

export function validateJoinForm(values: JoinFormValues): ValidatedJoinFormValues {
  const displayName = typeof values.displayName === 'string' ? values.displayName.trim() : '';
  const email = typeof values.email === 'string' ? values.email.trim() : '';

  if (!displayName) {
    throw new JoinError('Display name or nickname is required.');
  }
  if (displayName.length > DISPLAY_NAME_MAX_LENGTH) {
    throw new JoinError(
      `Display name or nickname must be ${DISPLAY_NAME_MAX_LENGTH} characters or fewer.`,
    );
  }

  if (!email || email.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw new JoinError('Enter a valid contact email address.');
  }

  const socialUrl = normalizeSocialUrl(
    typeof values.socialUrl === 'string' ? values.socialUrl : '',
  );

  if (!values.rulesAcknowledged) {
    throw new JoinError('You must acknowledge the contribution rules before joining.');
  }

  return {
    displayName,
    email,
    ...(socialUrl ? { socialUrl } : {}),
  };
}
