import { execFile } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { CONTRIBUTION_LIMITS, isEditableCanvasPath } from '../contribution-validator.mjs';

const execFileAsync = promisify(execFile);
const LARGE_SOURCE_REVIEW_BYTES = 2 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set([
  '.astro', '.cjs', '.css', '.htm', '.html', '.js', '.json', '.jsx', '.less', '.md', '.mjs',
  '.sass', '.scss', '.svelte', '.svg', '.ts', '.tsx', '.txt', '.vue',
]);

export const SECURITY_SCAN_RULES = Object.freeze([
  { id: 'direct-eval', severity: 'hard-fail', explanation: 'Direct eval executes dynamically constructed code.', pattern: /\beval\s*\(/i },
  { id: 'function-constructor', severity: 'hard-fail', explanation: 'The Function constructor executes dynamically constructed code.', pattern: /\b(?:new\s+)?(?:globalThis\.)?Function\s*\(/ },
  { id: 'script-element', severity: 'hard-fail', explanation: 'Contributor code may not create or inject script elements.', pattern: /\bcreateElement\s*\(\s*(['"])script\1\s*\)|<script(?:\s|>)|\bimportScripts\s*\(|\b(?:append|prepend|appendChild|insertBefore)\s*\([^)]*\bscript\b/i },
  { id: 'javascript-url', severity: 'hard-fail', explanation: 'javascript: URLs execute code through navigation.', pattern: /javascript\s*:/i },
  { id: 'remote-dynamic-import', severity: 'hard-fail', explanation: 'Remote dynamic imports execute code outside the reviewed contribution.', pattern: /\bimport\s*\(\s*(['"`])https?:\/\//i },
  { id: 'dangerous-react-html', severity: 'warning', explanation: 'React raw HTML injection requires careful review.', pattern: /\bdangerouslySetInnerHTML\b/ },
  { id: 'dom-html-injection', severity: 'warning', explanation: 'DOM HTML mutation can inject active markup.', pattern: /\.(?:innerHTML|outerHTML)\b|\.insertAdjacentHTML\s*\(/ },
  { id: 'document-write', severity: 'warning', explanation: 'document.write injects markup into the page.', pattern: /\bdocument\.(?:write|writeln)\s*\(/ },
  { id: 'fetch-request', severity: 'warning', explanation: 'Network requests require destination and privacy review.', pattern: /\bfetch\s*\(/ },
  { id: 'xml-http-request', severity: 'warning', explanation: 'XMLHttpRequest performs network access.', pattern: /\bnew\s+XMLHttpRequest\b|\bXMLHttpRequest\s*\(/ },
  { id: 'websocket', severity: 'warning', explanation: 'WebSocket opens a persistent network connection.', pattern: /\bnew\s+WebSocket\b|\bWebSocket\s*\(/ },
  { id: 'event-source', severity: 'warning', explanation: 'EventSource opens a persistent server connection.', pattern: /\bnew\s+EventSource\b|\bEventSource\s*\(/ },
  { id: 'send-beacon', severity: 'warning', explanation: 'sendBeacon transmits data outside normal navigation.', pattern: /\bnavigator\.sendBeacon\s*\(/ },
  { id: 'external-embed', severity: 'warning', explanation: 'Externally hosted embedded content requires source review.', pattern: /<(?:iframe|embed)\b[^>]*\bsrc\s*=\s*(['"])https?:\/\/|<object\b[^>]*\bdata\s*=\s*(['"])https?:\/\//i },
  { id: 'external-form-action', severity: 'warning', explanation: 'An external form action sends visitor data to another origin.', pattern: /<form\b[^>]*\baction\s*=\s*(['"])https?:\/\//i },
  { id: 'form-submission', severity: 'warning', explanation: 'Programmatic form submission can transmit visitor data.', pattern: /\.(?:submit|requestSubmit)\s*\(/ },
  { id: 'external-navigation', severity: 'warning', explanation: 'External navigation should be intentional and reviewed.', pattern: /<a\b[^>]*\bhref\s*=\s*(['"])https?:\/\//i },
  { id: 'window-open', severity: 'warning', explanation: 'window.open can navigate visitors to another browsing context.', pattern: /\bwindow\.open\s*\(/ },
  { id: 'location-redirect', severity: 'warning', explanation: 'Programmatic location changes can redirect visitors.', pattern: /\b(?:window\.)?location\.(?:assign|replace)\s*\(|\b(?:window\.)?location(?:\.href)?\s*=/ },
  { id: 'cookie-access', severity: 'warning', explanation: 'Cookie access can read or alter browser state.', pattern: /\bdocument\.cookie\b/ },
  { id: 'local-storage', severity: 'warning', explanation: 'localStorage persists data in the visitor browser.', pattern: /\blocalStorage\b/ },
  { id: 'session-storage', severity: 'warning', explanation: 'sessionStorage retains data for the browsing session.', pattern: /\bsessionStorage\b/ },
]);

function finding(rule, file, line) {
  return { severity: rule.severity, file, line, ruleId: rule.id, explanation: rule.explanation };
}

export function scanContributorSourceText(file, source) {
  const findings = [];
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const rule of SECURITY_SCAN_RULES) {
      if (rule.pattern.test(line)) findings.push(finding(rule, file, index + 1));
    }
    if (/data:[^,\s]{1,200};base64,[A-Za-z0-9+/=]{4096,}/i.test(line)
      || /(['"])[A-Za-z0-9+/]{8192,}={0,2}\1/.test(line)) {
      findings.push({ severity: 'warning', file, line: index + 1, ruleId: 'large-encoded-data', explanation: 'A large encoded blob may conceal content or unnecessarily inflate source.' });
    }
    if (line.length >= 1200) {
      const whitespaceRatio = (line.match(/\s/g)?.length ?? 0) / line.length;
      const punctuationRatio = (line.match(/[^A-Za-z0-9_\s]/g)?.length ?? 0) / line.length;
      if (whitespaceRatio < 0.08 && punctuationRatio > 0.12) {
        findings.push({ severity: 'warning', file, line: index + 1, ruleId: 'obfuscated-source', explanation: 'An unusually dense long line may be minified or obfuscated.' });
      }
    }
  }
  return findings;
}

function parseChangedTargets(output) {
  const tokens = output.split('\0');
  if (tokens.at(-1) === '') tokens.pop();
  const targets = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++][0];
    if (status === 'R' || status === 'C') {
      index += 1;
      targets.push(tokens[index++]);
    } else {
      const file = tokens[index++];
      if (status !== 'D') targets.push(file);
    }
  }
  return [...new Set(targets)];
}

async function gitChangedTargets(cwd, base) {
  const result = await execFileAsync('git', [
    'diff', '--name-status', '-z', '--find-renames=50%', '--find-copies=50%', base, '--', 'src/canvas',
  ], { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  return parseChangedTargets(result.stdout);
}

export async function scanContributionSources({ base, cwd = process.cwd(), now = new Date() }) {
  if (typeof base !== 'string' || !base) throw new Error('A comparison base is required.');
  const root = resolve(cwd);
  const targets = await gitChangedTargets(root, base);
  const scannedFiles = [];
  const skippedFiles = [];
  const findings = [];
  for (const file of targets) {
    if (!isEditableCanvasPath(file) || file.includes('\\') || file.split('/').includes('..')) {
      throw new Error('Security scanner received an unsafe contributor path.');
    }
    const absolute = resolve(root, file);
    if (!absolute.startsWith(`${root}${sep}`)) throw new Error('Security scanner path escaped the repository.');
    const stats = await lstat(absolute);
    if (!stats.isFile()) {
      findings.push({ severity: 'hard-fail', file, line: null, ruleId: 'unsafe-file-type', explanation: 'Only regular contributor source files may be scanned.' });
      continue;
    }
    if (!TEXT_EXTENSIONS.has(extname(file).toLowerCase())) {
      skippedFiles.push({ file, reason: 'non-source asset' });
      continue;
    }
    if (stats.size > CONTRIBUTION_LIMITS.maxFileBytes) {
      findings.push({ severity: 'hard-fail', file, line: null, ruleId: 'unscannable-source-file', explanation: 'Source file exceeds the bounded 25 MiB scanner limit.' });
      skippedFiles.push({ file, reason: 'source file exceeds scanner safety limit' });
      continue;
    }
    if (stats.size > LARGE_SOURCE_REVIEW_BYTES) {
      findings.push({ severity: 'warning', file, line: null, ruleId: 'large-source-file', explanation: 'Source file exceeds 2 MiB and requires focused manual review.' });
    }
    const contents = await readFile(absolute);
    if (contents.includes(0)) {
      skippedFiles.push({ file, reason: 'binary content' });
      continue;
    }
    scannedFiles.push(file);
    findings.push(...scanContributorSourceText(file, contents.toString('utf8')));
  }
  return {
    schemaVersion: 1,
    reportKind: 'contributor-source-security-review',
    generatedAt: now.toISOString(),
    baseRevision: base,
    scannedFiles,
    skippedFiles,
    findings,
    summary: {
      hardFailures: findings.filter((item) => item.severity === 'hard-fail').length,
      warnings: findings.filter((item) => item.severity === 'warning').length,
    },
  };
}

export function formatSecurityScanReport(report) {
  const lines = [
    'Contributor source security review',
    '',
    `Scanned source files: ${report.scannedFiles.length}`,
    `Hard failures: ${report.summary.hardFailures}`,
    `Review warnings: ${report.summary.warnings}`,
  ];
  if (report.findings.length) {
    lines.push('', 'Findings:');
    for (const item of report.findings) {
      const safeFile = item.file
        .replace(/([\\`*_[\]<>])/g, '\\$1')
        .replace(/[\u0000-\u001f\u007f]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
      lines.push(`- [${item.severity}] ${safeFile}${item.line ? `:${item.line}` : ''} ${item.ruleId} — ${item.explanation}`);
    }
  } else {
    lines.push('', 'No scanner findings.');
  }
  lines.push('', 'This deterministic source scan is advisory except for explicit hard-fail rules and does not prove code is safe.');
  return lines.join('\n');
}
