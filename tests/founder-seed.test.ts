import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  founderPullRequestUrl,
  founderSnapshotCommand,
  validateFounderSeedForm,
} from '../src/platform/founder-seed.ts';
import { calculateTargetContributionNumber } from '../src/platform/turn-state.ts';
import { calculateMergedCounters } from '../src/platform/contribution-validation.ts';
import { parseHistoryEvent, parsePublicContribution } from '../src/platform/history.ts';

const before = 'a'.repeat(40);
const after = 'b'.repeat(40);
const timestamp = { toDate: () => new Date('2026-01-01T00:00:00Z') };

test('founder form validation trims public data and normalizes full SHAs', () => {
  assert.deepEqual(validateFounderSeedForm({
    publicDisplayName: ' Founder ', prNumber: '27', summary: ' Initial creative seed ',
    contributorMessage: ' Hello ', beforeGitSha: before.toUpperCase(), afterGitSha: after.toUpperCase(),
  }), {
    publicDisplayName: 'Founder', prNumber: 27, summary: 'Initial creative seed',
    contributorMessage: 'Hello', beforeGitSha: before, afterGitSha: after,
  });
  for (const invalid of [
    { publicDisplayName: '', prNumber: '27', summary: 'x', contributorMessage: '', beforeGitSha: before, afterGitSha: after },
    { publicDisplayName: 'Founder', prNumber: '0', summary: 'x', contributorMessage: '', beforeGitSha: before, afterGitSha: after },
    { publicDisplayName: 'Founder', prNumber: '27', summary: '', contributorMessage: '', beforeGitSha: before, afterGitSha: after },
    { publicDisplayName: 'Founder', prNumber: '27', summary: 'x', contributorMessage: '', beforeGitSha: before, afterGitSha: before },
  ]) assert.throws(() => validateFounderSeedForm(invalid));
});

test('founder PR and snapshot commands are canonical and contribution number remains independent', () => {
  assert.equal(founderPullRequestUrl(27), 'https://github.com/JeffSandov6/who-touched-this/pull/27');
  const command = founderSnapshotCommand(before, after);
  assert.match(command, /--contribution 0/);
  assert.match(command, new RegExp(`--before ${before}`));
  assert.match(command, new RegExp(`--after ${after}`));
});

test('public parsers accept a founder seed and distinguish it from default community records', () => {
  const contribution = parsePublicContribution({
    number: 0, season: 1, contributionKind: 'founder_seed', githubUserId: '9001', displayName: 'Founder',
    githubUsername: 'JeffSandov6', summary: 'Initial creative seed', contributorMessage: 'Hello',
    prNumber: 27, prUrl: 'https://github.com/JeffSandov6/who-touched-this/pull/27',
    beforeGitSha: before, afterGitSha: after, mergedAt: timestamp, createdAt: timestamp,
  });
  const event = parseHistoryEvent('founder_seed_000', {
    type: 'contribution', contributionKind: 'founder_seed', season: 1, displayName: 'Founder',
    githubUsername: 'JeffSandov6', targetContributionNumber: 0, contributionNumber: 0, occurredAt: timestamp,
  });
  const community = parsePublicContribution({
    number: 1, season: 1, displayName: 'Alice', githubUsername: 'alice', summary: 'Next',
    prNumber: 28, prUrl: 'https://github.com/JeffSandov6/who-touched-this/pull/28',
    mergedAt: timestamp, createdAt: timestamp,
  });
  assert.equal(contribution?.contributionKind, 'founder_seed');
  assert.equal(event?.type === 'contribution' ? event.contributionKind : null, 'founder_seed');
  assert.equal(community?.contributionKind, 'community');
});

test('malformed founder public data fails closed', () => {
  const base = {
    number: 0, season: 1, contributionKind: 'founder_seed', displayName: 'Founder',
    githubUsername: 'JeffSandov6', summary: 'Seed', prNumber: 27,
    prUrl: 'https://github.com/JeffSandov6/who-touched-this/pull/27',
    beforeGitSha: before, afterGitSha: after, mergedAt: timestamp, createdAt: timestamp,
  };
  assert.equal(parsePublicContribution({ ...base, afterGitSha: before }), null);
  assert.equal(parsePublicContribution({ ...base, prUrl: 'https://github.com/other/repo/pull/27' }), null);
  assert.equal(parseHistoryEvent('founder', { type: 'contribution', season: 1, displayName: 'Founder', githubUsername: 'JeffSandov6', targetContributionNumber: 0, contributionNumber: 0, occurredAt: timestamp }), null);
});

test('founder bootstrap leaves version zero and makes community target and merge become #001', () => {
  const afterFounder = { currentVersion: 0, totalContributions: 1 };
  const target = calculateTargetContributionNumber(afterFounder.currentVersion);
  assert.equal(target, 1);
  assert.deepEqual(calculateMergedCounters(afterFounder.currentVersion, afterFounder.totalContributions, target), {
    currentVersion: 1, totalContributions: 2,
  });
});

test('Admin founder UI is owner-gated, confirms once, then presents immutable record and command', async () => {
  const source = await readFile(new URL('../src/platform/components/AdminFounderSeed.tsx', import.meta.url), 'utf8');
  assert.match(source, /isOwner/);
  assert.match(source, /window\.confirm/);
  assert.match(source, /already merged creative founder pr/);
  assert.match(source, /recorded \?/);
  assert.match(source, /readOnly/);
  assert.match(source, /founderSnapshotCommand/);
  assert.doesNotMatch(source, />Delete</);
  assert.doesNotMatch(source, />Edit</);
});

test('History gives founder seed distinct contribution wording without a founder turn', async () => {
  const source = await readFile(new URL('../src/platform/components/HistoryContributionRecord.tsx', import.meta.url), 'utf8');
  assert.match(source, /founder contribution/);
  assert.match(source, /history-founder-badge/);
  assert.doesNotMatch(source, /Founder Turn/);
});
