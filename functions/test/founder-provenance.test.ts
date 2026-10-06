import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import {
  WTT_DECIMALS,
  WTT_MINT_ADDRESS,
  WTT_OPERATIONAL_AUTHORITY,
  WTT_OPERATIONAL_MINIMUM_LAMPORTS,
  WTT_SOLANA_NETWORK,
  WTT_TOKEN_PROGRAM_ADDRESS,
} from '../src/wtt/config.js';
import {
  FOUNDER_ATA,
  FOUNDER_PROVENANCE_CONFIRMATION_FLAG,
  FOUNDER_PROVENANCE_MEMO,
  FOUNDER_WALLET,
  FounderProvenanceError,
  ORIGINAL_FOUNDER_CLAIM_SIGNATURE,
  SOLANA_MAINNET_GENESIS_HASH,
  assertFounderMemoOnlyTransaction,
  createFounderProvenanceInstruction,
  findSuccessfulFounderProvenanceDuplicate,
  hasExactFounderProvenanceConfirmation,
  validateFounderProvenancePostSend,
  validateFounderProvenancePreflight,
  validateFounderProvenanceFee,
  type FounderProvenancePostSend,
  type FounderProvenancePreflight,
} from '../src/wtt/founder-provenance.js';
import { WTT_MEMO_PROGRAM_ID } from '../src/wtt/solana-claims.js';
import { inspectOriginalClaimTransaction } from '../src/wtt/founder-provenance-rpc.js';

function validPreflight(): FounderProvenancePreflight {
  return {
    network: WTT_SOLANA_NETWORK,
    genesisHash: SOLANA_MAINNET_GENESIS_HASH,
    mint: {
      address: WTT_MINT_ADDRESS,
      programAddress: WTT_TOKEN_PROGRAM_ADDRESS,
      decimals: WTT_DECIMALS,
      isInitialized: true,
      supply: 1n,
      mintAuthority: WTT_OPERATIONAL_AUTHORITY,
      freezeAuthority: WTT_OPERATIONAL_AUTHORITY,
    },
    ata: {
      address: FOUNDER_ATA,
      programAddress: WTT_TOKEN_PROGRAM_ADDRESS,
      mintAddress: WTT_MINT_ADDRESS,
      ownerAddress: FOUNDER_WALLET,
      amount: 1n,
      isInitialized: true,
      isFrozen: true,
    },
    originalClaim: {
      signature: ORIGINAL_FOUNDER_CLAIM_SIGNATURE,
      succeeded: true,
      mintOperations: [{
        mintAddress: WTT_MINT_ADDRESS,
        ataAddress: FOUNDER_ATA,
        authorityAddress: WTT_OPERATIONAL_AUTHORITY,
        amount: 1n,
        decimals: 0,
      }],
      memos: [],
    },
    authorityBalanceLamports: WTT_OPERATIONAL_MINIMUM_LAMPORTS + 10_000,
    kmsPublicKey: WTT_OPERATIONAL_AUTHORITY,
  };
}

function validPost(): FounderProvenancePostSend {
  const preflight = validPreflight();
  return {
    succeeded: true,
    feePayer: WTT_OPERATIONAL_AUTHORITY,
    signerAddresses: [WTT_OPERATIONAL_AUTHORITY],
    instructions: [{
      programId: WTT_MEMO_PROGRAM_ID.toBase58(),
      data: FOUNDER_PROVENANCE_MEMO,
      signerAddresses: [WTT_OPERATIONAL_AUTHORITY],
    }],
    mint: preflight.mint,
    ata: preflight.ata,
  };
}

test('Founder #000 provenance memo text is exact and identifies the original claim', () => {
  assert.equal(FOUNDER_PROVENANCE_MEMO,
    'who touched this | provenance for contribution #000 | https://whotouchedthis.website/history/0 | original WTT claim: 37KoKvEXBuzCXStqkFts7ZbJUS3yLCqZRnKSW2KWC3PJ33YBd3ZMK7SH3EWrN8NqULpP2aoYBV84EVbHhcap9k7F');
});

test('configured Founder ATA is canonical for the official mint and recipient', () => {
  assert.equal(getAssociatedTokenAddressSync(
    new PublicKey(WTT_MINT_ADDRESS),
    new PublicKey(FOUNDER_WALLET),
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  ).toBase58(), FOUNDER_ATA);
});

