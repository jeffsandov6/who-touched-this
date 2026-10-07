import {
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  WTT_DECIMALS,
  WTT_MINT_ADDRESS,
  WTT_OPERATIONAL_AUTHORITY,
  WTT_OPERATIONAL_MINIMUM_LAMPORTS,
  WTT_SOLANA_NETWORK,
  WTT_TOKEN_PROGRAM_ADDRESS,
} from './config.js';
import { WTT_MEMO_PROGRAM_ID } from './solana-claims.js';

export const SOLANA_MAINNET_GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' as const;
export const FOUNDER_PROVENANCE_CONFIRMATION_FLAG = '--confirm-mainnet-provenance' as const;
export const FOUNDER_WALLET = 'J6vtKLJtv9teZiPapgq2sb5rs8CkJxLpbx2WsL89woeb' as const;
export const FOUNDER_ATA = 'BzA5LsSoKqhukmwRwvcLXasXjDo8kFJd237MDYHUdtDm' as const;
export const ORIGINAL_FOUNDER_CLAIM_SIGNATURE =
  '37KoKvEXBuzCXStqkFts7ZbJUS3yLCqZRnKSW2KWC3PJ33YBd3ZMK7SH3EWrN8NqULpP2aoYBV84EVbHhcap9k7F' as const;
export const FOUNDER_PROVENANCE_MEMO =
  `who touched this | provenance for contribution #000 | https://whotouchedthis.website/history/0 | original WTT claim: ${ORIGINAL_FOUNDER_CLAIM_SIGNATURE}` as const;

export class FounderProvenanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FounderProvenanceError';
  }
}

export interface FounderMintState {
  address: string;
  programAddress: string;
  decimals: number;
  isInitialized: boolean;
  supply: bigint;
  mintAuthority: string | null;
  freezeAuthority: string | null;
}

export interface FounderAtaState {
  address: string;
  programAddress: string;
  mintAddress: string;
  ownerAddress: string;
  amount: bigint;
  isInitialized: boolean;
  isFrozen: boolean;
}

export interface OriginalClaimState {
  signature: string;
  succeeded: boolean;
  mintOperations: Array<{
    mintAddress: string;
    ataAddress: string;
    authorityAddress: string;
    amount: bigint;
    decimals: number;
  }>;
  memos: string[];
}

export interface FounderProvenancePreflight {
  network: string;
  genesisHash: string;
  mint: FounderMintState;
  ata: FounderAtaState;
  originalClaim: OriginalClaimState;
  authorityBalanceLamports: number;
  kmsPublicKey: string;
}

export interface FounderProvenancePostSend {
  succeeded: boolean;
  feePayer: string;
  signerAddresses: string[];
  instructions: Array<{
    programId: string;
    data: string;
    signerAddresses: string[];
  }>;
  mint: FounderMintState;
  ata: FounderAtaState;
}

export function hasExactFounderProvenanceConfirmation(args: readonly string[]): boolean {
  return args.filter((argument) => argument === FOUNDER_PROVENANCE_CONFIRMATION_FLAG).length === 1
    && !args.some((argument) => argument.startsWith(`${FOUNDER_PROVENANCE_CONFIRMATION_FLAG}=`));
}

function assertMint(state: FounderMintState): void {
  if (state.address !== WTT_MINT_ADDRESS
    || state.programAddress !== WTT_TOKEN_PROGRAM_ADDRESS
    || state.decimals !== WTT_DECIMALS
    || !state.isInitialized
    || state.supply !== 1n
    || state.mintAuthority !== WTT_OPERATIONAL_AUTHORITY
    || state.freezeAuthority !== WTT_OPERATIONAL_AUTHORITY) {
    throw new FounderProvenanceError('WTT mint preflight invariants failed.');
  }
}

function assertAta(state: FounderAtaState): void {
  if (state.address !== FOUNDER_ATA
    || state.programAddress !== WTT_TOKEN_PROGRAM_ADDRESS
    || state.mintAddress !== WTT_MINT_ADDRESS
    || state.ownerAddress !== FOUNDER_WALLET
    || state.amount !== 1n
    || !state.isInitialized
    || !state.isFrozen) {
    throw new FounderProvenanceError('Founder WTT ATA preflight invariants failed.');
  }
}

function assertOriginalClaim(state: OriginalClaimState): void {
  const operations = state.mintOperations.filter(({ mintAddress }) => mintAddress === WTT_MINT_ADDRESS);
  if (state.signature !== ORIGINAL_FOUNDER_CLAIM_SIGNATURE || !state.succeeded
    || operations.length !== 1
    || operations[0]!.ataAddress !== FOUNDER_ATA
    || operations[0]!.authorityAddress !== WTT_OPERATIONAL_AUTHORITY
    || operations[0]!.amount !== 1n
    || operations[0]!.decimals !== WTT_DECIMALS) {
    throw new FounderProvenanceError('Original Founder WTT claim transaction is missing or inconsistent.');
  }
  if (state.memos.includes(FOUNDER_PROVENANCE_MEMO)) {
    throw new FounderProvenanceError('Original Founder claim already contains the intended provenance memo.');
  }
}

