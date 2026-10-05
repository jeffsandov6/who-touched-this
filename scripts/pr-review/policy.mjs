export const REVIEW_LIMITS = Object.freeze({
  maxCanvasFiles: 2_000,
  maxCanvasBytes: 75 * 1024 * 1024,
  maxArtifactFiles: 20_000,
  maxArtifactFileBytes: 25 * 1024 * 1024,
  maxArtifactBytes: 250 * 1024 * 1024,
  hostilePhaseSeconds: 480,
  previewPhaseSeconds: 420,
  containerMemory: '4g',
  containerCpus: '2',
  containerPids: '256',
  maxTileHeight: 3_600,
  maxTileWidth: 2_880,
  maxTilePixels: 10_368_000,
  maxTileCount: 64,
  maxTotalScreenshotPixels: 384_000_000,
  maxTotalScreenshotBytes: 160 * 1024 * 1024,
  screenshotTimeoutMs: 30_000,
});

// Exact tool tags are retained for readability; OCI index digests make the executable images immutable.
export const HOSTILE_NODE_IMAGE = 'node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3';
export const HOSTILE_PLAYWRIGHT_IMAGE = 'mcr.microsoft.com/playwright:v1.56.0-noble@sha256:35246d87a7c88ea9b771c65d33171b2611b02a8253b4b12ce6f94376c55f99f2';

export function hostileContainerArguments({ image, workspace, workspaceReadonly = false, command, timeoutSeconds, outputMounts = [] }) {
  if (!Array.isArray(command) || command.length === 0) throw new Error('A bounded hostile container command is required.');
  return [
    'run', '--rm', '--read-only', '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--memory', REVIEW_LIMITS.containerMemory, '--memory-swap', REVIEW_LIMITS.containerMemory,
    '--cpus', REVIEW_LIMITS.containerCpus, '--pids-limit', REVIEW_LIMITS.containerPids,
    '--ulimit', `fsize=${REVIEW_LIMITS.maxArtifactFileBytes}:${REVIEW_LIMITS.maxArtifactFileBytes}`,
    '--user', '1001:1001', '--workdir', '/workspace',
    '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=1g,uid=1001,gid=1001',
    '--env', 'CI=true', '--env', 'HOME=/tmp/wtt-home',
    '--mount', `type=bind,src=${workspace},dst=/workspace${workspaceReadonly ? ',readonly' : ''}`,
    ...outputMounts.flatMap(({ source, target, readonly = false }) => ['--mount', `type=bind,src=${source},dst=${target}${readonly ? ',readonly' : ''}`]),
    image,
    'timeout', '--signal=TERM', '--kill-after=10s', `${timeoutSeconds}s`,
    ...command,
  ];
}
