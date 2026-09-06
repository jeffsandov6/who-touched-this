import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const TEXT_EXTENSIONS = new Set(['.html', '.js', '.css', '.json', '.txt', '.xml', '.svg', '.map']);
const FORBIDDEN = [
  /localhost:(?:4000|5001|5002|8080|8085|9099|9199)/i,
  /127\.0\.0\.1(?::\d+)?/i,
  /demo-who-touched-this/i,
  /PUBLIC_USE_FIREBASE_EMULATORS\s*=\s*true/i,
  /Local canvas preview/i,
  /RESEND_API_KEY|GITHUB_WEBHOOK_SECRET/,
];

async function filesBelow(path) {
  const output = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) output.push(...await filesBelow(child));
    else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) output.push(child);
  }
  return output;
}

export async function scanProductionArtifact(path) {
  const violations = [];
  for (const file of await filesBelow(path)) {
    const contents = await readFile(file, 'utf8');
    if (FORBIDDEN.some((pattern) => pattern.test(contents))) violations.push(file);
  }
  if (violations.length) throw new Error(`Production artifact contains forbidden development/server configuration in ${violations.length} file(s).`);
  return { filesScanned: (await filesBelow(path)).length };
}
