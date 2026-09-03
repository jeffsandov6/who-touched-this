import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export async function sha256File(filePath) {
  return sha256(await readFile(filePath));
}

export function isPng(buffer) {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

