export const CONTRIBUTION_SUMMARY_MAX_LENGTH = 160;
export const CONTRIBUTOR_MESSAGE_MAX_LENGTH = 280;
export const CONTRIBUTION_GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

export interface ValidatedContributionDetails {
  summary: string;
  contributorMessage?: string;
}

export function validateContributionGitProvenance(beforeInput: string, afterInput: string): {
  beforeGitSha: string;
  afterGitSha: string;
} {
  const beforeGitSha = beforeInput.trim().toLowerCase();
  const afterGitSha = afterInput.trim().toLowerCase();
  if (!CONTRIBUTION_GIT_SHA_PATTERN.test(beforeGitSha)) {
    throw new ContributionValidationError('before SHA must be the full 40-character commit SHA.');
  }
  if (!CONTRIBUTION_GIT_SHA_PATTERN.test(afterGitSha)) {
    throw new ContributionValidationError('after SHA must be the full 40-character commit SHA.');
  }
  if (beforeGitSha === afterGitSha) {
    throw new ContributionValidationError('before & after SHAs must be different.');
  }
  return { beforeGitSha, afterGitSha };
}

export class ContributionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContributionValidationError';
  }
}

export function validateContributionDetails(
  summaryInput: string,
  contributorMessageInput: string,
): ValidatedContributionDetails {
  const summary = summaryInput.trim();
  if (!summary) {
    throw new ContributionValidationError('enter a contribution summary.');
  }
  if (summary.length > CONTRIBUTION_SUMMARY_MAX_LENGTH) {
    throw new ContributionValidationError(
      `contribution summary must be ${CONTRIBUTION_SUMMARY_MAX_LENGTH} characters or fewer.`,
    );
  }

  const contributorMessage = contributorMessageInput.trim();
  if (contributorMessage.length > CONTRIBUTOR_MESSAGE_MAX_LENGTH) {
    throw new ContributionValidationError(
      `contributor message must be ${CONTRIBUTOR_MESSAGE_MAX_LENGTH} characters or fewer.`,
    );
  }

  return {
    summary,
    ...(contributorMessage ? { contributorMessage } : {}),
  };
}

export function calculateMergedCounters(
  currentVersion: number,
  totalContributions: number,
  targetContributionNumber: number,
): { currentVersion: number; totalContributions: number } {
  if (
    !Number.isSafeInteger(currentVersion) ||
    currentVersion < 0 ||
    !Number.isSafeInteger(totalContributions) ||
    totalContributions < 0 ||
    !Number.isSafeInteger(targetContributionNumber) ||
    targetContributionNumber !== currentVersion + 1
  ) {
    throw new ContributionValidationError('contribution numbering is inconsistent.');
  }

  return {
    currentVersion: targetContributionNumber,
    totalContributions: totalContributions + 1,
  };
}
