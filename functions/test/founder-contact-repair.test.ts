import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  FounderContactRepairError,
  prepareFounderContactRepair,
} from '../src/founder/repair-contact.js';

const contribution = { number: 0, contributionKind: 'founder_seed', githubUserId: '9001' };
const admin = { githubUserId: '9001', role: 'owner', active: true };

test('Founder contact repair returns only the two intended private fields', () => {
  const updatedAt = { timestamp: true };
  assert.deepEqual(prepareFounderContactRepair(
    contribution, admin, ' founder@example.test ', updatedAt,
  ), {
    githubUserId: '9001',
    fields: {
      founderCompletionEmail: 'founder@example.test',
      founderCompletionEmailUpdatedAt: updatedAt,
    },
  });
});

test('Founder contact repair rejects malformed contribution, mismatched owner, and invalid email', () => {
  for (const [candidateContribution, candidateAdmin, email] of [
    [null, admin, 'founder@example.test'],
    [{ ...contribution, contributionKind: 'community' }, admin, 'founder@example.test'],
    [contribution, { ...admin, githubUserId: '42' }, 'founder@example.test'],
    [contribution, { ...admin, active: false }, 'founder@example.test'],
    [contribution, admin, 'invalid'],
  ] as const) {
    assert.throws(
      () => prepareFounderContactRepair(candidateContribution, candidateAdmin, email, {}),
      FounderContactRepairError,
    );
  }
});

test('Founder contact repair script cannot resend or modify delivery records', async () => {
  const source = await readFile(
    new URL('../../scripts/repair-founder-completion-contact.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /emailDeliveries|resendContribution|sendFounder|sendEmail/);
  assert.match(source, /EXPECTED_PROJECT_ID = 'who-touched-this'/);
  assert.match(source, /\.update\(repair\.fields\)/);
  assert.match(source, /--apply/);
  assert.match(source, /confirm-project/);
});
