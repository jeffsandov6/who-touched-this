import {
  CONTRIBUTION_SUMMARY_MAX_LENGTH,
  CONTRIBUTOR_MESSAGE_MAX_LENGTH,
  validateContributionDetails,
} from './contribution-validation.ts';

export const FOUNDER_DISPLAY_NAME_MAX_LENGTH = 50;
export const FOUNDER_CONTRIBUTION_NUMBER = 0;
export const FOUNDER_GITHUB_REPOSITORY = 'JeffSandov6/who-touched-this';
const GIT_SHA = /^[0-9a-f]{40}$/;

export interface FounderSeedFormInput {
  publicDisplayName: string;
  prNumber: string;
  summary: string;
  contributorMessage: string;
  beforeGitSha: string;
  afterGitSha: string;
}

export interface FounderSeedRequest {
  publicDisplayName: string;
  prNumber: number;
  summary: string;
  contributorMessage?: string;
  beforeGitSha: string;
  afterGitSha: string;
}

export function validateFounderSeedForm(input: FounderSeedFormInput): FounderSeedRequest {
  const publicDisplayName = input.publicDisplayName.trim();
  if (!publicDisplayName || publicDisplayName.length > FOUNDER_DISPLAY_NAME_MAX_LENGTH) {
    throw new Error(`public founder name must be 1–${FOUNDER_DISPLAY_NAME_MAX_LENGTH} characters.`);
  }
  const number = Number(input.prNumber.trim());
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('enter a positive GitHub pull request number.');
  const details = validateContributionDetails(input.summary, input.contributorMessage);
  const beforeGitSha = input.beforeGitSha.trim().toLowerCase();
  const afterGitSha = input.afterGitSha.trim().toLowerCase();
  if (!GIT_SHA.test(beforeGitSha) || !GIT_SHA.test(afterGitSha) || beforeGitSha === afterGitSha) {
    throw new Error('enter two different full 40-character git commit shas.');
  }
  return {
    publicDisplayName,
    prNumber: number,
    summary: details.summary,
    ...(details.contributorMessage ? { contributorMessage: details.contributorMessage } : {}),
    beforeGitSha,
    afterGitSha,
  };
}

export function founderPullRequestUrl(prNumber: number): string {
  if (!Number.isSafeInteger(prNumber) || prNumber < 1) throw new Error('pull request number is invalid.');
  return `https://github.com/${FOUNDER_GITHUB_REPOSITORY}/pull/${prNumber}`;
}

export function founderSnapshotCommand(beforeGitSha: string, afterGitSha: string): string {
  if (!GIT_SHA.test(beforeGitSha) || !GIT_SHA.test(afterGitSha) || beforeGitSha === afterGitSha) {
    throw new Error('founder git provenance is invalid.');
  }
  return [
    'npm run snapshots:capture -- \\',
    '  --contribution 0 \\',
    `  --before ${beforeGitSha} \\`,
    `  --after ${afterGitSha}`,
  ].join('\n');
}

export { CONTRIBUTION_SUMMARY_MAX_LENGTH, CONTRIBUTOR_MESSAGE_MAX_LENGTH };
