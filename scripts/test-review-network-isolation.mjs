#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { HOSTILE_NODE_IMAGE } from './pr-review/policy.mjs';

let requests = 0;
const server = createServer((_request, response) => {
  requests += 1;
  response.writeHead(200).end('unexpected');
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '0.0.0.0', resolve);
});
const address = server.address();

try {
  const script = `fetch('http://host.docker.internal:${address.port}/probe', { signal: AbortSignal.timeout(1500) }).then(() => process.exit(9)).catch(() => process.exit(0))`;
  const dockerArgs = [
    'run', '--rm', '--network', 'none', '--add-host', 'host.docker.internal:host-gateway',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '256m', '--cpus', '1',
    '--pids-limit', '32', '--user', '1001:1001', HOSTILE_NODE_IMAGE, 'node', '-e', script,
  ];
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn('docker', dockerArgs, { stdio: 'inherit', env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } });
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (exitCode !== 0 || requests !== 0) throw new Error(`Network isolation probe failed (exit ${exitCode}, requests ${requests}).`);
  console.log('PASS: network-disabled hostile container could not reach the host test server.');
} finally {
  await new Promise((resolve) => server.close(resolve));
}
