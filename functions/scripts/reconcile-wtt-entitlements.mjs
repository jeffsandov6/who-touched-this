import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { ensureFirestoreContributionEntitlement } from '../lib/src/wtt/firestore-entitlements.js';
import {
  reconcileContributionEntitlements,
  WttEntitlementReconciliationError,
} from '../lib/src/wtt/reconcile-entitlements.js';

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? null;
}

const projectId = option('project');
const apply = process.argv.includes('--apply');
const confirmation = option('confirm-project');
if (!projectId || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
  throw new Error('Pass an explicit Firebase project with --project=<project-id>.');
}
if (apply && confirmation !== projectId) {
  throw new Error('Apply mode requires --confirm-project=<the exact project id>.');
}
if (getApps().length === 0) initializeApp({ projectId });
const firestore = getFirestore();

const dependencies = {
  async listContributions() {
    const snapshot = await firestore.collection('contributions').get();
    return snapshot.docs.map((document) => ({ id: document.id, data: document.data() }));
  },
  async loadEntitlement(id) {
    const snapshot = await firestore.doc(`wttEntitlements/${id}`).get();
    return snapshot.exists ? snapshot.data() : null;
  },
  grant: (id, contribution) => ensureFirestoreContributionEntitlement(
    firestore, id, contribution,
  ),
};

function printReport(report) {
  console.log(`WTT entitlement reconciliation (${report.mode})`);
  console.log(`scanned=${report.scanned} present=${report.present} missing=${report.missing} created=${report.created}`);
  for (const item of report.malformedContributions) {
    console.log(`MALFORMED contribution/${item.contributionId}: ${item.reason}`);
  }
  for (const item of report.conflictingEntitlements) {
    console.log(`CONFLICT wttEntitlements/${item.entitlementId}: ${item.reason}`);
  }
}

try {
  const report = await reconcileContributionEntitlements(apply, dependencies);
  printReport(report);
} catch (error) {
  if (error instanceof WttEntitlementReconciliationError) printReport(error.report);
  throw error;
}
