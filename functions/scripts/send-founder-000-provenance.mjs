import { PublicKey, Transaction } from '@solana/web3.js';
import {
  WTT_MINT_ADDRESS,
  WTT_OPERATIONAL_AUTHORITY,
  WTT_OPERATIONAL_MINIMUM_LAMPORTS,
  WTT_SOLANA_RPC_DEFAULT,
  validateWttSolanaRpcUrl,
} from '../lib/src/wtt/config.js';
import {
  FOUNDER_ATA,
  FOUNDER_PROVENANCE_CONFIRMATION_FLAG,
  FOUNDER_PROVENANCE_MEMO,
  FOUNDER_WALLET,
  ORIGINAL_FOUNDER_CLAIM_SIGNATURE,
  assertFounderMemoOnlySignedTransaction,
  assertFounderMemoOnlyTransaction,
  createFounderProvenanceInstruction,
  hasExactFounderProvenanceConfirmation,
  validateFounderProvenancePostSend,
  validateFounderProvenancePreflight,
  validateFounderProvenanceFee,
} from '../lib/src/wtt/founder-provenance.js';
import { FounderProvenanceRpc } from '../lib/src/wtt/founder-provenance-rpc.js';
import { GoogleKmsWttMessageSigner } from '../lib/src/wtt/kms-signer.js';
import { buildExternallySignedTransaction } from '../lib/src/wtt/solana-claims.js';

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? null;
}

const args = process.argv.slice(2);
const projectId = option('project');
const allowedArguments = new Set([
  '--project=who-touched-this',
  FOUNDER_PROVENANCE_CONFIRMATION_FLAG,
]);
if (projectId !== 'who-touched-this') {
  throw new Error('Refusing to continue without --project=who-touched-this.');
}
if (!hasExactFounderProvenanceConfirmation(args)
  || args.some((argument) => !allowedArguments.has(argument))) {
  throw new Error(`Refusing to sign or send without the exact ${FOUNDER_PROVENANCE_CONFIRMATION_FLAG} confirmation.`);
}

const rpcUrl = validateWttSolanaRpcUrl(
  process.env.WTT_SOLANA_RPC_URL ?? WTT_SOLANA_RPC_DEFAULT,
);
const signer = new GoogleKmsWttMessageSigner();
const kmsPublicKey = new PublicKey(await signer.getPublicKeyBytes()).toBase58();
const rpc = new FounderProvenanceRpc(rpcUrl);
const preflight = await rpc.loadPreflight(kmsPublicKey);
validateFounderProvenancePreflight(preflight);

const duplicate = await rpc.findDuplicateMemo();
if (duplicate) {
  console.log('Founder #000 provenance memo is already confirmed; no transaction was sent.');
  console.log(`signature=${duplicate}`);
  console.log(`explorer=https://explorer.solana.com/tx/${duplicate}`);
  process.exit(0);
}

const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash();
const instruction = createFounderProvenanceInstruction();
const unsigned = new Transaction({
  feePayer: new PublicKey(WTT_OPERATIONAL_AUTHORITY),
  blockhash,
  lastValidBlockHeight,
}).add(instruction);
assertFounderMemoOnlyTransaction(unsigned);
const feeLamports = await rpc.estimateFee(unsigned);
validateFounderProvenanceFee(preflight.authorityBalanceLamports, feeLamports);

console.log('Founder Contribution #000 provenance preflight passed.');
console.log('network=mainnet-beta');
console.log(`mint=${WTT_MINT_ADDRESS}`);
console.log(`founderWallet=${FOUNDER_WALLET}`);
console.log(`ata=${FOUNDER_ATA}`);
console.log(`supply=${preflight.mint.supply.toString()}`);
console.log(`balance=${preflight.ata.amount.toString()}`);
console.log(`frozen=${String(preflight.ata.isFrozen)}`);
console.log(`originalClaim=${ORIGINAL_FOUNDER_CLAIM_SIGNATURE}`);
console.log(`memo=${FOUNDER_PROVENANCE_MEMO}`);
console.log(`operationalAuthority=${WTT_OPERATIONAL_AUTHORITY}`);
console.log(`authorityBalanceLamports=${preflight.authorityBalanceLamports}`);
console.log(`requiredMinimumLamports=${WTT_OPERATIONAL_MINIMUM_LAMPORTS}`);
console.log(`estimatedFeeLamports=${feeLamports}`);

const signed = await buildExternallySignedTransaction({
  authority: new PublicKey(WTT_OPERATIONAL_AUTHORITY),
  instructions: [instruction],
  blockhash,
  lastValidBlockHeight,
  signer,
});
const raw = Buffer.from(signed.rawTransactionBase64, 'base64');
assertFounderMemoOnlySignedTransaction(Transaction.from(raw));
const duplicateBeforeSend = await rpc.findDuplicateMemo();
if (duplicateBeforeSend) {
  console.log('Founder #000 provenance memo was confirmed during preparation; no transaction was sent.');
  console.log(`signature=${duplicateBeforeSend}`);
  console.log(`explorer=https://explorer.solana.com/tx/${duplicateBeforeSend}`);
  process.exit(0);
}
await rpc.simulate(raw);
const signature = await rpc.sendOnce(raw);
if (signature !== signed.transactionSignature) {
  throw new Error('Solana RPC returned an unexpected transaction signature.');
}
await rpc.confirm(signature, blockhash, lastValidBlockHeight);
validateFounderProvenancePostSend(await rpc.loadPostSend(signature));

console.log('Founder #000 provenance Memo transaction confirmed and post-send invariants passed.');
console.log(`signature=${signature}`);
console.log(`explorer=https://explorer.solana.com/tx/${signature}`);
