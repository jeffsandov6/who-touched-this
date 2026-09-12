#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { formatSecurityScanReport, scanContributionSources } from './security/contribution-source-scan.mjs';

function value(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

try {
  const base = value('--base');
  const reportPath = value('--report');
  const summaryPath = value('--summary');
  if (!base || !reportPath) throw new Error('Usage: --base <SHA> --report <path> [--summary <path>]');
  const report = await scanContributionSources({ base });
  const formatted = formatSecurityScanReport(report);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  if (summaryPath) await writeFile(summaryPath, `## Security review\n\n${formatted}\n`, { flag: 'a' });
  console.log(formatted);
  if (report.summary.hardFailures > 0) process.exitCode = 1;
} catch (error) {
  console.error(`Contributor source security review failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
}
