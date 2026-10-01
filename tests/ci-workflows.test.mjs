import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const boundary = await readFile(new URL('../.github/workflows/contribution-boundary.yml', import.meta.url), 'utf8');
const review = await readFile(new URL('../.github/workflows/contributor-build.yml', import.meta.url), 'utf8');
const maintenance = await readFile(new URL('../.github/workflows/dependabot-maintenance.yml', import.meta.url), 'utf8');
const dependabot = await readFile(new URL('../.github/dependabot.yml', import.meta.url), 'utf8');
const sandboxRunner = await readFile(new URL('../scripts/run-review-sandbox.mjs', import.meta.url), 'utf8');
const preview = await readFile(new URL('../scripts/pr-review/preview.mjs', import.meta.url), 'utf8');
const packageManifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const packageLock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const functionsPackageManifest = JSON.parse(await readFile(new URL('../functions/package.json', import.meta.url), 'utf8'));
const statusReporter = await readFile(new URL('../scripts/report-review-status.mjs', import.meta.url), 'utf8');
const handoff = await readFile(new URL('../scripts/pr-review/handoff.mjs', import.meta.url), 'utf8');
const handoffWriter = await readFile(new URL('../scripts/create-review-handoff.mjs', import.meta.url), 'utf8');
const handoffVerifier = await readFile(new URL('../scripts/verify-review-handoff.mjs', import.meta.url), 'utf8');
const reviewPolicy = await readFile(new URL('../scripts/pr-review/policy.mjs', import.meta.url), 'utf8');
const workflows = `${boundary}\n${review}\n${maintenance}`;

function workflowTrigger(workflow) {
  const match = workflow.match(/^on:\n([\s\S]*?)\npermissions:/m);
  assert.ok(match, 'workflow trigger block should be present before permissions');
  return match[1];
}

function namedStep(workflow, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = workflow.match(new RegExp(`      - name: ${escaped}\\n([\\s\\S]*?)(?=\\n      - name:|$)`));
  assert.ok(match, `workflow step ${name} should exist`);
  return match[1];
}

test('main targeting is enforced by pull_request_target, not a workflow_run branch filter', () => {
  // A pull_request_target run is associated with the contributor branch for workflow_run filtering.
  // Re-filtering it as `main` can suppress review of a valid PR; the trusted boundary already limits
  // the pull request base to main.
  assert.match(workflowTrigger(boundary), /pull_request_target:\n    branches: \[main\]/);
  assert.doesNotMatch(workflowTrigger(review), /branches:/);
});

test('trusted boundary policy comes from the default branch while PR SHAs remain metadata', () => {
  // Pinning the privileged checkout to pull_request.base.sha could execute stale validation policy.
  // The exact base/head identities belong in the validated handoff and later isolated workspaces.
  const checkout = namedStep(boundary, 'Check out trusted base policy');
  assert.doesNotMatch(checkout, /^\s*ref:/m);
  assert.doesNotMatch(checkout, /github\.event\.pull_request\.(?:base\.sha|head)/);
  assert.match(handoff, /baseSha: event\?\.pull_request\?\.base\?\.sha/);
  assert.match(handoff, /headSha: event\?\.pull_request\?\.head\?\.sha/);
});

