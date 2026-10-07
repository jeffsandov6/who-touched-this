import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  unpackAccount,
  unpackMint,
} from '@solana/spl-token';
import bs58 from 'bs58';
import {
  FOUNDER_ATA,
  FOUNDER_WALLET,
  FounderProvenanceError,
  ORIGINAL_FOUNDER_CLAIM_SIGNATURE,
  findSuccessfulFounderProvenanceDuplicate,
  type FounderAtaState,
  type FounderMintState,
  type FounderProvenancePostSend,
  type FounderProvenancePreflight,
  type OriginalClaimState,
} from './founder-provenance.js';
import {
  WTT_MINT_ADDRESS,
  WTT_OPERATIONAL_AUTHORITY,
  WTT_SOLANA_NETWORK,
} from './config.js';
import { WTT_MEMO_PROGRAM_ID } from './solana-claims.js';

const COMMITMENT = 'confirmed' as const;
const MINT = new PublicKey(WTT_MINT_ADDRESS);
const AUTHORITY = new PublicKey(WTT_OPERATIONAL_AUTHORITY);
const FOUNDER = new PublicKey(FOUNDER_WALLET);
const ATA = new PublicKey(FOUNDER_ATA);
const MAX_DUPLICATE_HISTORY_PAGES = 100;
const SIGNATURE_PAGE_SIZE = 1_000;
const TRANSACTION_BATCH_SIZE = 10;
const RATE_LIMIT_MAX_RETRIES = 3;
const RATE_LIMIT_BASE_DELAY_MS = 500;
const RATE_LIMIT_MAX_DELAY_MS = 10_000;

interface DuplicateSignatureInfo {
  signature: string;
  err: unknown;
}

export interface FounderDuplicateHistoryReader {
  loadSignatures(options: { limit: number; before?: string }): Promise<readonly DuplicateSignatureInfo[]>;
  loadParsedTransactions(signatures: readonly string[]): Promise<readonly unknown[]>;
}

export interface FounderDuplicateScanResult {
  duplicateSignature: string | null;
  checkpointSignature: string;
}

export interface FounderRateLimitRetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  now?: () => number;
}

function statusFromError(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  for (const key of ['status', 'statusCode', 'code'] as const) {
    const value = (error as Record<string, unknown>)[key];
    if (value === 429 || value === '429') return 429;
  }
  const response = (error as { response?: unknown }).response;
  if (response && typeof response === 'object'
    && (response as { status?: unknown }).status === 429) return 429;
  return null;
}

function headerValue(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== 'object') return null;
  if ('get' in headers && typeof headers.get === 'function') {
    const value = headers.get(name);
    return typeof value === 'string' ? value : null;
  }
  const record = headers as Record<string, unknown>;
  const value = record[name] ?? record[name.toLowerCase()] ?? record[name.toUpperCase()];
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : null;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
}

function retryAfterMs(error: unknown, now: () => number): number | null {
  if (!error || typeof error !== 'object') return null;
  const response = (error as { response?: unknown }).response;
  const responseHeaders = response && typeof response === 'object'
    ? (response as { headers?: unknown }).headers
    : undefined;
  const value = headerValue(responseHeaders, 'retry-after')
    ?? headerValue((error as { headers?: unknown }).headers, 'retry-after');
  if (value === null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now()) : null;
}

function isRateLimitError(error: unknown): boolean {
  if (statusFromError(error) === 429) return true;
  return error instanceof Error && /(?:^|\D)429(?:\D|$)|too many requests/i.test(error.message);
}

export async function withFounderRpcRateLimitRetry<T>(
  operation: () => Promise<T>,
  options: FounderRateLimitRetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? RATE_LIMIT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? RATE_LIMIT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? RATE_LIMIT_MAX_DELAY_MS;
  const sleep = options.sleep ?? ((delayMs: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  }));
  const now = options.now ?? Date.now;
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0
    || !Number.isFinite(baseDelayMs) || baseDelayMs < 0
    || !Number.isFinite(maxDelayMs) || maxDelayMs < 0) {
    throw new FounderProvenanceError('Invalid bounded RPC retry configuration.');
  }
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRateLimitError(error) || attempt >= maxRetries) throw error;
      const retryAfter = retryAfterMs(error, now);
      const exponential = baseDelayMs * (2 ** attempt);
      await sleep(Math.min(retryAfter ?? exponential, maxDelayMs));
    }
  }
}

function publicKeyText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'toBase58' in value
    && typeof value.toBase58 === 'function') return value.toBase58();
  return '';
}

