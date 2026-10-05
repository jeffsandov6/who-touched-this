#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { hostileContainerArguments, HOSTILE_NODE_IMAGE, HOSTILE_PLAYWRIGHT_IMAGE, REVIEW_LIMITS } from './pr-review/policy.mjs';
import { SNAPSHOT_BUILD_ENV } from './snapshots/config.mjs';

const snapshotBuildEnvironment = Object.entries(SNAPSHOT_BUILD_ENV)
  .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
  .join(' ');

const args = process.argv.slice(2);
const phase = args.shift();
const value = (name) => {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`${name} is required.`);
  return resolve(args[index + 1]);
};

function runDocker(dockerArgs) {
  return new Promise((resolvePromise, reject) => {
    // Deliberately pass a tiny fixed environment. GITHUB_TOKEN, Actions runtime credentials,
    // Firebase configuration, and host proxy variables never enter the Docker client process.
    const child = spawn('docker', dockerArgs, { stdio: 'inherit', env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolvePromise() : reject(new Error(`Sandbox exited with ${signal ?? `code ${code}`}.`)));
  });
}

try {
  if (phase === 'build' || phase === 'base-build') {
    const workspace = value('--workspace');
    await runDocker(hostileContainerArguments({
      image: HOSTILE_NODE_IMAGE,
      workspace,
      timeoutSeconds: REVIEW_LIMITS.hostilePhaseSeconds,
      command: phase === 'build'
        ? ['sh', '-c', `npm run check && npm run test:contributor && npm run build:contributor && env ${snapshotBuildEnvironment} npm run build`]
        : ['sh', '-c', `env ${snapshotBuildEnvironment} npm run build`],
    }));
  } else if (phase === 'preview') {
    const trusted = value('--trusted');
    const baseDist = value('--base-dist');
    const proposedDist = value('--proposed-dist');
    const output = value('--output');
    const identity = {
      pr: args[args.indexOf('--pull-request') + 1],
      base: args[args.indexOf('--base-sha') + 1],
      head: args[args.indexOf('--head-sha') + 1],
    };
    if (!identity.pr || !identity.base || !identity.head) throw new Error('Preview identity arguments are required.');
    await runDocker(hostileContainerArguments({
      image: HOSTILE_PLAYWRIGHT_IMAGE,
      workspace: trusted,
      workspaceReadonly: true,
      timeoutSeconds: REVIEW_LIMITS.previewPhaseSeconds,
      outputMounts: [
        { source: baseDist, target: '/review/base-dist', readonly: true },
        { source: proposedDist, target: '/review/proposed-dist', readonly: true },
        { source: output, target: '/review/output' },
      ],
      command: [
        'node', '--experimental-strip-types', 'scripts/create-pr-preview.mjs',
        '--pull-request', identity.pr,
        '--base-repository', '/workspace',
        '--base-dist', '/review/base-dist',
        '--proposed-dist', '/review/proposed-dist',
        '--base-sha', identity.base,
        '--head-sha', identity.head,
        '--output', '/review/output/bundle',
      ],
    }));
  } else throw new Error('Expected build, base-build, or preview sandbox phase.');
} catch (error) {
  console.error(`PR review sandbox failed: ${error.message}`);
  process.exitCode = 1;
}
