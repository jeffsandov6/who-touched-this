export const CANONICAL_REPOSITORY = 'jeffsandov6/who-touched-this';
export const DEPENDABOT_LOGIN = 'dependabot[bot]';

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA = /^[0-9a-f]{40}$/;

function requirePullRequestMetadata(event) {
  const pull = event?.pull_request;
  const number = pull?.number ?? event?.number;
  const repository = event?.repository?.full_name;
  const baseRepository = pull?.base?.repo?.full_name;
  const headRepository = pull?.head?.repo?.full_name;
  if (!Number.isSafeInteger(number) || number < 1
    || repository !== CANONICAL_REPOSITORY
    || baseRepository !== CANONICAL_REPOSITORY
    || pull?.base?.ref !== 'main'
    || typeof headRepository !== 'string' || !REPOSITORY.test(headRepository)
    || typeof pull?.head?.ref !== 'string' || !pull.head.ref
    || !SHA.test(pull?.base?.sha ?? '') || !SHA.test(pull?.head?.sha ?? '')
    || typeof pull?.user?.login !== 'string'
    || typeof event?.sender?.login !== 'string') {
    throw new Error('Trusted pull-request repository metadata is incomplete or mismatched.');
  }
  return pull;
}

export function classifyPullRequest(event, actor) {
  const pull = requirePullRequestMetadata(event);
  const botIdentityPresent = actor === DEPENDABOT_LOGIN
    || pull.user.login === DEPENDABOT_LOGIN
    || event.sender.login === DEPENDABOT_LOGIN;

  if (!botIdentityPresent) return 'contribution';
  if (actor !== DEPENDABOT_LOGIN
    || pull.user.login !== DEPENDABOT_LOGIN
    || event.sender.login !== DEPENDABOT_LOGIN
    || pull.head.repo.full_name !== CANONICAL_REPOSITORY
    || !pull.head.ref.startsWith('dependabot/')) {
    throw new Error('Dependabot maintenance identity metadata is inconsistent.');
  }
  return 'maintenance';
}

function maintenanceArea(filePath) {
  if (filePath === 'package.json' || filePath === 'package-lock.json') return 'root-npm';
  if (filePath === 'functions/package.json' || filePath === 'functions/package-lock.json') return 'functions-npm';
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(filePath)) return 'github-actions';
  return null;
}

function changedPatchLines(change) {
  if (typeof change.patch !== 'string') return null;
  return change.patch.split('\n')
    .filter((line) => /^[+-]/.test(line) && !/^(?:\+\+\+|---)/.test(line));
}

function validateManifestPatch(change, failures) {
  const lines = changedPatchLines(change);
  if (!lines?.length || lines.some((line) => !/^[+-] {4}"[^"]+": "[^"]+",?$/.test(line))) {
    failures.push(`Package manifest changes must contain only dependency version entries: ${change.targetPath}`);
  }
}

function validateWorkflowPatch(change, failures) {
  const lines = changedPatchLines(change);
  const allowed = /^[+-]\s*(?:#\s+[^\s/]+\/[^\s]+\s+v[^\s]+|(?:-\s+)?uses:\s+[^\s/]+\/[^\s@]+@[0-9a-f]{40})\s*$/;
  if (!lines?.length || lines.some((line) => !allowed.test(line))) {
    failures.push(`Workflow maintenance must contain only pinned action SHA/version-comment updates: ${change.targetPath}`);
    return;
  }
  const action = (line) => line.match(/uses:\s+([^\s@]+\/[^\s@]+)@[0-9a-f]{40}/)?.[1] ?? null;
  const removed = lines.filter((line) => line.startsWith('-')).map(action).filter(Boolean).sort();
  const added = lines.filter((line) => line.startsWith('+')).map(action).filter(Boolean).sort();
  if (removed.length === 0 || JSON.stringify(removed) !== JSON.stringify(added)) {
    failures.push(`Workflow action identities must be preserved while SHAs are updated: ${change.targetPath}`);
  }
}

export function evaluateDependabotMaintenance(changes) {
  const failures = [];
  const areas = new Set();
  if (!Array.isArray(changes) || changes.length === 0) failures.push('Maintenance pull request has no changed files.');
  for (const change of changes ?? []) {
    if (change.status !== 'M' || change.paths.length !== 1 || change.targetPath !== change.paths[0]) {
      failures.push(`Maintenance may only modify existing files: ${change.paths.join(' -> ')}`);
      continue;
    }
    const area = maintenanceArea(change.targetPath);
    if (!area) failures.push(`File is outside Dependabot maintenance scope: ${change.targetPath}`);
    else {
      areas.add(area);
      if (change.targetPath.endsWith('package.json')) validateManifestPatch(change, failures);
      if (area === 'github-actions') validateWorkflowPatch(change, failures);
    }
    if (change.mode !== '100644') failures.push(`Maintenance file must remain a regular non-executable file: ${change.targetPath}`);
  }
  if (areas.size > 1) failures.push('A Dependabot maintenance pull request may update only one configured ecosystem.');
  return Object.freeze({
    passed: failures.length === 0,
    failures,
    area: areas.size === 1 ? [...areas][0] : null,
  });
}
