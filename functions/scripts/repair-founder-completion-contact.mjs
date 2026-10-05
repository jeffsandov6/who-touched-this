import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { prepareFounderContactRepair } from '../lib/src/founder/repair-contact.js';

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? null;
}

const EXPECTED_PROJECT_ID = 'who-touched-this';

const projectId = option('project');
const email = option('email');
const apply = process.argv.includes('--apply');
const confirmation = option('confirm-project');

if (projectId !== EXPECTED_PROJECT_ID) {
  throw new Error(`Refusing to run outside Firebase project ${EXPECTED_PROJECT_ID}.`);
}

if (!email) throw new Error('Pass the Founder contact address with --email=<address>.');

if (apply && confirmation !== EXPECTED_PROJECT_ID) {
  throw new Error(`Apply mode requires --confirm-project=${EXPECTED_PROJECT_ID}.`);
}

if (getApps().length === 0) initializeApp({ projectId });
const firestore = getFirestore();
const contributionSnapshot = await firestore.doc('contributions/0').get();
const contribution = contributionSnapshot.exists ? contributionSnapshot.data() ?? null : null;
const githubUserId = typeof contribution?.githubUserId === 'string'
  ? contribution.githubUserId
  : 'invalid';
const adminSnapshot = /^[0-9]+$/.test(githubUserId)
  ? await firestore.doc(`admins/${githubUserId}`).get()
  : null;
const admin = adminSnapshot?.exists ? adminSnapshot.data() ?? null : null;
const repair = prepareFounderContactRepair(
  contribution,
  admin,
  email,
  FieldValue.serverTimestamp(),
);

console.log(`Founder completion contact repair (${apply ? 'apply' : 'dry-run'})`);
console.log(`project=${projectId} admin=admins/${repair.githubUserId}`);
console.log('write fields=founderCompletionEmail,founderCompletionEmailUpdatedAt');
if (apply) {
  await firestore.doc(`admins/${repair.githubUserId}`).update(repair.fields);
  console.log('updated=1');
} else {
  console.log('updated=0; pass --apply and the exact --confirm-project value to write');
}