test('exact confirmation flag is mandatory and cannot be assigned or duplicated', () => {
  assert.equal(hasExactFounderProvenanceConfirmation([FOUNDER_PROVENANCE_CONFIRMATION_FLAG]), true);
  assert.equal(hasExactFounderProvenanceConfirmation([]), false);
  assert.equal(hasExactFounderProvenanceConfirmation(['--confirm-mainnet-provenance=true']), false);
  assert.equal(hasExactFounderProvenanceConfirmation([
    FOUNDER_PROVENANCE_CONFIRMATION_FLAG, FOUNDER_PROVENANCE_CONFIRMATION_FLAG,
  ]), false);
});

test('transaction contains only the signed provenance Memo instruction', () => {
  const authority = new PublicKey(WTT_OPERATIONAL_AUTHORITY);
  const instruction = createFounderProvenanceInstruction();
  const transaction = new Transaction({
    feePayer: authority,
    blockhash: Keypair.generate().publicKey.toBase58(),
    lastValidBlockHeight: 123,
  }).add(instruction);
  assert.doesNotThrow(() => assertFounderMemoOnlyTransaction(transaction));
  assert.equal(transaction.instructions.length, 1);
  assert.equal(instruction.programId.toBase58(), 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
  assert.deepEqual(instruction.keys.map(({ pubkey, isSigner, isWritable }) => ({
    pubkey: pubkey.toBase58(), isSigner, isWritable,
  })), [{ pubkey: WTT_OPERATIONAL_AUTHORITY, isSigner: true, isWritable: false }]);
  assert.equal(transaction.feePayer?.toBase58(), WTT_OPERATIONAL_AUTHORITY);
});

test('duplicate detection returns only a successful exact memo transaction', () => {
  assert.equal(findSuccessfulFounderProvenanceDuplicate([
    { signature: 'failed', succeeded: false, memos: [FOUNDER_PROVENANCE_MEMO] },
    { signature: 'different', succeeded: true, memos: ['different memo'] },
    { signature: 'existing', succeeded: true, memos: [FOUNDER_PROVENANCE_MEMO] },
  ]), 'existing');
  assert.equal(findSuccessfulFounderProvenanceDuplicate([
    { signature: 'different', succeeded: true, memos: ['different memo'] },
  ]), null);
});

test('preflight accepts only supply one and the exact frozen Founder ATA', () => {
  assert.doesNotThrow(() => validateFounderProvenancePreflight(validPreflight()));
  for (const invalid of [
    { ...validPreflight(), mint: { ...validPreflight().mint, supply: 2n } },
    { ...validPreflight(), mint: { ...validPreflight().mint, decimals: 9 } },
    { ...validPreflight(), mint: { ...validPreflight().mint, mintAuthority: 'wrong' } },
    { ...validPreflight(), mint: { ...validPreflight().mint, freezeAuthority: 'wrong' } },
    { ...validPreflight(), ata: { ...validPreflight().ata, ownerAddress: Keypair.generate().publicKey.toBase58() } },
    { ...validPreflight(), ata: { ...validPreflight().ata, mintAddress: Keypair.generate().publicKey.toBase58() } },
    { ...validPreflight(), ata: { ...validPreflight().ata, amount: 0n } },
    { ...validPreflight(), ata: { ...validPreflight().ata, isFrozen: false } },
    { ...validPreflight(), network: 'devnet' },
    { ...validPreflight(), genesisHash: 'wrong' },
    { ...validPreflight(), kmsPublicKey: 'wrong' },
    { ...validPreflight(), authorityBalanceLamports: WTT_OPERATIONAL_MINIMUM_LAMPORTS },
  ]) assert.throws(() => validateFounderProvenancePreflight(invalid), FounderProvenanceError);
});

test('fee must preserve the configured operational SOL minimum', () => {
  assert.doesNotThrow(() => validateFounderProvenanceFee(
    WTT_OPERATIONAL_MINIMUM_LAMPORTS + 5_000, 5_000,
  ));
  assert.throws(() => validateFounderProvenanceFee(
    WTT_OPERATIONAL_MINIMUM_LAMPORTS + 4_999, 5_000,
  ), FounderProvenanceError);
});

test('preflight rejects failed, wrong, duplicate-memo, or incorrectly minted original claims', () => {
  const base = validPreflight();
  for (const originalClaim of [
    { ...base.originalClaim, succeeded: false },
    { ...base.originalClaim, signature: 'wrong' },
    { ...base.originalClaim, memos: [FOUNDER_PROVENANCE_MEMO] },
    { ...base.originalClaim, mintOperations: [] },
    { ...base.originalClaim, mintOperations: [{ ...base.originalClaim.mintOperations[0]!, amount: 2n }] },
    { ...base.originalClaim, mintOperations: [{ ...base.originalClaim.mintOperations[0]!, ataAddress: 'wrong' }] },
  ]) assert.throws(
    () => validateFounderProvenancePreflight({ ...base, originalClaim }),
    FounderProvenanceError,
  );
});

test('original claim inspection extracts the exact parsed WTT mint operation', () => {
  const inspected = inspectOriginalClaimTransaction({
    meta: { err: null, innerInstructions: [] },
    transaction: { message: { instructions: [{
      programId: new PublicKey(WTT_TOKEN_PROGRAM_ADDRESS),
      parsed: {
        type: 'mintToChecked',
        info: {
          mint: WTT_MINT_ADDRESS,
          account: FOUNDER_ATA,
          mintAuthority: WTT_OPERATIONAL_AUTHORITY,
          tokenAmount: { amount: '1', decimals: 0 },
        },
      },
    }] } },
  });
  assert.deepEqual(inspected.mintOperations, [{
    mintAddress: WTT_MINT_ADDRESS,
    ataAddress: FOUNDER_ATA,
    authorityAddress: WTT_OPERATIONAL_AUTHORITY,
    amount: 1n,
    decimals: 0,
  }]);
  assert.equal(inspected.succeeded, true);
});

test('post-send verification rechecks exact instruction and unchanged WTT state', () => {
  assert.doesNotThrow(() => validateFounderProvenancePostSend(validPost()));
  for (const invalid of [
    { ...validPost(), mint: { ...validPost().mint, supply: 2n } },
    { ...validPost(), ata: { ...validPost().ata, amount: 2n } },
    { ...validPost(), ata: { ...validPost().ata, isFrozen: false } },
    { ...validPost(), instructions: [] },
    { ...validPost(), feePayer: 'wrong' },
  ]) assert.throws(() => validateFounderProvenancePostSend(invalid), FounderProvenanceError);
});

test('operational script reuses KMS signing and contains no state-mutation integrations', async () => {
  const [script, provenance, rpc] = await Promise.all([
    readFile(new URL('../../scripts/send-founder-000-provenance.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../src/wtt/founder-provenance.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../src/wtt/founder-provenance-rpc.ts', import.meta.url), 'utf8'),
  ]);
  const combined = `${script}\n${provenance}\n${rpc}`;
  assert.match(script, /new GoogleKmsWttMessageSigner\(\)/);
  assert.match(script, /buildExternallySignedTransaction/);
  assert.doesNotMatch(combined, /firebase-admin\/firestore|getFirestore|wttEntitlements|wttClaims|publicWttStats/);
  assert.doesNotMatch(combined, /createMintTo|createTransfer|createThaw|createFreeze|createAssociatedToken/);
  assert.doesNotMatch(combined, /SystemProgram|createUpdateMetadata|metadata update/i);
  assert.doesNotMatch(combined, /Keypair|secretKey|private key/i);
  assert.equal((script.match(/sendOnce\(/g) ?? []).length, 1);
  assert.ok(script.indexOf('if (!hasExactFounderProvenanceConfirmation')
    < script.indexOf('new GoogleKmsWttMessageSigner()'));
  assert.ok(script.indexOf('if (duplicate)')
    < script.indexOf('const signed = await buildExternallySignedTransaction'));
  assert.ok(script.indexOf('const duplicateBeforeSend = await rpc.findDuplicateMemo()')
    < script.indexOf('const signature = await rpc.sendOnce(raw)'));
  const packageJson = JSON.parse(await readFile(
    new URL('../../package.json', import.meta.url), 'utf8',
  )) as { scripts: Record<string, string> };
  assert.match(packageJson.scripts['wtt:founder-provenance'] ?? '', /send-founder-000-provenance\.mjs/);
});