function allInstructions(transaction: any): any[] {
  const outer = Array.isArray(transaction?.transaction?.message?.instructions)
    ? transaction.transaction.message.instructions
    : [];
  const inner = Array.isArray(transaction?.meta?.innerInstructions)
    ? transaction.meta.innerInstructions.flatMap((group: any) => (
      Array.isArray(group?.instructions) ? group.instructions : []
    ))
    : [];
  return [...outer, ...inner];
}

function memoFromInstruction(instruction: any): string | null {
  if (publicKeyText(instruction?.programId) !== WTT_MEMO_PROGRAM_ID.toBase58()) return null;
  if (typeof instruction?.parsed === 'string') return instruction.parsed;
  if (typeof instruction?.parsed?.memo === 'string') return instruction.parsed.memo;
  if (typeof instruction?.data !== 'string') return null;
  try {
    return Buffer.from(bs58.decode(instruction.data)).toString('utf8');
  } catch {
    return null;
  }
}

export function summarizeParsedTransaction(signature: string, transaction: any): {
  signature: string;
  succeeded: boolean;
  memos: string[];
} {
  return {
    signature,
    succeeded: transaction?.meta?.err === null,
    memos: allInstructions(transaction).flatMap((instruction) => {
      const memo = memoFromInstruction(instruction);
      return memo === null ? [] : [memo];
    }),
  };
}

export function inspectOriginalClaimTransaction(transaction: any): OriginalClaimState {
  const mintOperations = allInstructions(transaction).flatMap((instruction) => {
    if (instruction?.parsed?.type !== 'mintToChecked') return [];
    const info = instruction.parsed.info;
    if (!info || typeof info !== 'object') return [];
    const amount = info.tokenAmount?.amount;
    const decimals = info.tokenAmount?.decimals;
    if (typeof amount !== 'string' || !/^[0-9]+$/.test(amount)
      || !Number.isSafeInteger(decimals)) return [];
    return [{
      mintAddress: String(info.mint ?? ''),
      ataAddress: String(info.account ?? ''),
      authorityAddress: String(info.mintAuthority ?? info.authority ?? ''),
      amount: BigInt(amount),
      decimals: Number(decimals),
    }];
  });
  return {
    signature: ORIGINAL_FOUNDER_CLAIM_SIGNATURE,
    succeeded: transaction?.meta?.err === null,
    mintOperations,
    memos: summarizeParsedTransaction(ORIGINAL_FOUNDER_CLAIM_SIGNATURE, transaction).memos,
  };
}

async function inspectDuplicateWindow(
  reader: FounderDuplicateHistoryReader,
  signatures: readonly DuplicateSignatureInfo[],
): Promise<string | null> {
  for (let offset = 0; offset < signatures.length; offset += TRANSACTION_BATCH_SIZE) {
    const successful = signatures
      .slice(offset, offset + TRANSACTION_BATCH_SIZE)
      .filter(({ err }) => err === null);
    if (successful.length === 0) continue;
    const transactions = await reader.loadParsedTransactions(
      successful.map(({ signature }) => signature),
    );
    if (transactions.length !== successful.length
      || transactions.some((transaction) => transaction === null)) {
      throw new FounderProvenanceError(
        'RPC could not inspect all successful transactions in the duplicate-search window.',
      );
    }
    const summaries = successful.map(({ signature }, index) => (
      summarizeParsedTransaction(signature, transactions[index])
    ));
    const duplicate = findSuccessfulFounderProvenanceDuplicate(summaries);
    if (duplicate) return duplicate;
  }
  return null;
}

export async function scanFounderDuplicateHistory(
  reader: FounderDuplicateHistoryReader,
): Promise<FounderDuplicateScanResult> {
  let before: string | undefined;
  let checkpointSignature: string | null = null;
  for (let page = 0; page < MAX_DUPLICATE_HISTORY_PAGES; page += 1) {
    const signatures = await reader.loadSignatures({
      limit: SIGNATURE_PAGE_SIZE,
      ...(before ? { before } : {}),
    });
    if (signatures.length === 0) {
      throw new FounderProvenanceError(
        'Operational authority history ended before the original claim boundary.',
      );
    }
    checkpointSignature ??= signatures[0]!.signature;
    const boundaryIndex = signatures.findIndex(
      ({ signature }) => signature === ORIGINAL_FOUNDER_CLAIM_SIGNATURE,
    );
    const searchWindow = boundaryIndex === -1
      ? signatures
      : signatures.slice(0, boundaryIndex + 1);
    const duplicateSignature = await inspectDuplicateWindow(reader, searchWindow);
    if (duplicateSignature || boundaryIndex !== -1) {
      return { duplicateSignature, checkpointSignature };
    }
    before = signatures.at(-1)?.signature;
    if (!before || signatures.length < SIGNATURE_PAGE_SIZE) {
      throw new FounderProvenanceError(
        'Original claim was not found in operational authority history.',
      );
    }
  }
  throw new FounderProvenanceError('Duplicate search exceeded its fail-closed history bound.');
}

