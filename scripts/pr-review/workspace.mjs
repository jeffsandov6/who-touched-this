import { constants as fsConstants } from 'node:fs';
import { copyFile, cp, lstat, mkdir, opendir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { CONTRIBUTION_LIMITS, isEditableCanvasPath } from '../contribution-validator.mjs';
import { REVIEW_LIMITS } from './policy.mjs';

const exec = promisify(execFile);
const OMIT_FROM_TRUSTED_COPY = new Set(['.git', '.wtt', 'dist', 'node_modules']);

function contained(root, candidate) {
  const absoluteRoot = resolve(root);
  const absolute = resolve(candidate);
  return absolute === absoluteRoot || absolute.startsWith(`${absoluteRoot}${sep}`);
}

export function validateOverlayPath(path, prefix = 'src/canvas') {
  if (typeof path !== 'string' || path.includes('\\') || path.includes('\0') || posix.isAbsolute(path)
    || path.split('/').some((part) => !part || part === '.' || part === '..' || /[\u0000-\u001f\u007f]/.test(part))
    || !path.startsWith(`${prefix}/`)) throw new Error(`Unsafe overlay path: ${String(path)}`);
  if (Buffer.byteLength(path) > 1024 || path.split('/').some((part) => Buffer.byteLength(part) > 255)) {
    throw new Error(`Overlay path exceeds safe filename limits: ${path}`);
  }
  return path;
}

async function treeEntries(repository, revision) {
  const { stdout } = await exec('git', ['ls-tree', '-r', '-z', '-l', revision, '--', 'src/canvas'], {
    cwd: repository, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024,
  });
  const entries = [];
  for (const record of stdout.toString('utf8').split('\0')) {
    if (!record) continue;
    const match = record.match(/^(\d{6}) (\w+) ([0-9a-f]{40})\s+(\d+|-)\t([\s\S]+)$/);
    if (!match) throw new Error('Pull request canvas tree metadata is malformed.');
    const [, mode, type, objectSha, rawSize, path] = match;
    validateOverlayPath(path);
    if (mode === '120000') throw new Error(`Canvas overlay rejects symbolic link: ${path}`);
    if (mode === '160000' || type === 'commit') throw new Error(`Canvas overlay rejects gitlink/submodule: ${path}`);
    if (!['100644', '100755'].includes(mode) || type !== 'blob' || rawSize === '-') throw new Error(`Canvas overlay rejects non-regular Git object: ${path}`);
    const size = Number(rawSize);
    if (!Number.isSafeInteger(size) || size < 0 || size > CONTRIBUTION_LIMITS.maxFileBytes) throw new Error(`Canvas overlay file exceeds its bounded limit: ${path}`);
    entries.push({ mode, objectSha, path, size });
  }
  if (entries.length > REVIEW_LIMITS.maxCanvasFiles) throw new Error('Canvas overlay exceeds its file-count limit.');
  if (entries.reduce((sum, item) => sum + item.size, 0) > REVIEW_LIMITS.maxCanvasBytes) throw new Error('Canvas overlay exceeds its aggregate size limit.');
  return entries;
}

export async function createTrustedWorkspace({ trustedRoot, outputRoot }) {
  const trusted = resolve(trustedRoot);
  const output = resolve(outputRoot);
  if (contained(trusted, output)) throw new Error('Proposed workspace must be isolated from the trusted checkout.');
  if (await stat(output).then(() => true).catch(() => false)) throw new Error('Proposed workspace already exists.');
  await mkdir(output, { recursive: false });
  try {
    await cp(trusted, output, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (source) => {
        if (source === trusted) return true;
        const fromRoot = relative(trusted, source);
        return fromRoot.includes(sep) || !OMIT_FROM_TRUSTED_COPY.has(fromRoot);
      },
    });
    return output;
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
}

export async function overlayContributorCanvas({ workspaceRoot, headRepository, headSha }) {
  const output = resolve(workspaceRoot);
  const head = resolve(headRepository);
  if (contained(head, output)) throw new Error('Proposed workspace must be isolated from the head checkout.');
  try {
    const actualHead = (await exec('git', ['rev-parse', 'HEAD'], { cwd: head, encoding: 'utf8' })).stdout.trim();
    if (actualHead !== headSha) throw new Error('Sparse pull request checkout does not match the validated head SHA.');
    await rm(join(output, 'src/canvas'), { recursive: true, force: true });
    const entries = await treeEntries(head, headSha);
    for (const entry of entries) {
      if (!isEditableCanvasPath(entry.path)) throw new Error(`Overlay escaped the editable canvas: ${entry.path}`);
      const destination = join(output, ...entry.path.split('/'));
      if (!contained(output, destination)) throw new Error(`Overlay path escaped its root: ${entry.path}`);
      await mkdir(dirname(destination), { recursive: true });
      const blob = (await exec('git', ['cat-file', 'blob', entry.objectSha], { cwd: head, encoding: 'buffer', maxBuffer: CONTRIBUTION_LIMITS.maxFileBytes + 1024 })).stdout;
      if (blob.length !== entry.size) throw new Error(`Canvas Git blob size changed unexpectedly: ${entry.path}`);
      await writeFile(destination, blob, { flag: 'wx', mode: entry.mode === '100755' ? 0o755 : 0o644 });
    }
    return { files: entries.length, bytes: entries.reduce((sum, item) => sum + item.size, 0) };
  } catch (error) {
    throw error;
  }
}

function validateArtifactName(name) {
  if (!name || name === '.' || name === '..' || /[\\/\u0000-\u001f\u007f]/.test(name) || Buffer.byteLength(name) > 255) {
    throw new Error('Static artifact contains an unsafe filename.');
  }
}

export async function sanitizeStaticArtifact(sourceRoot, destinationRoot, limits = REVIEW_LIMITS) {
  const source = resolve(sourceRoot);
  const destination = resolve(destinationRoot);
  if (contained(source, destination) || contained(destination, source)) throw new Error('Artifact staging must be separate from hostile output.');
  const sourceMetadata = await lstat(source).catch(() => null);
  if (!sourceMetadata?.isDirectory() || sourceMetadata.isSymbolicLink()) throw new Error('Static artifact source must be a real directory.');
  if (await stat(destination).then(() => true).catch(() => false)) throw new Error('Artifact staging destination already exists.');
  await mkdir(destination, { recursive: false });
  let files = 0;
  let bytes = 0;
  const pending = [{ source, destination, relativePath: '' }];
  try {
    while (pending.length) {
      const current = pending.pop();
      const directory = await opendir(current.source);
      for await (const entry of directory) {
        validateArtifactName(entry.name);
        const sourcePath = join(current.source, entry.name);
        const destinationPath = join(current.destination, entry.name);
        const artifactPath = current.relativePath ? `${current.relativePath}/${entry.name}` : entry.name;
        if (Buffer.byteLength(artifactPath) > 1024 || !contained(source, sourcePath) || !contained(destination, destinationPath)) {
          throw new Error('Static artifact path escaped its staging root.');
        }
        const metadata = await lstat(sourcePath);
        if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile()) || (metadata.isFile() && metadata.nlink !== 1)) {
          throw new Error(`Static artifact rejects non-regular object: ${artifactPath}`);
        }
        if (metadata.isDirectory()) {
          await mkdir(destinationPath);
          pending.push({ source: sourcePath, destination: destinationPath, relativePath: artifactPath });
        } else {
          files += 1;
          bytes += metadata.size;
          if (metadata.size > limits.maxArtifactFileBytes) throw new Error(`Static artifact file exceeds its limit: ${artifactPath}`);
          if (files > limits.maxArtifactFiles) throw new Error('Static artifact exceeds its file-count limit.');
          if (bytes > limits.maxArtifactBytes) throw new Error('Static artifact exceeds its aggregate size limit.');
          await copyFile(sourcePath, destinationPath, fsConstants.COPYFILE_EXCL | fsConstants.COPYFILE_FICLONE);
          const copied = await lstat(destinationPath);
          if (!copied.isFile() || copied.size !== metadata.size) throw new Error(`Static artifact copy changed unexpectedly: ${artifactPath}`);
        }
      }
    }
    if (files === 0) throw new Error('Static artifact is empty.');
    return { files, bytes };
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}

export async function assertTrustedManifests(trustedRoot, proposedRoot) {
  for (const name of ['package.json', 'package-lock.json']) {
    const [trusted, proposed] = await Promise.all([readFile(join(trustedRoot, name)), readFile(join(proposedRoot, name))]);
    if (!trusted.equals(proposed)) throw new Error(`Proposed workspace does not use the trusted ${name}.`);
  }
}
