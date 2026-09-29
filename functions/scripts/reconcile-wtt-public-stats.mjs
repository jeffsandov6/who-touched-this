import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  WTT_SOLANA_RPC_DEFAULT,
  validateWttSolanaRpcUrl,
} from '../lib/src/wtt/config.js';
import { firestorePublicWttStatsStore } from '../lib/src/wtt/firestore-public-stats.js';
import { reconcilePublicWttStats } from '../lib/src/wtt/public-stats.js';
import { MainnetWttSupplyReader } from '../lib/src/wtt/solana-supply.js';

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
const rpcUrl = validateWttSolanaRpcUrl(
  process.env.WTT_SOLANA_RPC_URL ?? WTT_SOLANA_RPC_DEFAULT,
);
if (getApps().length === 0) initializeApp({ projectId });
const firestore = getFirestore();

const report = await reconcilePublicWttStats(apply, new Date(), {
  store: firestorePublicWttStatsStore(firestore),
  supply: new MainnetWttSupplyReader(rpcUrl),
});

console.log(`WTT public stats reconciliation (${report.mode})`);
console.log(`storedStatus=${report.storedStatus} differences=${report.differences.join(',') || 'none'}`);
console.log(`stored=${report.stored ? JSON.stringify(report.stored) : 'none'}`);
console.log(`expected=${JSON.stringify(report.expected)}`);
console.log(`applied=${report.applied} write=${report.write}`);