export async function scanFounderDuplicateDelta(
  reader: FounderDuplicateHistoryReader,
  checkpointSignature: string,
): Promise<string | null> {
  if (!checkpointSignature) {
    throw new FounderProvenanceError('Duplicate-search checkpoint is missing.');
  }
  const head = await reader.loadSignatures({ limit: 1 });
  if (head.length !== 1) {
    throw new FounderProvenanceError('RPC could not establish the operational authority transaction head.');
  }
  if (head[0]!.signature === checkpointSignature) return null;

  let before: string | undefined;
  for (let page = 0; page < MAX_DUPLICATE_HISTORY_PAGES; page += 1) {
    const signatures = await reader.loadSignatures({
      limit: SIGNATURE_PAGE_SIZE,
      ...(before ? { before } : {}),
    });
    if (signatures.length === 0) {
      throw new FounderProvenanceError('RPC could not reconnect the duplicate-search delta to its checkpoint.');
    }
    const checkpointIndex = signatures.findIndex(
      ({ signature }) => signature === checkpointSignature,
    );
    const deltaWindow = checkpointIndex === -1
      ? signatures
      : signatures.slice(0, checkpointIndex);
    const duplicate = await inspectDuplicateWindow(reader, deltaWindow);
    if (duplicate) return duplicate;
    if (checkpointIndex !== -1) return null;
    before = signatures.at(-1)?.signature;
    if (!before || signatures.length < SIGNATURE_PAGE_SIZE) {
      throw new FounderProvenanceError('RPC could not reconnect the duplicate-search delta to its checkpoint.');
    }
  }
  throw new FounderProvenanceError('Duplicate delta search exceeded its fail-closed history bound.');
}

export class FounderProvenanceRpc {
  readonly #connection: Connection;

