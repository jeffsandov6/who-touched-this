#!/usr/bin/env node

import { appendFile, readFile } from 'node:fs/promises';
import { collectGitHubContribution } from './contribution-validator.mjs';
import { classifyPullRequest, evaluateDependabotMaintenance } from './pull-request-policy.mjs';

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} is required.`);
  return process.argv[index + 1];
}

try {
  const eventPath = optionValue('--github-event');
  const event = JSON.parse(await readFile(eventPath, 'utf8'));
  const mode = classifyPullRequest(event, process.env.GITHUB_ACTOR);
  let area = '';
  if (mode === 'maintenance') {
    const collected = await collectGitHubContribution(eventPath);
    const result = evaluateDependabotMaintenance(collected.changes);
    if (!result.passed) throw new Error(result.failures.join('\n'));
    area = result.area;
    console.log(`Authenticated Dependabot ${area} maintenance pull request.`);
  } else {
    console.log('Community contribution pull request.');
  }
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `mode=${mode}\nmaintenance_area=${area}\n`);
  }
} catch (error) {
  console.error(`Pull-request classification failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
}