test('privileged boundary remains base-controlled metadata-only execution', () => {
  const trigger = workflowTrigger(boundary);
  const checkout = namedStep(boundary, 'Check out trusted base policy');
  assert.match(trigger, /pull_request_target:\n    branches: \[main\]/);
  assert.match(
    checkout,
    /uses: actions\/checkout@[0-9a-f]{40}/,
  );
  assert.match(checkout, /persist-credentials: false/);
  assert.doesNotMatch(checkout, /github\.event\.pull_request\.head/);
  assert.doesNotMatch(checkout, /github\.event\.pull_request\.base\.sha/);
  assert.doesNotMatch(checkout, /^\s*ref:/m);
  assert.doesNotMatch(boundary, /head-canvas|pull_request\.head\.repo|npm (?:ci|install|run)|docker|playwright/i);
  assert.doesNotMatch(boundary, /\$\{\{\s*secrets\./);
  assert.match(boundary, /contents: read/);
  assert.match(boundary, /pull-requests: read/);
  assert.ok(boundary.indexOf('Classify trusted pull request metadata') < boundary.indexOf('Validate community contribution metadata'));
  assert.ok(boundary.indexOf('Validate community contribution metadata') < boundary.indexOf('Create trusted review handoff'));
  assert.ok(boundary.indexOf('Create trusted review handoff') < boundary.indexOf('Upload trusted review handoff'));
});

test('Dependabot maintenance is authenticated without titles, labels, or contributor handoffs', () => {
  const classifier = namedStep(boundary, 'Classify trusted pull request metadata');
  assert.match(classifier, /GITHUB_ACTOR: \$\{\{ github\.actor \}\}/);
  assert.match(classifier, /validate-pull-request-mode\.mjs/);
  assert.match(namedStep(boundary, 'Validate community contribution metadata'), /if: steps\.pull-request\.outputs\.mode == 'contribution'/);
  assert.match(namedStep(boundary, 'Create trusted review handoff'), /if: steps\.pull-request\.outputs\.mode == 'contribution'/);
  assert.match(namedStep(boundary, 'Upload trusted review handoff'), /if: steps\.pull-request\.outputs\.mode == 'contribution'/);
  assert.doesNotMatch(boundary, /pull_request\.(?:title|body)|labels/);
  assert.doesNotMatch(maintenance, /trusted-contribution-handoff|create-review-handoff|Trusted contributor review/);
});

test('Dependabot never starts hostile canvas review jobs', () => {
  const validateJob = review.slice(review.indexOf('  validate-handoff:'), review.indexOf('  build-hostile-canvas:'));
  assert.match(validateJob, /github\.event\.workflow_run\.actor\.login != 'dependabot\[bot\]'/);
  assert.match(review, /needs: validate-handoff/);
  assert.match(review, /needs: \[validate-handoff, build-hostile-canvas\]/);
});

test('maintenance validation is unprivileged, exact-revision, and runs actual project checks', () => {
  assert.match(workflowTrigger(maintenance), /pull_request:\n    branches: \[main\]/);
  assert.doesNotMatch(maintenance, /pull_request_target|workflow_run|checks: write|secrets\./);
  assert.match(maintenance, /contents: read/);
  assert.match(maintenance, /pull-requests: read/);
  for (const identity of [
    "github.actor == 'dependabot[bot]'",
    "github.event.sender.login == 'dependabot[bot]'",
    "github.event.pull_request.user.login == 'dependabot[bot]'",
    "github.event.repository.full_name == 'jeffsandov6/who-touched-this'",
    "github.event.pull_request.base.repo.full_name == 'jeffsandov6/who-touched-this'",
    "github.event.pull_request.base.ref == 'main'",
    "github.event.pull_request.head.repo.full_name == 'jeffsandov6/who-touched-this'",
    "startsWith(github.event.pull_request.head.ref, 'dependabot/')",
  ]) assert.ok(maintenance.includes(identity), identity);
  assert.match(maintenance, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(maintenance, /persist-credentials: false/);
  for (const command of [
    'git diff --check', 'npm ci', 'npm --prefix functions ci', 'npm run check', 'npm run build',
    'npm run build:contributor', 'npm run functions:check', 'npm run functions:test',
    'npm run test:contribution-validator', 'npm run test:pr-review', 'npm run test:release',
  ]) assert.ok(maintenance.includes(command), command);
});

test('maintenance installs only lockfile-matched Chromium before Playwright-backed tests', () => {
  const rootInstall = maintenance.indexOf('Install root dependencies exactly');
  const browserInstall = maintenance.indexOf('Install lockfile-matched Playwright Chromium');
  const reviewTests = maintenance.indexOf('npm run test:pr-review');
  assert.ok(rootInstall >= 0 && rootInstall < browserInstall && browserInstall < reviewTests);
  const step = namedStep(maintenance, 'Install lockfile-matched Playwright Chromium');
  assert.match(step, /\.\/node_modules\/\.bin\/playwright install --with-deps chromium/);
  assert.doesNotMatch(step, /playwright@|v\d+\.\d+\.\d+|install (?:firefox|webkit)/);
});

test('Functions lockfile generation is pinned to the supported npm 10 toolchain', () => {
  assert.equal(functionsPackageManifest.engines.node, '22');
  assert.equal(functionsPackageManifest.packageManager, 'npm@10.9.8');
});

test('Dependabot version updates are grouped by ecosystem without grouping security updates', () => {
  assert.equal((dependabot.match(/interval: "weekly"/g) ?? []).length, 3);
  assert.equal((dependabot.match(/open-pull-requests-limit: 5/g) ?? []).length, 3);
  assert.equal((dependabot.match(/applies-to: version-updates/g) ?? []).length, 3);
  assert.match(dependabot, /root-minor-and-patch:[\s\S]*?update-types:[\s\S]*?"minor"[\s\S]*?"patch"/);
  assert.match(dependabot, /root-minor-and-patch:[\s\S]*?exclude-patterns:[\s\S]*?- "playwright"/);
  assert.match(dependabot, /functions-minor-and-patch:[\s\S]*?update-types:[\s\S]*?"minor"[\s\S]*?"patch"/);
  assert.match(dependabot, /routine-actions:[\s\S]*?patterns:[\s\S]*?- "\*"/);
  assert.doesNotMatch(dependabot, /applies-to: security-updates/);
});

test('hostile orchestration comes only from trusted default-branch workflow_run code', () => {
  const trigger = workflowTrigger(review);
  assert.match(trigger, /workflow_run:/);
  assert.match(trigger, /workflows: \[Contribution boundary\]/);
  assert.match(trigger, /types: \[completed\]/);
  assert.doesNotMatch(trigger, /branches:/);
  assert.doesNotMatch(review, /\bpull_request:/);
  assert.doesNotMatch(review, /pull_request_target:/);
  assert.match(review, /workflow_run\.conclusion == 'success'/);
  assert.match(review, /workflow_run\.event == 'pull_request_target'/);
  assert.match(review, /needs: validate-handoff/);
  assert.match(review, /needs: \[validate-handoff, build-hostile-canvas\]/);
});

test('handoff is retrieved only from triggering run and cross-checked before outputs are used', () => {
  assert.match(review, /run-id: \$\{\{ github\.event\.workflow_run\.id \}\}/);
  assert.match(review, /name: trusted-contribution-handoff/);
  assert.match(review, /verify-review-handoff\.mjs/);
  assert.match(review, /actions: read/);
  assert.match(review, /contents: read/);
  assert.match(review, /pull-requests: read/);
  assert.doesNotMatch(review, /(?:write|admin):/);
});

test('exact event base and head SHAs survive the trusted handoff and are revalidated', () => {
  assert.match(handoffWriter, /writeReviewHandoffFromEvent/);
  assert.match(handoff, /baseSha: event\?\.pull_request\?\.base\?\.sha/);
  assert.match(handoff, /headSha: event\?\.pull_request\?\.head\?\.sha/);
  assert.match(handoff, /const current = createReviewHandoffFromPullRequestEvent/);
  assert.match(handoff, /JSON\.stringify\(current\) !== JSON\.stringify\(validated\)/);
  assert.match(handoffVerifier, /base_sha=\$\{handoff\.baseSha\}/);
  assert.match(handoffVerifier, /head_sha=\$\{handoff\.headSha\}/);
  assert.match(review, /ref: \$\{\{ needs\.validate-handoff\.outputs\.base_sha \}\}/);
  assert.match(review, /HEAD_SHA: \$\{\{ needs\.validate-handoff\.outputs\.head_sha \}\}/);
});

test('only sparse PR canvas is materialized and protected files come from exact base', () => {
  assert.match(review, /ref: \$\{\{ needs\.validate-handoff\.outputs\.base_sha \}\}/);
  assert.match(review, /ref: refs\/pull\/\$\{\{ needs\.validate-handoff\.outputs\.pull_request_number \}\}\/head/);
  assert.match(review, /sparse-checkout: \/src\/canvas\//);
  assert.match(review, /sparse-checkout-cone-mode: false/);
  assert.match(review, /Overlay only validated PR-head canvas blobs/);
  assert.match(review, /prepare-pr-review-workspace\.mjs overlay/);
  assert.doesNotMatch(review, /repository: \$\{\{ needs\.validate-handoff\.outputs\.head_repository \}\}/);
});

test('dependency installation uses trusted manifests before hostile overlay', () => {
  const create = review.indexOf('Create workspace from trusted base');
  const install = review.indexOf('Install dependencies from trusted manifests before canvas overlay');
  const overlay = review.indexOf('Overlay only validated PR-head canvas blobs');
  const execute = review.indexOf('Run contributor code in a networkless resource-bounded container');
  assert.ok(create < install && install < overlay && overlay < execute);
  assert.match(review, /cache-dependency-path: \.wtt-ci\/trusted\/package-lock\.json/);
});

test('preview resolves Playwright from lockfile-pinned trusted dependencies mounted read-only', () => {
  const install = namedStep(review, 'Install trusted preview runtime dependencies');
  const capture = namedStep(review, 'Capture BEFORE and PROPOSED AFTER in a networkless browser container');
  const visualJob = review.indexOf('  visual-preview:');
  const trustedCheckout = review.indexOf('Check out exact trusted base', visualJob);
  const trustedInstall = review.indexOf('Install trusted preview runtime dependencies', visualJob);
  const previewCapture = review.indexOf('Capture BEFORE and PROPOSED AFTER', visualJob);
  assert.ok(visualJob >= 0 && trustedCheckout < trustedInstall && trustedInstall < previewCapture);
  assert.match(install, /working-directory: \.wtt-ci\/trusted/);
  assert.match(install, /run: npm ci --ignore-scripts/);
  const playwrightVersion = packageManifest.devDependencies.playwright;
  assert.match(playwrightVersion, /^\d+\.\d+\.\d+$/);
  assert.equal(packageLock.packages[''].devDependencies.playwright, playwrightVersion);
  assert.equal(packageLock.packages['node_modules/playwright'].version, playwrightVersion);
  assert.match(reviewPolicy, new RegExp(`HOSTILE_PLAYWRIGHT_IMAGE = 'mcr\\.microsoft\\.com/playwright:v${playwrightVersion.replaceAll('.', '\\.')}\\-noble@sha256:[0-9a-f]{64}'`));
  assert.match(preview, /from 'playwright'/);
  assert.match(capture, /--trusted \.wtt-ci\/trusted/);
  assert.match(sandboxRunner, /workspaceReadonly: true/);
  assert.match(sandboxRunner, /workspace: trusted/);
});

test('contributor output cannot replace trusted preview code, manifests, dependencies, or mounts', () => {
  const previewPhase = sandboxRunner.slice(sandboxRunner.indexOf("phase === 'preview'"));
  assert.match(review, /ref: \$\{\{ needs\.validate-handoff\.outputs\.base_sha \}\}/);
  assert.doesNotMatch(review, /repository: \$\{\{ needs\.validate-handoff\.outputs\.head_repository \}\}/);
  assert.match(previewPhase, /workspace: trusted/);
  assert.match(previewPhase, /workspaceReadonly: true/);
  assert.match(previewPhase, /source: proposedDist, target: '\/review\/proposed-dist', readonly: true/);
  assert.doesNotMatch(previewPhase, /workspace:\s*proposedDist/);
  assert.doesNotMatch(previewPhase, /node_modules.*(?:proposed|head-canvas)/);
});

test('hostile execution is hosted, secretless, containerized, and never deploys', () => {
  assert.equal((review.match(/runs-on: ubuntu-latest/g) ?? []).length, 4);
  assert.equal((review.match(/persist-credentials: false/g) ?? []).length, 5);
  assert.doesNotMatch(workflows, /\$\{\{\s*secrets\./);
  assert.doesNotMatch(workflows, /self-hosted/);
  assert.doesNotMatch(review, /firebase\s+(?:deploy|emulators)|RESEND|GITHUB_WEBHOOK_SECRET|service.account/i);
  assert.doesNotMatch(review, /\bdeploy\b/i);
  assert.match(review, /run-review-sandbox\.mjs build/);
  assert.match(review, /run-review-sandbox\.mjs preview/);
  assert.match(sandboxRunner, /env: \{ PATH: process\.env\.PATH/);
  assert.doesNotMatch(sandboxRunner, /env:\s*\{\s*\.\.\.process\.env/);
  assert.doesNotMatch(sandboxRunner, /docker\.sock/);
});

test('trusted reporter alone receives narrow check-write permission and never executes contributor code', () => {
  const reporter = review.slice(review.indexOf('  report-review-status:'));
  assert.match(reporter, /name: Publish trusted contributor review status/);
  assert.match(reporter, /needs: \[validate-handoff, build-hostile-canvas, visual-preview\]/);
  assert.match(reporter, /if: \$\{\{ always\(\) && needs\.validate-handoff\.result == 'success' \}\}/);
  assert.match(reporter, /permissions:\n      checks: write\n      contents: read\n      pull-requests: read/);
  assert.equal((review.match(/checks: write/g) ?? []).length, 1);
  assert.doesNotMatch(reporter, /head-canvas|proposed-workspace|npm (?:ci|install|run)|docker|playwright/i);
  assert.match(reporter, /Check out trusted status reporter/);
  assert.match(reporter, /persist-credentials: false/);
  assert.doesNotMatch(namedStep(reporter, 'Check out trusted status reporter'), /^\s*ref:/m);
  assert.match(reporter, /scripts\/report-review-status\.mjs/);
});

test('reporter targets validated outputs and aggregates every required trusted job result', () => {
  const reporter = review.slice(review.indexOf('  report-review-status:'));
  for (const [name, expression] of [
    ['PR_NUMBER', 'needs.validate-handoff.outputs.pull_request_number'],
    ['BASE_SHA', 'needs.validate-handoff.outputs.base_sha'],
    ['HEAD_SHA', 'needs.validate-handoff.outputs.head_sha'],
    ['HANDOFF_RESULT', 'needs.validate-handoff.result'],
    ['BUILD_RESULT', 'needs.build-hostile-canvas.result'],
    ['PREVIEW_RESULT', 'needs.visual-preview.result'],
  ]) assert.ok(reporter.includes(`${name}: \${{ ${expression} }}`));
  assert.match(statusReporter, /headSha: process\.env\.HEAD_SHA/);
  assert.match(statusReporter, /reportTrustedContributorReview/);
});

test('hostile artifacts are sanitized before upload and after download', () => {
  const hostile = review.indexOf('Run contributor code in a networkless resource-bounded container');
  const sanitizeBefore = review.indexOf('Sanitize hostile static output before upload');
  const upload = review.indexOf('Upload sanitized proposed site');
  const download = review.indexOf('Download sanitized proposed static output');
  const sanitizeAfter = review.indexOf('Revalidate downloaded artifact into fresh staging');
  const capture = review.indexOf('Capture BEFORE and PROPOSED AFTER');
  assert.ok(hostile < sanitizeBefore && sanitizeBefore < upload);
  assert.ok(download < sanitizeAfter && sanitizeAfter < capture);
});

test('all security-sensitive actions are immutable SHA pins with maintainable version comments', () => {
  for (const match of workflows.matchAll(/uses:\s+([^\s]+)/g)) {
    assert.match(match[1], /^actions\/(?:checkout|setup-node|upload-artifact|download-artifact)@[0-9a-f]{40}$/);
  }
  for (const version of ['actions/checkout v6.0.3', 'actions/setup-node v7.0.0', 'actions/upload-artifact v7.0.1', 'actions/download-artifact v8.0.0']) {
    assert.match(workflows, new RegExp(version.replace(/[./]/g, '\\$&')));
  }
});