  constructor(rpcUrl: string) {
    this.#connection = new Connection(rpcUrl, {
      commitment: COMMITMENT,
      disableRetryOnRateLimit: true,
    });
  }

  #duplicateHistoryReader(): FounderDuplicateHistoryReader {
    return {
      loadSignatures: (options) => withFounderRpcRateLimitRetry(
        () => this.#connection.getSignaturesForAddress(AUTHORITY, options, COMMITMENT),
      ),
      loadParsedTransactions: (signatures) => withFounderRpcRateLimitRetry(
        () => this.#connection.getParsedTransactions([...signatures], {
          commitment: COMMITMENT,
          maxSupportedTransactionVersion: 0,
        }),
      ),
    };
  }

  async inspectMint(): Promise<FounderMintState> {
    const info = await this.#connection.getAccountInfo(MINT, COMMITMENT);
    if (!info || !info.owner.equals(TOKEN_PROGRAM_ID)) {
      throw new FounderProvenanceError('Official WTT mint is missing or not owned by the Classic SPL Token Program.');
    }
    let decoded;
    try {
      decoded = unpackMint(MINT, info, TOKEN_PROGRAM_ID);
    } catch {
      throw new FounderProvenanceError('Official WTT mint data is invalid.');
    }
    return {
      address: decoded.address.toBase58(),
      programAddress: info.owner.toBase58(),
      decimals: decoded.decimals,
      isInitialized: decoded.isInitialized,
      supply: decoded.supply,
      mintAuthority: decoded.mintAuthority?.toBase58() ?? null,
      freezeAuthority: decoded.freezeAuthority?.toBase58() ?? null,
    };
  }

  async inspectAta(): Promise<FounderAtaState> {
    const canonical = getAssociatedTokenAddressSync(
      MINT, FOUNDER, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    if (!canonical.equals(ATA)) {
      throw new FounderProvenanceError('Configured Founder ATA is not canonical for the mint and wallet.');
    }
    const info = await this.#connection.getAccountInfo(ATA, COMMITMENT);
    if (!info || !info.owner.equals(TOKEN_PROGRAM_ID)) {
      throw new FounderProvenanceError('Founder ATA is missing or not owned by the Classic SPL Token Program.');
    }
    let decoded;
    try {
      decoded = unpackAccount(ATA, info, TOKEN_PROGRAM_ID);
    } catch {
      throw new FounderProvenanceError('Founder ATA data is invalid.');
    }
    return {
      address: decoded.address.toBase58(),
      programAddress: info.owner.toBase58(),
      mintAddress: decoded.mint.toBase58(),
      ownerAddress: decoded.owner.toBase58(),
      amount: decoded.amount,
      isInitialized: decoded.isInitialized,
      isFrozen: decoded.isFrozen,
    };
  }

  async loadOriginalClaim(): Promise<OriginalClaimState> {
    const transaction = await this.#connection.getParsedTransaction(
      ORIGINAL_FOUNDER_CLAIM_SIGNATURE,
      { commitment: COMMITMENT, maxSupportedTransactionVersion: 0 },
    );
    if (!transaction) {
      throw new FounderProvenanceError('Original Founder claim transaction was not found.');
    }
    return inspectOriginalClaimTransaction(transaction);
  }

  async loadPreflight(kmsPublicKey: string): Promise<FounderProvenancePreflight> {
    const [genesisHash, mint, ata, originalClaim, authorityBalanceLamports] = await Promise.all([
      this.#connection.getGenesisHash(),
      this.inspectMint(),
      this.inspectAta(),
      this.loadOriginalClaim(),
      this.#connection.getBalance(AUTHORITY, COMMITMENT),
    ]);
    return {
      network: WTT_SOLANA_NETWORK,
      genesisHash,
      mint,
      ata,
      originalClaim,
      authorityBalanceLamports,
      kmsPublicKey,
    };
  }

  scanDuplicateMemoHistory(): Promise<FounderDuplicateScanResult> {
    return scanFounderDuplicateHistory(this.#duplicateHistoryReader());
  }

  findDuplicateMemoSince(checkpointSignature: string): Promise<string | null> {
    return scanFounderDuplicateDelta(this.#duplicateHistoryReader(), checkpointSignature);
  }

  getLatestBlockhash() {
    return this.#connection.getLatestBlockhash(COMMITMENT);
  }

  async estimateFee(transaction: Transaction): Promise<number> {
    const response = await this.#connection.getFeeForMessage(transaction.compileMessage(), COMMITMENT);
    if (response.value === null) throw new FounderProvenanceError('Solana RPC did not return a transaction fee.');
    return response.value;
  }

  async simulate(raw: Buffer): Promise<void> {
    const result = await this.#connection.simulateTransaction(
      VersionedTransaction.deserialize(raw),
      { commitment: COMMITMENT, sigVerify: true, replaceRecentBlockhash: false },
    );
    if (result.value.err !== null) {
      throw new FounderProvenanceError(`Memo-only transaction simulation failed: ${JSON.stringify(result.value.err)}`);
    }
  }

  async sendOnce(raw: Buffer): Promise<string> {
    return this.#connection.sendRawTransaction(raw, {
      skipPreflight: false,
      preflightCommitment: COMMITMENT,
      maxRetries: 0,
    });
  }

  async confirm(signature: string, blockhash: string, lastValidBlockHeight: number): Promise<void> {
    const result = await this.#connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight }, COMMITMENT,
    );
    if (result.value.err !== null) {
      throw new FounderProvenanceError(`Memo-only transaction confirmation failed: ${JSON.stringify(result.value.err)}`);
    }
  }

  async loadPostSend(signature: string): Promise<FounderProvenancePostSend> {
    const transaction = await this.#connection.getParsedTransaction(
      signature,
      { commitment: COMMITMENT, maxSupportedTransactionVersion: 0 },
    );
    if (!transaction) throw new FounderProvenanceError('Confirmed provenance transaction was not found.');
    const accountKeys = transaction.transaction.message.accountKeys;
    const transactionSignerAddresses = accountKeys
      .filter(({ signer }) => signer)
      .map(({ pubkey }) => pubkey.toBase58());
    const instructions = allInstructions(transaction).map((instruction) => ({
      programId: publicKeyText(instruction.programId),
      data: memoFromInstruction(instruction) ?? '',
      signerAddresses: (Array.isArray(instruction.accounts)
        ? instruction.accounts.map((account: unknown) => publicKeyText(account))
        : Array.isArray(instruction.keys)
          ? instruction.keys.filter((key: any) => key.isSigner).map((key: any) => publicKeyText(key.pubkey))
          : []).filter((address: string) => transactionSignerAddresses.includes(address)),
    }));
    const [mint, ata] = await Promise.all([this.inspectMint(), this.inspectAta()]);
    return {
      succeeded: transaction.meta?.err === null,
      feePayer: publicKeyText(accountKeys[0]?.pubkey),
      signerAddresses: transactionSignerAddresses,
      instructions,
      mint,
      ata,
    };
  }
}
