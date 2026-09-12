#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { capturePullRequestPreview } from './pr-review/preview.mjs';

function value(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => controller.abort(new Error(`Preview interrupted by ${signal}.`)));

try {
  const pullRequestNumber = Number(value('--pull-request'));
  const baseRepository = value('--base-repository');
  const baseDistPath = value('--base-dist');
  const proposedDistPath = value('--proposed-dist');
  const baseSha = value('--base-sha');
  const headSha = value('--head-sha');
  const outputPath = value('--output');
  const summaryPath = value('--summary');
  if (!baseRepository || !baseDistPath || !proposedDistPath || !baseSha || !headSha || !outputPath) {
    throw new Error('Usage: --pull-request <number> --base-repository <path> --base-dist <path> --proposed-dist <path> --base-sha <SHA> --head-sha <SHA> --output <path> [--summary <path>]');
  }
  const result = await capturePullRequestPreview({ pullRequestNumber, baseRepository, baseDistPath, proposedDistPath, baseSha, headSha, outputPath, signal: controller.signal });
  console.log(`Created PR #${pullRequestNumber} visual preview with ${result.manifest.canonicalRoutes.length} routes.`);
  if (summaryPath) {
    await writeFile(summaryPath, `\n## Visual preview\n\nCaptured ${result.manifest.canonicalRoutes.length} canonical routes at base \`${baseSha.slice(0, 12)}\` and proposed head \`${headSha.slice(0, 12)}\`. Download the **pr-${pullRequestNumber}-visual-review** artifact and open \`index.html\`. This is a review artifact, not the permanent History snapshot.\n`, { flag: 'a' });
  }
} catch (error) {
  console.error(`Pull request visual preview failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
}
