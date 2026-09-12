import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { formatSecurityScanReport, scanContributionSources, scanContributorSourceText } from '../scripts/security/contribution-source-scan.mjs';

const exec = promisify(execFile);

test('harmless React and TSX source has no findings', () => {
  const source = `export function Card() { return <article><h2>Hello</h2><button type="button">Shuffle</button></article>; }`;
  assert.deepEqual(scanContributorSourceText('src/canvas/Card.tsx', source), []);
});

test('direct arbitrary-code and script execution constructs hard fail', () => {
  const examples = new Map([
    ['direct-eval', 'eval(userInput);'],
    ['function-constructor', 'const build = new Function("return 1");'],
    ['script-element', 'const script = document.createElement("script");'],
    ['javascript-url', 'const href = "javascript:alert(1)";'],
    ['remote-dynamic-import', 'const module = import("https://example.test/code.js");'],
  ]);
  for (const [ruleId, source] of examples) {
    const result = scanContributorSourceText('src/canvas/unsafe.tsx', source);
    assert.equal(result.some((finding) => finding.ruleId === ruleId && finding.severity === 'hard-fail'), true, ruleId);
  }
  assert.equal(scanContributorSourceText('src/canvas/worker.ts', 'importScripts("/payload.js");').some((finding) => finding.ruleId === 'script-element'), true);
});

test('review-sensitive browser APIs produce warnings with locations', () => {
  const source = [
    'fetch("https://example.test/data");',
    'localStorage.setItem("art", "yes");',
    'window.open("https://example.test");',
    'return <iframe src="https://example.test/embed" />;',
    'node.innerHTML = markup;',
    'location.replace("https://example.test");',
    'form.requestSubmit();',
  ].join('\n');
  const result = scanContributorSourceText('src/canvas/review.tsx', source);
  for (const ruleId of ['fetch-request', 'local-storage', 'window-open', 'external-embed', 'dom-html-injection', 'location-redirect', 'form-submission']) {
    const finding = result.find((item) => item.ruleId === ruleId);
    assert.equal(finding?.severity, 'warning', ruleId);
    assert.equal(finding?.file, 'src/canvas/review.tsx');
    assert.equal(Number.isInteger(finding?.line), true);
  }
});

test('large encoded and dense source characteristics warn without failing', () => {
  const encoded = `const value = "${'A'.repeat(9000)}";`;
  const dense = `const values=[${'1,'.repeat(700)}];`;
  const findings = scanContributorSourceText('src/canvas/blob.ts', `${encoded}\n${dense}`);
  assert.equal(findings.some((item) => item.ruleId === 'large-encoded-data' && item.severity === 'warning'), true);
  assert.equal(findings.some((item) => item.ruleId === 'obfuscated-source' && item.severity === 'warning'), true);
});

test('formatted findings neutralize control and Markdown characters in untrusted paths', () => {
  const output = formatSecurityScanReport({
    scannedFiles: [],
    findings: [{ severity: 'warning', file: 'src/canvas/[link]\nname.ts', line: 2, ruleId: 'fetch-request', explanation: 'Network review.' }],
    summary: { hardFailures: 0, warnings: 1 },
  });
  assert.doesNotMatch(output, /\[link\]\n/);
  assert.match(output, /\\\[link\\\]\\u000aname\.ts:2/);
});

async function fixtureRepository() {
  const root = await mkdtemp(join(tmpdir(), 'wtt-security-scan-'));
  await exec('git', ['init', '-q'], { cwd: root });
  await exec('git', ['config', 'user.email', 'fixture@example.test'], { cwd: root });
  await exec('git', ['config', 'user.name', 'Fixture'], { cwd: root });
  await mkdir(join(root, 'src/canvas/assets'), { recursive: true });
  await mkdir(join(root, 'src/platform'), { recursive: true });
  await writeFile(join(root, 'src/canvas/View.tsx'), 'export const View = () => <main />;\n');
  await writeFile(join(root, 'src/platform/private.ts'), 'export const value = 1;\n');
  await exec('git', ['add', '.'], { cwd: root });
  await exec('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

test('repository scan reads only changed regular contributor source and skips assets', async () => {
  const root = await fixtureRepository();
  try {
    await writeFile(join(root, 'src/canvas/View.tsx'), 'export const View = () => { fetch("/local"); return <main />; };\n');
    await writeFile(join(root, 'src/canvas/assets/pixel.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(join(root, 'src/platform/private.ts'), 'eval("protected but outside scanner scope");\n');
    await exec('git', ['add', '.'], { cwd: root });
    const report = await scanContributionSources({ base: 'HEAD', cwd: root, now: new Date('2026-01-01T00:00:00Z') });
    assert.deepEqual(report.scannedFiles, ['src/canvas/View.tsx']);
    assert.deepEqual(report.skippedFiles, [{ file: 'src/canvas/assets/pixel.png', reason: 'non-source asset' }]);
    assert.equal(report.findings.some((item) => item.ruleId === 'fetch-request'), true);
    assert.equal(report.findings.some((item) => item.file.includes('platform')), false);
    assert.match(formatSecurityScanReport(report), /\[warning\] src\/canvas\/View\.tsx:1 fetch-request/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('scanner never follows changed canvas symlinks', async () => {
  const root = await fixtureRepository();
  try {
    await symlink('../../platform/private.ts', join(root, 'src/canvas/link.ts'));
    await exec('git', ['add', 'src/canvas/link.ts'], { cwd: root });
    const report = await scanContributionSources({ base: 'HEAD', cwd: root });
    assert.equal(report.findings.some((item) => item.ruleId === 'unsafe-file-type' && item.severity === 'hard-fail'), true);
    assert.equal(report.scannedFiles.includes('src/canvas/link.ts'), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
