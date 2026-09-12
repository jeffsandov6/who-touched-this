#!/usr/bin/env node
import { appendFile, readFile } from 'node:fs/promises';
import { readReviewHandoff, verifyReviewHandoff } from './pr-review/handoff.mjs';

const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`${name} is required.`);
  return args[index + 1];
};
const output = process.env.GITHUB_OUTPUT;

try {
  const handoff = await readReviewHandoff(value('--handoff'));
  const workflowRunEvent = JSON.parse(await readFile(value('--workflow-event'), 'utf8'));
  await verifyReviewHandoff({ handoff, workflowRunEvent, token: process.env.GITHUB_TOKEN, apiUrl: process.env.GITHUB_API_URL });
  if (!output) throw new Error('GITHUB_OUTPUT is unavailable.');
  await appendFile(output, [
    `pull_request_number=${handoff.pullRequestNumber}`,
    `base_repository=${handoff.baseRepository}`,
    `base_sha=${handoff.baseSha}`,
    `head_repository=${handoff.headRepository}`,
    `head_sha=${handoff.headSha}`,
    '',
  ].join('\n'));
  console.log(`Trusted handoff verified for PR #${handoff.pullRequestNumber}.`);
} catch (error) {
  console.error(`Trusted review handoff verification failed: ${error.message}`);
  process.exitCode = 1;
}
