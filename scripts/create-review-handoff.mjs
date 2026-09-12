#!/usr/bin/env node
import { writeReviewHandoffFromEvent } from './pr-review/handoff.mjs';

const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`${name} is required.`);
  return args[index + 1];
};

try {
  const handoff = await writeReviewHandoffFromEvent({ eventPath: value('--github-event'), outputPath: value('--output') });
  console.log(`Trusted review handoff prepared for PR #${handoff.pullRequestNumber} at ${handoff.headSha}.`);
} catch (error) {
  console.error(`Trusted review handoff failed: ${error.message}`);
  process.exitCode = 1;
}
