import { createReviewHandoffFromPullRequestEvent, validateReviewHandoff } from './handoff.mjs';

export const TRUSTED_REVIEW_CHECK_NAME = 'Trusted contributor review';
const JOB_RESULTS = new Set(['success', 'failure', 'cancelled', 'skipped']);

function validateJobResults(results) {
  const expectedKeys = ['build', 'handoff', 'preview'];
  if (!results || typeof results !== 'object' || Array.isArray(results)
    || JSON.stringify(Object.keys(results).sort()) !== JSON.stringify(expectedKeys)
    || expectedKeys.some((key) => !JOB_RESULTS.has(results[key]))) {
    throw new Error('Trusted contributor review job results are malformed.');
  }
  if (results.handoff !== 'success') throw new Error('A validated trusted handoff is required before reporting.');
  return { ...results };
}

export function reviewConclusion(results, identityMatches = true) {
  const validated = validateJobResults(results);
  if (!identityMatches) return 'failure';
  if (validated.build === 'success' && validated.preview === 'success') return 'success';
  if (validated.build === 'cancelled' || validated.preview === 'cancelled') return 'cancelled';
  return 'failure';
}

function validateDetailsUrl(value, repository) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Trusted review details URL is malformed.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com'
    || url.username || url.password || url.search || url.hash
    || !new RegExp(`^/${repository.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/actions/runs/[1-9][0-9]*$`, 'i').test(url.pathname)) {
    throw new Error('Trusted review details URL is not the expected GitHub Actions run.');
  }
  return url.toString();
}

async function githubJson({ request, url, token, operation, method = 'GET', body }) {
  let response;
  try {
    response = await request(url, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'who-touched-this-trusted-review-status',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch { throw new Error(`${operation} request failed.`); }
  if (!response?.ok) throw new Error(`${operation} failed with HTTP ${Number.isInteger(response?.status) ? response.status : 'unknown'}.`);
  try { return await response.json(); } catch { throw new Error(`${operation} returned malformed JSON.`); }
}

function apiRepository(repository) {
  return repository.split('/').map(encodeURIComponent).join('/');
}

export async function reportTrustedContributorReview({
  handoff,
  jobResults,
  token,
  apiUrl = 'https://api.github.com',
  detailsUrl,
  request = fetch,
}) {
  const identity = validateReviewHandoff(handoff);
  const results = validateJobResults(jobResults);
  if (!token) throw new Error('A checks-write GitHub token is required to report trusted review status.');
  const safeDetailsUrl = validateDetailsUrl(detailsUrl, identity.baseRepository);
  const repository = apiRepository(identity.baseRepository);
  let identityMatches = false;
  let identitySummary = 'The pull request identity could not be revalidated; success was withheld.';

  try {
    const pull = await githubJson({
      request,
      url: `${apiUrl}/repos/${repository}/pulls/${identity.pullRequestNumber}`,
      token,
      operation: 'Trusted review pull request revalidation',
    });
    if (pull?.state === 'open') {
      const current = createReviewHandoffFromPullRequestEvent({
        pull_request: pull,
        repository: { full_name: identity.baseRepository },
      });
      identityMatches = JSON.stringify(current) === JSON.stringify(identity);
      identitySummary = identityMatches
        ? 'The open pull request still matches the exact reviewed base and head revisions.'
        : 'The pull request revisions changed after this review began; a fresh review is required.';
    } else {
      identitySummary = 'The pull request closed before status reporting; success was withheld.';
    }
  } catch (error) {
    identitySummary = `${error.message} Success was withheld.`;
  }

  const conclusion = reviewConclusion(results, identityMatches);
  const payload = {
    name: TRUSTED_REVIEW_CHECK_NAME,
    head_sha: identity.headSha,
    status: 'completed',
    conclusion,
    details_url: safeDetailsUrl,
    external_id: `trusted-contributor-review:${identity.pullRequestNumber}:${identity.headSha}`,
    output: {
      title: conclusion === 'success' ? 'Trusted contributor review passed' : 'Trusted contributor review did not pass',
      summary: [
        identitySummary,
        `Handoff: ${results.handoff}; sandboxed build: ${results.build}; visual preview: ${results.preview}.`,
        `Reviewed head: ${identity.headSha}.`,
      ].join('\n'),
    },
  };
  await githubJson({
    request,
    url: `${apiUrl}/repos/${repository}/check-runs`,
    token,
    operation: 'Trusted contributor review check creation',
    method: 'POST',
    body: payload,
  });
  return { conclusion, identityMatches, payload };
}
