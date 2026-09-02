import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterQueueEntries,
  getEffectiveWaitingQueue,
  sortByEffectiveQueueOrder,
  type QueueSearchable,
} from '../src/platform/firebase/admin-queue-logic.ts';

function entry(
  githubUsername: string,
  joinedAtMillis: number,
  priority = 0,
): QueueSearchable {
  return {
    displayName: `${githubUsername} display`,
    githubUsername,
    email: `${githubUsername}@example.test`,
    status: 'waiting',
    joinedAtMillis,
    priority,
  };
}

test('normal priority-zero entries sort by joinedAt ascending', () => {
  const sorted = sortByEffectiveQueueOrder([entry('later', 200), entry('earlier', 100)]);
  assert.deepEqual(sorted.map(({ githubUsername }) => githubUsername), ['earlier', 'later']);
});

test('a promoted entry appears before normal entries', () => {
  const sorted = sortByEffectiveQueueOrder([entry('normal', 100), entry('promoted', 200, 1)]);
  assert.deepEqual(sorted.map(({ githubUsername }) => githubUsername), ['promoted', 'normal']);
});

test('higher priority appears before lower priority', () => {
  const sorted = sortByEffectiveQueueOrder([entry('lower', 100, 2), entry('higher', 200, 3)]);
  assert.deepEqual(sorted.map(({ githubUsername }) => githubUsername), ['higher', 'lower']);
});

test('equal promoted priority falls back to joinedAt ascending', () => {
  const sorted = sortByEffectiveQueueOrder([entry('later', 200, 4), entry('earlier', 100, 4)]);
  assert.deepEqual(sorted.map(({ githubUsername }) => githubUsername), ['earlier', 'later']);
});

test('restoring priority zero restores chronological order', () => {
  const promoted = entry('originally-later', 200, 5);
  const earlier = entry('earlier', 100);
  assert.equal(sortByEffectiveQueueOrder([earlier, promoted])[0]?.githubUsername, 'originally-later');

  const restored = { ...promoted, priority: 0 };
  assert.deepEqual(
    sortByEffectiveQueueOrder([earlier, restored]).map(({ githubUsername }) => githubUsername),
    ['earlier', 'originally-later'],
  );
});

test('search and status filtering preserve input ordering and do not mutate entries', () => {
  const first = entry('first', 100, 2);
  const second = { ...entry('second', 200), status: 'active' };
  const ordered = sortByEffectiveQueueOrder([second, first]);
  const before = structuredClone(ordered);

  assert.deepEqual(filterQueueEntries(ordered, 'FIRST').map((item) => item.githubUsername), ['first']);
  assert.deepEqual(filterQueueEntries(ordered, '', 'active').map((item) => item.githubUsername), [
    'second',
  ]);
  assert.deepEqual(ordered, before);
});

test('effective waiting queue excludes active entries', () => {
  const active = { ...entry('active-first', 50, 10), status: 'active' };
  const waiting = entry('waiting', 100);
  assert.deepEqual(
    getEffectiveWaitingQueue([active, waiting]).map((item) => item.githubUsername),
    ['waiting'],
  );
});

test('effective waiting queue excludes invited entries', () => {
  const invited = { ...entry('invited-first', 50, 10), status: 'invited' };
  const waiting = entry('waiting', 100);
  assert.deepEqual(
    getEffectiveWaitingQueue([invited, waiting]).map((item) => item.githubUsername),
    ['waiting'],
  );
});
