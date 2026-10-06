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
const TRANSACTION_BATCH_SIZE = 50;

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

export class FounderProvenanceRpc {
  readonly #connection: Connection;

  constructor(rpcUrl: string) {
    this.#connection = new Connection(rpcUrl, COMMITMENT);
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

  async findDuplicateMemo(): Promise<string | null> {
    let before: string | undefined;
    for (let page = 0; page < MAX_DUPLICATE_HISTORY_PAGES; page += 1) {
      const signatures = await this.#connection.getSignaturesForAddress(
        AUTHORITY,
        { limit: SIGNATURE_PAGE_SIZE, ...(before ? { before } : {}) },
        COMMITMENT,
      );
      if (signatures.length === 0) {
        throw new FounderProvenanceError('Operational authority history ended before the original claim boundary.');
      }
      for (let offset = 0; offset < signatures.length; offset += TRANSACTION_BATCH_SIZE) {
        const batch = signatures.slice(offset, offset + TRANSACTION_BATCH_SIZE);
        const successful = batch.filter(({ err }) => err === null);
        const transactions = await this.#connection.getParsedTransactions(
          successful.map(({ signature }) => signature),
          { commitment: COMMITMENT, maxSupportedTransactionVersion: 0 },
        );
        if (transactions.some((transaction) => transaction === null)) {
          throw new FounderProvenanceError('RPC could not inspect all successful transactions in the duplicate-search window.');
        }
        const summaries = successful.map(({ signature }, index) => (
          summarizeParsedTransaction(signature, transactions[index])
        ));
        const duplicate = findSuccessfulFounderProvenanceDuplicate(summaries);
        if (duplicate) return duplicate;
      }
      if (signatures.some(({ signature }) => signature === ORIGINAL_FOUNDER_CLAIM_SIGNATURE)) {
        return null;
      }
      before = signatures.at(-1)?.signature;
      if (!before || signatures.length < SIGNATURE_PAGE_SIZE) {
        throw new FounderProvenanceError('Original claim was not found in operational authority history.');
      }
    }
    throw new FounderProvenanceError('Duplicate search exceeded its fail-closed history bound.');
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
