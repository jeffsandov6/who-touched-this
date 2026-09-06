#!/usr/bin/env node
import { runReadOnlySmoke } from './release/smoke.mjs';

const args = process.argv.slice(2);
const originIndex = args.indexOf('--origin');
const indexingIndex = args.indexOf('--expect-indexing');
if (originIndex < 0 || indexingIndex < 0 || !args[originIndex + 1] || !args[indexingIndex + 1]) {
  console.error('Usage: npm run release:smoke -- --origin https://whotouchedthis.website --expect-indexing disabled|enabled');
  process.exitCode = 1;
} else {
  try {
    const routes = await runReadOnlySmoke({ origin: args[originIndex + 1], expectedIndexing: args[indexingIndex + 1] });
    for (const route of routes) console.log(`PASS ${route}`);
    console.log(`Read-only production smoke PASS: ${routes.length} routes`);
  } catch (error) {
    console.error(`Read-only production smoke FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
