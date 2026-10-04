import assert from 'node:assert/strict';
import test from 'node:test';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  WTT_DECIMALS,
  WTT_MINT_ADDRESS,
  WTT_OPERATIONAL_AUTHORITY,
  WTT_TOKEN_PROGRAM_ADDRESS,
} from '../src/wtt/config.js';
import {
  assertWttMintInvariants,
  assertWttTokenAccountInvariants,
  attemptIsDefinitivelyExpired,
  buildWttContributionMemo,
  buildExternallySignedTransaction,
  createWttClaimInstructions,
  createWttClaimMemoInstructions,
  validatePreparedTransaction,
  WTT_MEMO_PROGRAM_ID,
  wttClaimAmount,
} from '../src/wtt/solana-claims.js';
import { WttClaimError } from '../src/wtt/claims.js';

const wallet = Keypair.generate().publicKey.toBase58();
const appOrigin = 'https://whotouchedthis.website';
const entitlementIds = ['contribution:12'];

function expectPrecondition(operation: () => unknown) {
  assert.throws(operation, (error) => error instanceof WttClaimError
    && error.code === 'failed-precondition');
}

test('missing ATA uses create-idempotent, mint-checked, freeze in one ordered instruction list', () => {
  const { instructions } = createWttClaimInstructions(
    wallet, 2, 'missing', entitlementIds, appOrigin,
  );
  assert.deepEqual(instructions.map((instruction) => instruction.programId.toBase58()), [
    ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
    TOKEN_PROGRAM_ID.toBase58(),
    TOKEN_PROGRAM_ID.toBase58(),
    WTT_MEMO_PROGRAM_ID.toBase58(),
  ]);
  assert.equal(instructions[0]!.data[0], 1, 'ATA instruction is idempotent create');
  assert.equal(instructions[1]!.data[0], 14, 'SPL instruction is MintToChecked');
  assert.equal(instructions[2]!.data[0], 10, 'SPL instruction is FreezeAccount');
  assert.equal(
    instructions[3]!.data.toString('utf8'),
    'who touched this | contribution #012 | https://whotouchedthis.website/history/12',
  );
});

test('frozen ATA uses thaw, mint-checked, freeze', () => {
  const { instructions } = createWttClaimInstructions(
    wallet, 2, 'frozen', entitlementIds, appOrigin,
  );
  assert.deepEqual(instructions.slice(0, 3).map((instruction) => instruction.data[0]), [11, 14, 10]);
  assert.ok(instructions.slice(0, 3).every((instruction) => instruction.programId.equals(TOKEN_PROGRAM_ID)));
  assert.ok(instructions[3]!.programId.equals(WTT_MEMO_PROGRAM_ID));
});

test('initialized ATA uses mint-checked then freeze', () => {
  const { instructions } = createWttClaimInstructions(
    wallet, 2, 'initialized', entitlementIds, appOrigin,
  );
  assert.deepEqual(instructions.slice(0, 2).map((instruction) => instruction.data[0]), [14, 10]);
  assert.ok(instructions[2]!.programId.equals(WTT_MEMO_PROGRAM_ID));
  const authority = new PublicKey(WTT_OPERATIONAL_AUTHORITY);
  const mint = new PublicKey(WTT_MINT_ADDRESS);
  for (const instruction of instructions.slice(0, 2)) {
    assert.ok(instruction.keys.some((key) => key.pubkey.equals(authority) && key.isSigner));
    assert.ok(instruction.keys.some((key) => key.pubkey.equals(mint)));
  }
});

test('contribution memos use padded display numbers and canonical numeric History routes', () => {
  assert.equal(
    buildWttContributionMemo(0, appOrigin),
    'who touched this | contribution #000 | https://whotouchedthis.website/history/0',
  );
  assert.equal(
    buildWttContributionMemo(31, appOrigin),
    'who touched this | contribution #031 | https://whotouchedthis.website/history/31',
  );
});

