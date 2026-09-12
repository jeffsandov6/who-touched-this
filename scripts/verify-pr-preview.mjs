#!/usr/bin/env node
import { verifyPullRequestPreviewBundle } from './pr-review/preview.mjs';

const bundle = process.argv[2];
if (!bundle) {
  console.error('Usage: verify-pr-preview.mjs <bundle-path>');
  process.exitCode = 1;
} else {
  try {
    const manifest = await verifyPullRequestPreviewBundle(bundle);
    console.log(`Verified PR #${manifest.pullRequestNumber} visual review (${manifest.screenshots.length} routes).`);
  } catch (error) {
    console.error(`PR visual review verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
