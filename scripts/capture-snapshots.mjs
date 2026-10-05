#!/usr/bin/env node
import { relative } from 'node:path';
import { captureSnapshots } from './snapshots/capture.mjs';

function parseArguments(argv) {
  const options = { additionalRoutes: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (['--contribution', '--before', '--after', '--route', '--wait-ms'].includes(argument) && value === undefined) {
      throw new Error(`${argument} requires a value.`);
    }
    if (argument === '--contribution') { options.contributionNumber = Number(value); index += 1; }
    else if (argument === '--before') { options.before = value; index += 1; }
    else if (argument === '--after') { options.after = value; index += 1; }
    else if (argument === '--route') { options.additionalRoutes.push(value); index += 1; }
    else if (argument === '--wait-ms') { options.waitMs = Number(value); index += 1; }
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.contributionNumber === undefined || !options.before || !options.after) {
    throw new Error('Usage: npm run snapshots:capture -- --contribution <number> --before <SHA> --after <SHA> [--route <path>] [--wait-ms <milliseconds>]');
  }
  return options;
}

const controller = new AbortController();
for (const signalName of ['SIGINT', 'SIGTERM']) {
  process.once(signalName, () => controller.abort(new Error(`Capture interrupted by ${signalName}.`)));
}

try {
  const options = parseArguments(process.argv.slice(2));
  const result = await captureSnapshots({ ...options, signal: controller.signal });
  console.log('Canonical editable routes:');
  for (const route of result.manifest.canonicalRoutes) console.log(`  ${route}`);
  if (result.manifest.additionalRoutes.length) {
    console.log('Additional routes:');
    for (const route of result.manifest.additionalRoutes) console.log(`  ${route}`);
  }
  const tileCount = result.manifest.screenshots.reduce((total, record) => total + record.before.tiles.length + record.after.tiles.length, 0);
  console.log(`Captured ${result.manifest.capturedRoutes.length} routes × 2 revisions = ${tileCount} screenshot tiles`);
  console.log(`Bundle: ${relative(process.cwd(), result.bundlePath)}`);
} catch (error) {
  console.error(`Snapshot capture failed: ${error.message}`);
  process.exitCode = 1;
}
