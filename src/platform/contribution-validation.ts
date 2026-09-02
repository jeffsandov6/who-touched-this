export const CONTRIBUTION_SUMMARY_MAX_LENGTH = 160;
export const CONTRIBUTOR_MESSAGE_MAX_LENGTH = 280;

export interface ValidatedContributionDetails {
  summary: string;
  contributorMessage?: string;
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
    throw new ContributionValidationError('Enter a contribution summary.');
  }
  if (summary.length > CONTRIBUTION_SUMMARY_MAX_LENGTH) {
    throw new ContributionValidationError(
      `Contribution summary must be ${CONTRIBUTION_SUMMARY_MAX_LENGTH} characters or fewer.`,
    );
  }

  const contributorMessage = contributorMessageInput.trim();
  if (contributorMessage.length > CONTRIBUTOR_MESSAGE_MAX_LENGTH) {
    throw new ContributionValidationError(
      `Contributor message must be ${CONTRIBUTOR_MESSAGE_MAX_LENGTH} characters or fewer.`,
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
    throw new ContributionValidationError('Contribution numbering is inconsistent.');
  }

  return {
    currentVersion: targetContributionNumber,
    totalContributions: totalContributions + 1,
  };
}
