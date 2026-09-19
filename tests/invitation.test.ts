import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_TURN_DURATION_HOURS,
  calculateTurnDueAtMillis,
  canExpireInvitation,
  formatTurnDuration,
  validateInvitationDeadline,
  validateTurnDurationHours,
} from '../src/platform/invitation.ts';
import { participationStatusMessage } from '../src/platform/join-status.ts';

test('default active turn duration is 72 hours', () => {
  assert.equal(DEFAULT_TURN_DURATION_HOURS, 72);
  assert.equal(formatTurnDuration(DEFAULT_TURN_DURATION_HOURS), '3 days');
});

test('invitation deadlines must be future and reasonably bounded', () => {
  const now = 1_000_000;
  assert.equal(validateInvitationDeadline(new Date(now + 60_000), now).getTime(), now + 60_000);
  assert.throws(() => validateInvitationDeadline(new Date(now), now));
  assert.throws(() => validateInvitationDeadline(new Date(now + 169 * 3_600_000), now));
});

test('turn duration is a bounded whole-hour value', () => {
  assert.equal(validateTurnDurationHours(168), 168);
  for (const invalid of [0, 1.5, 721, Number.NaN]) {
    assert.throws(() => validateTurnDurationHours(invalid));
  }
  assert.equal(formatTurnDuration(168), '7 days');
  assert.equal(formatTurnDuration(1), '1 hour');
});

test('turn deadline starts at acceptance', () => {
  const acceptedAt = 1_000_000;
  assert.equal(calculateTurnDueAtMillis(acceptedAt, 24), acceptedAt + 86_400_000);
});

test('invitation expiration becomes available exactly at the deadline', () => {
  assert.equal(canExpireInvitation('pending', 1000, 999), false);
  assert.equal(canExpireInvitation('pending', 1000, 1000), true);
  assert.equal(canExpireInvitation('accepted', 1000, 2000), false);
});

test('join presentation distinguishes invited and invitation-expired participation', () => {
  assert.equal(participationStatusMessage('invited'), 'you have a pending invitation.');
  assert.equal(
    participationStatusMessage('invitation_expired'),
    'your invitation expired before it was accepted.',
  );
});

test('waiting participation keeps position private and explains turn notification', () => {
  assert.equal(
    participationStatusMessage('waiting'),
    "you're in the queue. wait for your invitation; your exact position is private. we'll email you when it's your turn.",
  );
});
