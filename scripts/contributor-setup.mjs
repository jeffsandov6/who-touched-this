#!/usr/bin/env node
import { runContributorSetup } from './contributor/setup.mjs';

const args = process.argv.slice(2);
if (args.some((value) => !['--skip-install', '--help'].includes(value))) {
  console.error('Usage: npm run contributor:setup -- [--skip-install]');
  process.exitCode = 1;
} else if (args.includes('--help')) {
  console.log('Verify fork remotes and runtime versions, add the canonical upstream when missing, and run npm ci.');
  console.log('Use --skip-install to perform only the safe verification/setup steps.');
} else {
  try { await runContributorSetup({ install: !args.includes('--skip-install') }); }
  catch (error) {
    console.error(`Contributor setup failed: ${error.message}`);
    process.exitCode = 1;
  }
}
