import {
  buildContributionEntitlement,
  contributionEntitlementId,
  validateExistingContributionEntitlement,
  type GrantContributionEntitlementResult,
} from './entitlements.js';

export interface WttContributionSource {
  id: string;
  data: Record<string, unknown>;
}

export interface WttEntitlementReconciliationDependencies {
  listContributions(): Promise<WttContributionSource[]>;
  loadEntitlement(id: string): Promise<Record<string, unknown> | null>;
  grant(id: string, contribution: Record<string, unknown>): Promise<GrantContributionEntitlementResult>;
}

export interface WttEntitlementReconciliationReport {
  mode: 'dry-run' | 'apply';
  scanned: number;
  present: number;
  missing: number;
  created: number;
  malformedContributions: Array<{ contributionId: string; reason: string }>;
  conflictingEntitlements: Array<{ entitlementId: string; reason: string }>;
}

export class WttEntitlementReconciliationError extends Error {
  constructor(
    message: string,
    public readonly report: WttEntitlementReconciliationReport,
  ) {
    super(message);
    this.name = 'WttEntitlementReconciliationError';
  }
}

export async function reconcileContributionEntitlements(
  apply: boolean,
  dependencies: WttEntitlementReconciliationDependencies,
): Promise<WttEntitlementReconciliationReport> {
  const contributions = await dependencies.listContributions();
  const report: WttEntitlementReconciliationReport = {
    mode: apply ? 'apply' : 'dry-run',
    scanned: contributions.length,
    present: 0,
    missing: 0,
    created: 0,
    malformedContributions: [],
    conflictingEntitlements: [],
  };
  const missing: WttContributionSource[] = [];
  const seenContributionIds = new Set<string>();

  for (const contribution of contributions) {
    if (seenContributionIds.has(contribution.id)) {
      report.malformedContributions.push({
        contributionId: contribution.id,
        reason: 'duplicate contribution identifier returned by the source',
      });
      continue;
    }
    seenContributionIds.add(contribution.id);
    const expected = buildContributionEntitlement(contribution.id, contribution.data);
    if (!expected) {
      report.malformedContributions.push({
        contributionId: contribution.id,
        reason: 'contribution cannot produce a canonical WTT entitlement',
      });
      continue;
    }
    const entitlementId = contributionEntitlementId(contribution.data.number as number);
    const existing = await dependencies.loadEntitlement(entitlementId);
    if (!existing) {
      report.missing += 1;
      missing.push(contribution);
      continue;
    }
    const validation = validateExistingContributionEntitlement(expected, existing);
    if (!validation.valid) {
      report.conflictingEntitlements.push({ entitlementId, reason: validation.reason });
      continue;
    }
    report.present += 1;
  }

  if (report.malformedContributions.length > 0 || report.conflictingEntitlements.length > 0) {
    throw new WttEntitlementReconciliationError(
      'reconciliation refused because authoritative or entitlement records are inconsistent',
      report,
    );
  }
  if (!apply) return report;

  for (const contribution of missing) {
    const result = await dependencies.grant(contribution.id, contribution.data);
    if (result.status === 'ineligible') {
      throw new WttEntitlementReconciliationError(
        `contribution ${contribution.id} became ineligible during apply`, report,
      );
    }
    if (result.status === 'created') report.created += 1;
  }
  return report;
}
