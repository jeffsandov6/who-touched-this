export const SUPPORTED_PULL_REQUEST_ACTIONS = ['opened', 'ready_for_review'] as const;
export type SupportedPullRequestAction = (typeof SUPPORTED_PULL_REQUEST_ACTIONS)[number];

export interface CanonicalRepositoryConfig {
  repository: string;
  baseBranch: string;
}

export interface QualifiedPullRequest {
  action: SupportedPullRequestAction;
  repository: string;
  authorGitHubUserId: string;
  prNumber: number;
  prUrl: string;
}

export type PullRequestQualification =
  | { kind: 'qualified'; pullRequest: QualifiedPullRequest }
  | { kind: 'ignored'; code: string; repository: string; action: string };

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function normalizeRepository(value: string): string {
  const repository = value.trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('Canonical GitHub repository configuration is invalid.');
  }
  return repository;
}

function normalizeBaseBranch(value: string): string {
  const branch = value.trim();
  if (!branch || branch.length > 255 || /\s|\.\.|^\/|\/$/.test(branch)) {
    throw new Error('Canonical GitHub base branch configuration is invalid.');
  }
  return branch;
}

function canonicalPullRequestUrl(repository: string, number: number): string {
  return `https://github.com/${repository}/pull/${number}`;
}

function validPayloadPullRequestUrl(value: unknown, repository: string, number: number): boolean {
  if (typeof value !== 'string' || value.length > 500) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.toLowerCase() === 'github.com'
      && !url.username && !url.password && !url.search && !url.hash
      && url.pathname.replace(/\/$/, '').toLowerCase()
        === `/${repository}/pull/${number}`.toLowerCase();
  } catch {
    return false;
  }
}

export function qualifyPullRequestPayload(
  payload: unknown,
  config: CanonicalRepositoryConfig,
): PullRequestQualification {
  const root = object(payload);
  const action = typeof root?.action === 'string' ? root.action : '';
  const repositoryNode = object(root?.repository);
  const payloadRepository = typeof repositoryNode?.full_name === 'string'
    ? repositoryNode.full_name
    : '';
  const repository = normalizeRepository(config.repository);
  const baseBranch = normalizeBaseBranch(config.baseBranch);
  if (!root || !action || !payloadRepository) {
    return { kind: 'ignored', code: 'malformed_payload', repository: payloadRepository, action };
  }
  if (!SUPPORTED_PULL_REQUEST_ACTIONS.includes(action as SupportedPullRequestAction)) {
    return { kind: 'ignored', code: 'unsupported_action', repository: payloadRepository, action };
  }
  if (payloadRepository.toLowerCase() !== repository.toLowerCase()) {
    return { kind: 'ignored', code: 'wrong_repository', repository: payloadRepository, action };
  }
  const pullRequest = object(root.pull_request);
  const base = object(pullRequest?.base);
  const baseRepository = object(base?.repo);
  if (typeof baseRepository?.full_name !== 'string'
    || baseRepository.full_name.toLowerCase() !== repository.toLowerCase()) {
    return { kind: 'ignored', code: 'wrong_base_repository', repository: payloadRepository, action };
  }
  if (base?.ref !== baseBranch) {
    return { kind: 'ignored', code: 'wrong_base_branch', repository: payloadRepository, action };
  }
  if (typeof pullRequest?.draft !== 'boolean') {
    return { kind: 'ignored', code: 'malformed_payload', repository: payloadRepository, action };
  }
  if (action === 'opened' && pullRequest.draft === true) {
    return { kind: 'ignored', code: 'draft_opened', repository: payloadRepository, action };
  }
  if (action === 'ready_for_review' && pullRequest.draft !== false) {
    return { kind: 'ignored', code: 'not_ready', repository: payloadRepository, action };
  }
  const number = pullRequest?.number;
  const author = object(pullRequest?.user);
  const authorId = author?.id;
  if (!Number.isSafeInteger(number) || (number as number) < 1
    || !Number.isSafeInteger(authorId) || (authorId as number) < 1) {
    return { kind: 'ignored', code: 'invalid_pr_identity', repository: payloadRepository, action };
  }
  if (!validPayloadPullRequestUrl(pullRequest?.html_url, repository, number as number)) {
    return { kind: 'ignored', code: 'invalid_pr_url', repository: payloadRepository, action };
  }
  return {
    kind: 'qualified',
    pullRequest: {
      action: action as SupportedPullRequestAction,
      repository,
      authorGitHubUserId: String(authorId),
      prNumber: number as number,
      prUrl: canonicalPullRequestUrl(repository, number as number),
    },
  };
}
