import assert from 'node:assert/strict';
import test from 'node:test';
import {
  JoinError,
  SOCIAL_URL_MAX_LENGTH,
  validateJoinForm,
  type JoinFormValues,
} from '../src/platform/firebase/join-validation.ts';

const validValues: JoinFormValues = {
  displayName: 'Octo Contributor',
  email: 'private@example.test',
  socialUrl: '',
  rulesAcknowledged: true,
};

function validate(overrides: Partial<JoinFormValues> = {}) {
  return validateJoinForm({ ...validValues, ...overrides });
}

for (const [description, displayName] of [
  ['empty', ''],
  ['whitespace-only', '   \t  '],
] as const) {
  test(`${description} display name is rejected`, () => {
    assert.throws(() => validate({ displayName }), JoinError);
  });
}

test('display name is required at the validation boundary', () => {
  assert.throws(
    () => validateJoinForm({ ...validValues, displayName: undefined as unknown as string }),
    JoinError,
  );
});

test('valid display name is trimmed', () => {
  assert.equal(validate({ displayName: '  Octo Contributor  ' }).displayName, 'Octo Contributor');
});

test('over-limit display name is rejected after trimming', () => {
  assert.throws(() => validate({ displayName: 'x'.repeat(51) }), JoinError);
});

test('blank social link is accepted and omitted', () => {
  assert.equal(validate({ socialUrl: '   ' }).socialUrl, undefined);
});

test('full HTTPS social link is accepted', () => {
  assert.equal(
    validate({ socialUrl: 'https://instagram.com/yourname' }).socialUrl,
    'https://instagram.com/yourname',
  );
});

test('bare hostname and path are normalized to HTTPS', () => {
  assert.equal(
    validate({ socialUrl: 'instagram.com/yourname' }).socialUrl,
    'https://instagram.com/yourname',
  );
});

for (const [description, socialUrl] of [
  ['javascript URL', 'javascript:alert(1)'],
  ['FTP URL', 'ftp://example.com/test'],
  ['plain text', 'jeffsando'],
  ['text containing spaces', 'hello world'],
  ['relative path', '/profile'],
  ['credentials in URL', 'https://user:password@example.com/profile'],
] as const) {
  test(`${description} is rejected`, () => {
    assert.throws(() => validate({ socialUrl }), JoinError);
  });
}

test('over-limit normalized social link is rejected', () => {
  const socialUrl = `https://example.com/${'x'.repeat(SOCIAL_URL_MAX_LENGTH)}`;
  assert.throws(() => validate({ socialUrl }), JoinError);
});
