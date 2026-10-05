const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export class FounderContactRepairError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FounderContactRepairError';
  }
}

export function prepareFounderContactRepair(
  contribution: Record<string, unknown> | null,
  admin: Record<string, unknown> | null,
  rawEmail: unknown,
  updatedAt: unknown,
): { githubUserId: string; fields: Record<string, unknown> } {
  if (!contribution || contribution.number !== 0
    || contribution.contributionKind !== 'founder_seed'
    || typeof contribution.githubUserId !== 'string'
    || !/^[0-9]+$/.test(contribution.githubUserId)) {
    throw new FounderContactRepairError('Contribution #000 is missing or is not a valid Founder seed.');
  }
  const githubUserId = contribution.githubUserId;
  if (!admin || admin.githubUserId !== githubUserId
    || admin.role !== 'owner' || admin.active !== true) {
    throw new FounderContactRepairError('Contribution #000 does not match an active owner admin.');
  }
  const email = typeof rawEmail === 'string' ? rawEmail.trim() : '';
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new FounderContactRepairError('Founder completion email is invalid.');
  }
  return {
    githubUserId,
    fields: {
      founderCompletionEmail: email,
      founderCompletionEmailUpdatedAt: updatedAt,
    },
  };
}
