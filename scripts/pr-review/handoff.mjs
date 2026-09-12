import { readFile, writeFile } from 'node:fs/promises';

export const REVIEW_HANDOFF_SCHEMA_VERSION = 1;
const SHA = /^[0-9a-f]{40}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function validateRepository(value, label) {
  if (typeof value !== 'string' || !REPOSITORY.test(value)) throw new Error(`${label} is malformed.`);
  return value;
}

export function validateReviewHandoff(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Trusted review handoff is malformed.');
  const expectedKeys = ['baseRepository', 'baseSha', 'headRepository', 'headSha', 'pullRequestNumber', 'schemaVersion'];
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys)) throw new Error('Trusted review handoff has unexpected or missing fields.');
  if (value.schemaVersion !== REVIEW_HANDOFF_SCHEMA_VERSION) throw new Error('Trusted review handoff schema is unsupported.');
  if (!Number.isSafeInteger(value.pullRequestNumber) || value.pullRequestNumber < 1) throw new Error('Trusted review handoff pull request number is invalid.');
  validateRepository(value.baseRepository, 'Trusted review handoff base repository');
  validateRepository(value.headRepository, 'Trusted review handoff head repository');
  if (!SHA.test(value.baseSha ?? '') || !SHA.test(value.headSha ?? '')) throw new Error('Trusted review handoff revisions must be full lowercase Git SHAs.');
  if (value.baseSha === value.headSha) throw new Error('Trusted review handoff revisions must differ.');
  return Object.freeze({ ...value });
}

export function createReviewHandoffFromPullRequestEvent(event) {
  if (event?.action && !['opened', 'synchronize', 'reopened', 'ready_for_review'].includes(event.action)) {
    throw new Error('Unsupported pull request action for review handoff.');
  }
  return validateReviewHandoff({
    schemaVersion: REVIEW_HANDOFF_SCHEMA_VERSION,
    pullRequestNumber: event?.pull_request?.number ?? event?.number,
    baseRepository: event?.pull_request?.base?.repo?.full_name ?? event?.repository?.full_name,
    baseSha: event?.pull_request?.base?.sha,
    headRepository: event?.pull_request?.head?.repo?.full_name,
    headSha: event?.pull_request?.head?.sha,
  });
}

export async function readReviewHandoff(path) {
  let parsed;
  try { parsed = JSON.parse(await readFile(path, 'utf8')); }
  catch { throw new Error('Trusted review handoff artifact is missing or malformed JSON.'); }
  return validateReviewHandoff(parsed);
}

export async function writeReviewHandoffFromEvent({ eventPath, outputPath }) {
  const event = JSON.parse(await readFile(eventPath, 'utf8'));
  const handoff = createReviewHandoffFromPullRequestEvent(event);
  await writeFile(outputPath, `${JSON.stringify(handoff, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return handoff;
}

async function githubRequest(apiUrl, repository, pullRequestNumber, token, request) {
  let response;
  try {
    response = await request(`${apiUrl}/repos/${repository.split('/').map(encodeURIComponent).join('/')}/pulls/${pullRequestNumber}`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'who-touched-this-trusted-review-handoff',
      },
    });
  } catch { throw new Error('Pull request identity cross-check request failed.'); }
  if (!response?.ok) throw new Error(`Pull request identity cross-check failed with HTTP ${Number.isInteger(response?.status) ? response.status : 'unknown'}.`);
  try { return await response.json(); }
  catch { throw new Error('Pull request identity cross-check returned malformed JSON.'); }
}

export async function verifyReviewHandoff({ handoff, workflowRunEvent, token, apiUrl = 'https://api.github.com', request = fetch }) {
  const validated = validateReviewHandoff(handoff);
  const run = workflowRunEvent?.workflow_run;
  if (run?.name !== 'Contribution boundary' || run?.event !== 'pull_request_target' || run?.conclusion !== 'success') {
    throw new Error('Review orchestration was not triggered by a successful trusted Contribution boundary run.');
  }
  if (!Number.isSafeInteger(run.id) || run.id < 1 || run.repository?.full_name !== validated.baseRepository) {
    throw new Error('Triggering workflow run metadata does not match the trusted handoff.');
  }
  const linkedPulls = Array.isArray(run.pull_requests) ? run.pull_requests : [];
  if (linkedPulls.length > 0 && (linkedPulls.length !== 1 || linkedPulls[0]?.number !== validated.pullRequestNumber)) {
    throw new Error('Triggering workflow run pull request association disagrees with the trusted handoff.');
  }
  if (!token) throw new Error('A read-only GitHub token is required to cross-check the pull request identity.');
  const pull = await githubRequest(apiUrl, validated.baseRepository, validated.pullRequestNumber, token, request);
  if (pull?.state !== 'open') throw new Error('Trusted review handoff is stale because the pull request is no longer open.');
  const current = createReviewHandoffFromPullRequestEvent({ pull_request: pull, repository: { full_name: validated.baseRepository } });
  if (JSON.stringify(current) !== JSON.stringify(validated)) {
    throw new Error('Trusted review handoff is stale or disagrees with current pull request metadata.');
  }
  return validated;
}
