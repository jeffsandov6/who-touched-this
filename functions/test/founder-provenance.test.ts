import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
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
  assertFounderMemoOnlySignedTransaction,
  assertFounderMemoOnlyTransaction,
  createFounderProvenanceInstruction,
  findSuccessfulFounderProvenanceDuplicate,
  hasExactFounderProvenanceConfirmation,
  runFounderProvenanceSendGate,
  validateFounderProvenancePostSend,
  validateFounderProvenancePreflight,
  validateFounderProvenanceFee,
  type FounderProvenancePostSend,
  type FounderProvenancePreflight,
} from '../src/wtt/founder-provenance.js';
import { WTT_MEMO_PROGRAM_ID } from '../src/wtt/solana-claims.js';
import {
  inspectOriginalClaimTransaction,
  scanFounderDuplicateDelta,
  scanFounderDuplicateHistory,
  withFounderRpcRateLimitRetry,
  type FounderDuplicateHistoryReader,
} from '../src/wtt/founder-provenance-rpc.js';

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

function roundTripWithTestSignatures(transaction: Transaction): Transaction {
  transaction.serializeMessage();
  for (const { publicKey } of transaction.signatures) {
    transaction.addSignature(publicKey, Buffer.alloc(64, 1));
  }
  return Transaction.from(transaction.serialize({
    requireAllSignatures: true,
    verifySignatures: false,
  }));
}

function parsedMemoTransaction(memo: string | null = null): unknown {
  return {
    meta: { err: null, innerInstructions: [] },
    transaction: { message: { instructions: memo === null ? [] : [{
      programId: WTT_MEMO_PROGRAM_ID,
      parsed: memo,
    }] } },
  };
}

test('Founder #000 provenance memo text is exact and identifies the original claim', () => {
  assert.equal(FOUNDER_PROVENANCE_MEMO,
    'who touched this | provenance for contribution #000 | https://whotouchedthis.website/history/0 | original WTT claim: 37KoKvEXBuzCXStqkFts7ZbJUS3yLCqZRnKSW2KWC3PJ33YBd3ZMK7SH3EWrN8NqULpP2aoYBV84EVbHhcap9k7F');
});

