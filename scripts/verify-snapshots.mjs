#!/usr/bin/env node
import { resolve } from 'node:path';
import { verifySnapshotBundle } from './snapshots/manifest.mjs';

const args = process.argv.slice(2);
const bundleArgument = args[0] === '--bundle' ? args[1] : args[0];
if (!bundleArgument || args.length > (args[0] === '--bundle' ? 2 : 1)) {
  console.error('Usage: npm run snapshots:verify -- <bundle-path>');
  process.exitCode = 1;
} else {
  try {
    const manifest = await verifySnapshotBundle(resolve(bundleArgument));
    console.log(`Verified Contribution #${manifest.contributionLabel}: ${manifest.screenshots.length * 2} screenshots`);
  } catch (error) {
    console.error(`Snapshot verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}

