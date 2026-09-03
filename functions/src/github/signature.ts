import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_PATTERN = /^sha256=([a-f0-9]{64})$/;

export function createGitHubSignature(rawBody: Uint8Array, secret: string): string {
  if (!secret) throw new Error('GitHub webhook secret is unavailable.');
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

export function verifyGitHubSignature(
  rawBody: Uint8Array,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!secret || !signatureHeader || !SIGNATURE_PATTERN.test(signatureHeader)) return false;
  const expected = Buffer.from(createGitHubSignature(rawBody, secret));
  const received = Buffer.from(signatureHeader);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