test('multiple contribution entitlements produce deterministic numerically ordered memos', () => {
  const first = createWttClaimMemoInstructions([
    'future-source:private-entitlement-id',
    'contribution:44',
    'contribution:31',
  ], appOrigin);
  const second = createWttClaimMemoInstructions([
    'contribution:31',
    'future-source:private-entitlement-id',
    'contribution:44',
  ], appOrigin);
  const expected = [
    'who touched this | contribution #031 | https://whotouchedthis.website/history/31',
    'who touched this | contribution #044 | https://whotouchedthis.website/history/44',
  ];
  assert.deepEqual(first.map((instruction) => instruction.data.toString('utf8')), expected);
  assert.deepEqual(second.map((instruction) => instruction.data.toString('utf8')), expected);
  assert.ok(first.every((instruction) => instruction.programId.equals(WTT_MEMO_PROGRAM_ID)
    && instruction.keys.length === 0));
});

test('memo contents exclude private claim, contributor, wallet, and summary data', () => {
  const sensitiveValues = [
    'founder@example.com',
    '123456789',
    wallet,
    'future-source:private-entitlement-id',
    'private contribution summary',
  ];
  const serialized = createWttClaimMemoInstructions([
    'future-source:private-entitlement-id',
    'contribution:31',
  ], appOrigin).map((instruction) => instruction.data.toString('utf8')).join('\n');
  for (const sensitive of sensitiveValues) assert.doesNotMatch(serialized, new RegExp(sensitive));
});

test('memo instructions share the atomic transaction instruction list with mint and freeze', () => {
  const { instructions } = createWttClaimInstructions(
    wallet,
    2,
    'initialized',
    ['contribution:44', 'contribution:31'],
    appOrigin,
  );
  assert.deepEqual(instructions.map((instruction) => instruction.programId.toBase58()), [
    TOKEN_PROGRAM_ID.toBase58(),
    TOKEN_PROGRAM_ID.toBase58(),
    WTT_MEMO_PROGRAM_ID.toBase58(),
    WTT_MEMO_PROGRAM_ID.toBase58(),
  ]);
  assert.equal(instructions[0]!.data[0], 14, 'SPL instruction is MintToChecked');
  assert.equal(instructions[1]!.data[0], 10, 'SPL instruction is FreezeAccount');
});

test('transaction message construction is deterministic for the same reserved contributions', () => {
  const blockhash = Keypair.generate().publicKey.toBase58();
  const authority = new PublicKey(WTT_OPERATIONAL_AUTHORITY);
  const messageFor = (ids: readonly string[]) => {
    const { instructions } = createWttClaimInstructions(
      wallet, 2, 'initialized', ids, appOrigin,
    );
    return new Transaction({
      feePayer: authority,
      blockhash,
      lastValidBlockHeight: 123,
    }).add(...instructions).serializeMessage();
  };
  assert.deepEqual(
    messageFor(['contribution:44', 'contribution:31']),
    messageFor(['contribution:31', 'contribution:44']),
  );
});

test('canonical ATA invariants reject incorrect address, program, mint, owner, or state', () => {
  const { ata } = createWttClaimInstructions(
    wallet, 1, 'initialized', entitlementIds, appOrigin,
  );
  const valid = {
    address: ata.toBase58(),
    programAddress: WTT_TOKEN_PROGRAM_ADDRESS,
    mintAddress: WTT_MINT_ADDRESS,
    ownerAddress: wallet,
    isInitialized: true,
    isFrozen: false,
  };
  assert.equal(assertWttTokenAccountInvariants(wallet, valid), 'initialized');
  assert.equal(assertWttTokenAccountInvariants(wallet, { ...valid, isFrozen: true }), 'frozen');
  for (const invalid of [
    { ...valid, address: Keypair.generate().publicKey.toBase58() },
    { ...valid, programAddress: SystemProgram.programId.toBase58() },
    { ...valid, mintAddress: Keypair.generate().publicKey.toBase58() },
    { ...valid, ownerAddress: Keypair.generate().publicKey.toBase58() },
    { ...valid, isInitialized: false },
  ]) expectPrecondition(() => assertWttTokenAccountInvariants(wallet, invalid));
});