test('Solana mainnet-beta genesis hash is the full canonical value', () => {
  assert.equal(
    SOLANA_MAINNET_GENESIS_HASH,
    '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  );
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

test('signed transaction accepts only fee-payer writability introduced by message compilation', () => {
  const authority = new PublicKey(WTT_OPERATIONAL_AUTHORITY);
  const blockhash = Keypair.generate().publicKey.toBase58();
  const transaction = new Transaction({
    feePayer: authority,
    blockhash,
    lastValidBlockHeight: 123,
  }).add(createFounderProvenanceInstruction());
  const reconstructed = roundTripWithTestSignatures(transaction);

  assert.equal(reconstructed.instructions[0]!.keys[0]!.isWritable, true);
  assert.doesNotThrow(() => assertFounderMemoOnlySignedTransaction(reconstructed));

  const exactMemo = Buffer.from(FOUNDER_PROVENANCE_MEMO, 'utf8');
  const memoInstruction = (overrides: Partial<{
    programId: PublicKey;
    data: Buffer;
    keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[];
  }> = {}) => new TransactionInstruction({
    programId: WTT_MEMO_PROGRAM_ID,
    data: exactMemo,
    keys: [{ pubkey: authority, isSigner: true, isWritable: false }],
    ...overrides,
  });
  const roundTrip = (
    instructions: TransactionInstruction[],
    feePayer: PublicKey = authority,
  ) => roundTripWithTestSignatures(new Transaction({
    feePayer,
    blockhash,
    lastValidBlockHeight: 123,
  }).add(...instructions));
  const extraAccount = Keypair.generate().publicKey;

  for (const invalid of [
    roundTrip([memoInstruction(), memoInstruction()]),
    roundTrip([SystemProgram.transfer({
      fromPubkey: authority,
      toPubkey: extraAccount,
      lamports: 1,
    })]),
    roundTrip([memoInstruction({ programId: TOKEN_PROGRAM_ID })]),
    roundTrip([memoInstruction({ programId: SystemProgram.programId })]),
    roundTrip([memoInstruction({ data: Buffer.from('altered memo', 'utf8') })]),
    roundTrip([memoInstruction()], Keypair.generate().publicKey),
    roundTrip([memoInstruction({
      keys: [
        { pubkey: authority, isSigner: true, isWritable: false },
        { pubkey: extraAccount, isSigner: false, isWritable: false },
      ],
    })]),
  ]) assert.throws(
    () => assertFounderMemoOnlySignedTransaction(invalid),
    FounderProvenanceError,
  );

  const wrongSigner = new Transaction({
    feePayer: authority,
    blockhash,
    lastValidBlockHeight: 123,
  }).add(memoInstruction({
    keys: [{ pubkey: authority, isSigner: false, isWritable: false }],
  }));
  const writableInstruction = new Transaction({
    feePayer: authority,
    blockhash,
    lastValidBlockHeight: 123,
  }).add(memoInstruction({
    keys: [{ pubkey: authority, isSigner: true, isWritable: true }],
  }));
  assert.throws(() => assertFounderMemoOnlyTransaction(wrongSigner), FounderProvenanceError);
  assert.throws(() => assertFounderMemoOnlyTransaction(writableInstruction), FounderProvenanceError);
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

test('initial duplicate scan searches to the Founder claim and establishes the newest checkpoint', async () => {
  const parsedRequests: string[][] = [];
  const reader: FounderDuplicateHistoryReader = {
    async loadSignatures() {
      return [
        { signature: 'newest-at-scan-start', err: null },
        { signature: 'older', err: null },
        { signature: ORIGINAL_FOUNDER_CLAIM_SIGNATURE, err: null },
      ];
    },
    async loadParsedTransactions(signatures) {
      parsedRequests.push([...signatures]);
      return signatures.map(() => parsedMemoTransaction());
    },
  };

  assert.deepEqual(await scanFounderDuplicateHistory(reader), {
    duplicateSignature: null,
    checkpointSignature: 'newest-at-scan-start',
  });
  assert.deepEqual(parsedRequests.flat(), [
    'newest-at-scan-start',
    'older',
    ORIGINAL_FOUNDER_CLAIM_SIGNATURE,
  ]);
});

test('unchanged duplicate checkpoint avoids another parsed-transaction scan', async () => {
  let parsedCalls = 0;
  const reader: FounderDuplicateHistoryReader = {
    async loadSignatures(options) {
      assert.deepEqual(options, { limit: 1 });
      return [{ signature: 'checkpoint', err: null }];
    },
    async loadParsedTransactions() {
      parsedCalls += 1;
      return [];
    },
  };

  assert.equal(await scanFounderDuplicateDelta(reader, 'checkpoint'), null);
  assert.equal(parsedCalls, 0);
});

test('post-sign duplicate scan parses only signatures newer than its checkpoint', async () => {
  let signatureCalls = 0;
  const parsedRequests: string[][] = [];
  const reader: FounderDuplicateHistoryReader = {
    async loadSignatures() {
      signatureCalls += 1;
      return signatureCalls === 1
        ? [{ signature: 'delta-2', err: null }]
        : [
          { signature: 'delta-2', err: null },
          { signature: 'delta-1', err: null },
          { signature: 'checkpoint', err: null },
          { signature: 'older-must-not-be-inspected', err: null },
        ];
    },
    async loadParsedTransactions(signatures) {
      parsedRequests.push([...signatures]);
      return signatures.map(() => parsedMemoTransaction());
    },
  };

  assert.equal(await scanFounderDuplicateDelta(reader, 'checkpoint'), null);
  assert.deepEqual(parsedRequests.flat(), ['delta-2', 'delta-1']);
});

test('exact duplicate in the delta stops before simulation or broadcast', async () => {
  let signatureCalls = 0;
  let simulated = false;
  let sent = false;
  const reader: FounderDuplicateHistoryReader = {
    async loadSignatures() {
      signatureCalls += 1;
      return signatureCalls === 1
        ? [{ signature: 'duplicate', err: null }]
        : [
          { signature: 'duplicate', err: null },
          { signature: 'checkpoint', err: null },
        ];
    },
    async loadParsedTransactions(signatures) {
      return signatures.map(() => parsedMemoTransaction(FOUNDER_PROVENANCE_MEMO));
    },
  };

  assert.deepEqual(await runFounderProvenanceSendGate({
    findDuplicate: () => scanFounderDuplicateDelta(reader, 'checkpoint'),
    simulate: async () => { simulated = true; },
    send: async () => { sent = true; return 'sent'; },
  }), { status: 'duplicate', signature: 'duplicate' });
  assert.equal(simulated, false);
  assert.equal(sent, false);
});

test('429 retry honors Retry-After, uses bounded backoff, and eventually succeeds', async () => {
  let attempts = 0;
  const delays: number[] = [];
  const result = await withFounderRpcRateLimitRetry(async () => {
    attempts += 1;
    if (attempts === 1) {
      throw Object.assign(new Error('429 Too many requests'), { status: 429 });
    }
    if (attempts === 2) {
      throw Object.assign(new Error('rate limited'), {
        response: { status: 429, headers: { 'retry-after': '0.02' } },
      });
    }
    return 'ok';
  }, {
    maxRetries: 3,
    baseDelayMs: 5,
    maxDelayMs: 25,
    sleep: async (delayMs) => { delays.push(delayMs); },
  });

  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [5, 20]);
});

test('exhausted 429 retries fail closed and duplicate-check errors prevent broadcast', async () => {
  let attempts = 0;
  const delays: number[] = [];
  const verification = () => withFounderRpcRateLimitRetry(async () => {
    attempts += 1;
    throw Object.assign(new Error('429 Too many requests'), { statusCode: 429 });
  }, {
    maxRetries: 2,
    baseDelayMs: 5,
    maxDelayMs: 10,
    sleep: async (delayMs) => { delays.push(delayMs); },
  });
  let simulated = false;
  let sent = false;

  await assert.rejects(runFounderProvenanceSendGate({
    findDuplicate: verification,
    simulate: async () => { simulated = true; },
    send: async () => { sent = true; return 'sent'; },
  }), /429 Too many requests/);
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [5, 10]);
  assert.equal(simulated, false);
  assert.equal(sent, false);
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
  assert.ok(script.indexOf('const duplicateScan = await rpc.scanDuplicateMemoHistory()')
    < script.indexOf('const signed = await buildExternallySignedTransaction'));
  assert.ok(script.indexOf('findDuplicate: () => rpc.findDuplicateMemoSince')
    < script.indexOf('send: () => rpc.sendOnce(raw)'));
  assert.match(script, /runFounderProvenanceSendGate/);
  const packageJson = JSON.parse(await readFile(
    new URL('../../package.json', import.meta.url), 'utf8',
  )) as { scripts: Record<string, string> };
  assert.match(packageJson.scripts['wtt:founder-provenance'] ?? '', /send-founder-000-provenance\.mjs/);
});
