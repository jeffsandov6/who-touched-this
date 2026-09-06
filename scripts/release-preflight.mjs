#!/usr/bin/env node
import { join } from 'node:path';
import { resolveRepositoryRoot } from './snapshots/git.mjs';
import { loadEnvFile } from './release/environment.mjs';
import { runReleasePreflight } from './release/preflight.mjs';

try {
  const repoRoot = await resolveRepositoryRoot();
  const browserEnvironment = await loadEnvFile(join(repoRoot, '.env.production.local'), 'Owner production configuration');
  const functionsEnvironment = await loadEnvFile(join(repoRoot, 'functions/.env.who-touched-this'), 'Functions production parameter configuration');
  const result = await runReleasePreflight({ repoRoot, browserEnvironment, functionsEnvironment });
  console.log('Release preflight PASS');
  console.log(`Project: ${result.projectId}`);
  console.log(`Origin: ${result.origin}`);
  console.log(`Git SHA: ${result.sha}`);
  console.log(`Branch: ${result.branch}`);
  console.log(`Indexing: ${result.indexingEnabled ? 'enabled' : 'disabled'}`);
  console.log(`Production artifact scan: PASS (${result.artifact.filesScanned} text files)`);
  console.log('No deployment was performed.');
} catch (error) {
  console.error(`Release preflight FAIL: ${error.message}`);
  process.exitCode = 1;
}