test('all WTT mint invariants are mandatory before signing', () => {
  const valid = {
    address: WTT_MINT_ADDRESS,
    programAddress: WTT_TOKEN_PROGRAM_ADDRESS,
    decimals: WTT_DECIMALS,
    isInitialized: true,
    mintAuthority: WTT_OPERATIONAL_AUTHORITY,
    freezeAuthority: WTT_OPERATIONAL_AUTHORITY,
  };
  assert.doesNotThrow(() => assertWttMintInvariants(valid));
  for (const invalid of [
    { ...valid, address: Keypair.generate().publicKey.toBase58() },
    { ...valid, programAddress: SystemProgram.programId.toBase58() },
    { ...valid, decimals: 9 },
    { ...valid, isInitialized: false },
    { ...valid, mintAuthority: null },
    { ...valid, freezeAuthority: null },
  ]) expectPrecondition(() => assertWttMintInvariants(invalid));
});

test('claim amount is converted to bigint without floating point token math', () => {
  assert.equal(wttClaimAmount(3), 3n);
  for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    expectPrecondition(() => wttClaimAmount(invalid));
  }
});

test('an attempt expires only when validity and recorded height agree conclusively', () => {
  assert.equal(attemptIsDefinitivelyExpired(false, 102, 101), true);
  assert.equal(attemptIsDefinitivelyExpired(false, 101, 101), false);
  assert.equal(attemptIsDefinitivelyExpired(true, 102, 101), false);
});

test('external signer receives exact serialized message and authority is fee payer', async () => {
  const keys = ed25519.keygen();
  const authority = new PublicKey(keys.publicKey);
  let signedBytes: Uint8Array | null = null;
  const instruction = SystemProgram.transfer({
    fromPubkey: authority,
    toPubkey: Keypair.generate().publicKey,
    lamports: 1,
  });
  const built = await buildExternallySignedTransaction({
    authority,
    instructions: [instruction],
    blockhash: Keypair.generate().publicKey.toBase58(),
    lastValidBlockHeight: 123,
    signer: {
      async signMessage(message) {
        signedBytes = new Uint8Array(message);
        return ed25519.sign(message, keys.secretKey);
      },
    },
  });
  assert.deepEqual(Buffer.from(signedBytes!), Buffer.from(built.message));
  const transaction = Transaction.from(Buffer.from(built.rawTransactionBase64, 'base64'));
  assert.equal(transaction.feePayer?.toBase58(), authority.toBase58());
  assert.equal(transaction.verifySignatures(true), true);
  const prepared = {
    number: 1,
    transactionSignature: built.transactionSignature,
    rawTransactionBase64: built.rawTransactionBase64,
    blockhash: transaction.recentBlockhash!,
    lastValidBlockHeight: 123,
    preparedAt: new Date(),
    submittedAt: null,
  };
  assert.deepEqual(validatePreparedTransaction(prepared, authority), Buffer.from(built.rawTransactionBase64, 'base64'));
  assert.throws(() => validatePreparedTransaction({ ...prepared, blockhash: Keypair.generate().publicKey.toBase58() }, authority), /local signature or authority/);
  assert.throws(() => validatePreparedTransaction({ ...prepared, transactionSignature: 'wrong' }, authority), /local signature or authority/);
  assert.throws(() => validatePreparedTransaction({ ...prepared, rawTransactionBase64: 'not-base64' }, authority), /encoding is invalid/);
});

test('malformed or wrong-key KMS signature is rejected before serialization for broadcast', async () => {
  const expected = ed25519.keygen();
  const wrong = ed25519.keygen();
  const authority = new PublicKey(expected.publicKey);
  const base = {
    authority,
    instructions: [SystemProgram.transfer({
      fromPubkey: authority, toPubkey: Keypair.generate().publicKey, lamports: 1,
    })],
    blockhash: Keypair.generate().publicKey.toBase58(),
    lastValidBlockHeight: 123,
  };
  await assert.rejects(buildExternallySignedTransaction({
    ...base, signer: { signMessage: async () => new Uint8Array(63) },
  }), /did not verify/);
  await assert.rejects(buildExternallySignedTransaction({
    ...base,
    signer: { signMessage: async (message) => ed25519.sign(message, wrong.secretKey) },
  }), /did not verify/);
});
