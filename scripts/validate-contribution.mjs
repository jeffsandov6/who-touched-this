#!/usr/bin/env node

import {
  collectGitHubContribution,
  collectLocalContribution,
  evaluateContribution,
  formatContributionResult,
} from './contribution-validator.mjs';

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

try {
  const eventPath = optionValue('--github-event');
  const base = optionValue('--base');
  if (!eventPath && !base) {
    throw new Error('Provide an explicit comparison base, for example: --base upstream/main');
  }
  const collected = eventPath
    ? await collectGitHubContribution(eventPath)
    : await collectLocalContribution(base);
  const result = evaluateContribution(collected.changes, collected.totals ?? undefined);
  console.log(formatContributionResult(result));
  if (!result.passed) process.exitCode = 1;
} catch (error) {
  console.error('Contribution validation\n');
  console.error(`✗ ${error instanceof Error ? error.message : 'Validation could not run safely.'}\n`);
  console.error('FAIL');
  process.exitCode = 1;
}