export function validateFounderProvenancePreflight(state: FounderProvenancePreflight): void {
  if (state.network !== WTT_SOLANA_NETWORK || state.genesisHash !== SOLANA_MAINNET_GENESIS_HASH) {
    throw new FounderProvenanceError('Solana RPC is not mainnet-beta.');
  }
  assertMint(state.mint);
  assertAta(state.ata);
  assertOriginalClaim(state.originalClaim);
  if (!Number.isSafeInteger(state.authorityBalanceLamports)
    || state.authorityBalanceLamports <= WTT_OPERATIONAL_MINIMUM_LAMPORTS) {
    throw new FounderProvenanceError('WTT operational authority SOL balance is below the required minimum.');
  }
  if (state.kmsPublicKey !== WTT_OPERATIONAL_AUTHORITY) {
    throw new FounderProvenanceError('KMS public key does not match the WTT operational authority.');
  }
}

export function validateFounderProvenanceFee(
  authorityBalanceLamports: number,
  feeLamports: number,
): void {
  if (!Number.isSafeInteger(feeLamports) || feeLamports < 0
    || !Number.isSafeInteger(authorityBalanceLamports)
    || authorityBalanceLamports - feeLamports < WTT_OPERATIONAL_MINIMUM_LAMPORTS) {
    throw new FounderProvenanceError('Transaction fee would reduce operational SOL below the required minimum.');
  }
}

export function findSuccessfulFounderProvenanceDuplicate(
  transactions: readonly { signature: string; succeeded: boolean; memos: readonly string[] }[],
): string | null {
  return transactions.find((transaction) => transaction.succeeded
    && transaction.memos.includes(FOUNDER_PROVENANCE_MEMO))?.signature ?? null;
}

export function createFounderProvenanceInstruction(): TransactionInstruction {
  return new TransactionInstruction({
    programId: WTT_MEMO_PROGRAM_ID,
    keys: [{
      pubkey: new PublicKey(WTT_OPERATIONAL_AUTHORITY),
      isSigner: true,
      isWritable: false,
    }],
    data: Buffer.from(FOUNDER_PROVENANCE_MEMO, 'utf8'),
  });
}

function assertFounderMemoOnlyTransactionShape(
  transaction: Transaction,
  allowCompiledFeePayerWritable: boolean,
): void {
  const authority = new PublicKey(WTT_OPERATIONAL_AUTHORITY);
  const instruction = transaction.instructions[0];
  const authoritySignature = transaction.signatures.find(({ publicKey }) => publicKey.equals(authority));
  if (!transaction.feePayer?.equals(authority)
    || transaction.instructions.length !== 1
    || !instruction?.programId.equals(WTT_MEMO_PROGRAM_ID)
    || instruction.data.toString('utf8') !== FOUNDER_PROVENANCE_MEMO
    || instruction.keys.length !== 1
    || !instruction.keys[0]!.pubkey.equals(authority)
    || !instruction.keys[0]!.isSigner
    || (!allowCompiledFeePayerWritable && instruction.keys[0]!.isWritable)
    || (allowCompiledFeePayerWritable && !authoritySignature?.signature)) {
    throw new FounderProvenanceError('Transaction is not the exact authorized Memo-only transaction.');
  }
}

export function assertFounderMemoOnlyTransaction(transaction: Transaction): void {
  assertFounderMemoOnlyTransactionShape(transaction, false);
}

export function assertFounderMemoOnlySignedTransaction(transaction: Transaction): void {
  assertFounderMemoOnlyTransactionShape(transaction, true);
}

export async function runFounderProvenanceSendGate(input: {
  findDuplicate: () => Promise<string | null>;
  simulate: () => Promise<void>;
  send: () => Promise<string>;
}): Promise<
  { status: 'duplicate'; signature: string }
  | { status: 'sent'; signature: string }
> {
  const duplicate = await input.findDuplicate();
  if (duplicate) return { status: 'duplicate', signature: duplicate };
  await input.simulate();
  return { status: 'sent', signature: await input.send() };
}

export function validateFounderProvenancePostSend(state: FounderProvenancePostSend): void {
  if (!state.succeeded || state.feePayer !== WTT_OPERATIONAL_AUTHORITY
    || !state.signerAddresses.includes(WTT_OPERATIONAL_AUTHORITY)
    || state.instructions.length !== 1
    || state.instructions[0]!.programId !== WTT_MEMO_PROGRAM_ID.toBase58()
    || state.instructions[0]!.data !== FOUNDER_PROVENANCE_MEMO) {
    throw new FounderProvenanceError('Confirmed provenance transaction does not match the required Memo-only transaction.');
  }
  assertMint(state.mint);
  assertAta(state.ata);
}
