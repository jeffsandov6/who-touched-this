#!/usr/bin/env node
import { appendFile } from 'node:fs/promises';
import { assertTrustedManifests, createTrustedWorkspace, overlayContributorCanvas, sanitizeStaticArtifact } from './pr-review/workspace.mjs';

const args = process.argv.slice(2);
const command = args.shift();
const value = (name) => {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`${name} is required.`);
  return args[index + 1];
};

try {
  let result;
  if (command === 'create') result = await createTrustedWorkspace({ trustedRoot: value('--trusted'), outputRoot: value('--output') });
  else if (command === 'overlay') {
    result = await overlayContributorCanvas({ workspaceRoot: value('--workspace'), headRepository: value('--head-checkout'), headSha: value('--head-sha') });
    await assertTrustedManifests(value('--trusted'), value('--workspace'));
  } else if (command === 'sanitize-artifact') {
    result = await sanitizeStaticArtifact(value('--source'), value('--output'));
  } else throw new Error('Expected create, overlay, or sanitize-artifact command.');
  if (process.env.GITHUB_STEP_SUMMARY && command !== 'create') {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n- ${command}: ${result.files} files, ${result.bytes} bytes\n`);
  }
  console.log(typeof result === 'string' ? result : JSON.stringify(result));
} catch (error) {
  console.error(`PR review workspace preparation failed: ${error.message}`);
  process.exitCode = 1;
}
