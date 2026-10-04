import { ed25519 } from '@noble/curves/ed25519.js';
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  type AccountInfo,
  type Commitment,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createFreezeAccountInstruction,
  createMintToCheckedInstruction,
  createThawAccountInstruction,
  getAssociatedTokenAddressSync,
  unpackAccount,
  unpackMint,
} from '@solana/spl-token';
import bs58 from 'bs58';
import {
  WTT_DECIMALS,
  WTT_MINT_ADDRESS,
  WTT_OPERATIONAL_AUTHORITY,
  WTT_OPERATIONAL_MINIMUM_LAMPORTS,
  WTT_TOKEN_PROGRAM_ADDRESS,
} from './config.js';
import { WttClaimError, type WttClaimRecord, type WttPreparedAttempt } from './claims.js';

export type WttAtaState = 'missing' | 'frozen' | 'initialized';
export type WttChainAttemptStatus = 'not_found' | 'pending' | 'confirmed' | 'failed';

export interface WttKmsMessageSigner {
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

export interface WttSolanaGateway {
  prepareAttempt(claim: WttClaimRecord, attemptNumber: number, preparedAt: Date): Promise<WttPreparedAttempt>;
  getAttemptStatus(transactionSignature: string): Promise<WttChainAttemptStatus>;
  isAttemptExpired(attempt: WttPreparedAttempt): Promise<boolean>;
  submitPreparedAttempt(attempt: WttPreparedAttempt): Promise<void>;
}

export interface WttMintState {
  address: string;
  programAddress: string;
  decimals: number;
  isInitialized: boolean;
  mintAuthority: string | null;
  freezeAuthority: string | null;
}

export interface WttTokenAccountState {
  address: string;
  programAddress: string;
  mintAddress: string;
  ownerAddress: string;
  isInitialized: boolean;
  isFrozen: boolean;
}

const MINT = new PublicKey(WTT_MINT_ADDRESS);
const AUTHORITY = new PublicKey(WTT_OPERATIONAL_AUTHORITY);
const COMMITMENT: Commitment = 'confirmed';
export const WTT_MEMO_PROGRAM_ID = new PublicKey(
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
);

const CONTRIBUTION_ENTITLEMENT_ID_PATTERN = /^contribution:(0|[1-9][0-9]*)$/;

export type WttSolanaOperationalEvent =
  | 'mint_invariant_failure'
  | 'kms_signing_failure'
  | 'insufficient_operational_sol';

export function attemptIsDefinitivelyExpired(
  blockhashIsValid: boolean,
  currentBlockHeight: number,
  lastValidBlockHeight: number,
): boolean {
  return !blockhashIsValid && Number.isSafeInteger(currentBlockHeight)
    && currentBlockHeight > lastValidBlockHeight;
}

export function assertWttMintInvariants(mint: WttMintState): void {
  if (mint.address !== WTT_MINT_ADDRESS
    || mint.programAddress !== WTT_TOKEN_PROGRAM_ADDRESS
    || !mint.isInitialized
    || mint.decimals !== WTT_DECIMALS
    || mint.mintAuthority !== WTT_OPERATIONAL_AUTHORITY
    || mint.freezeAuthority !== WTT_OPERATIONAL_AUTHORITY) {
    throw new WttClaimError('failed-precondition', 'on-chain WTT mint configuration does not match the required mainnet invariants.');
  }
}

export function wttClaimAmount(amount: number): bigint {
  if (!Number.isSafeInteger(amount) || amount < 1) {
    throw new WttClaimError('failed-precondition', 'WTT claim amount must be a positive safe integer.');
  }
  return BigInt(amount);
}

export function buildWttContributionMemo(
  contributionNumber: number,
  appOrigin: string,
): string {
  if (!Number.isSafeInteger(contributionNumber) || contributionNumber < 0) {
    throw new WttClaimError('failed-precondition', 'WTT contribution provenance is invalid.');
  }
  let origin: URL;
  try {
    origin = new URL(appOrigin);
  } catch {
    throw new WttClaimError('failed-precondition', 'WTT contribution provenance origin is invalid.');
  }
  if (!['http:', 'https:'].includes(origin.protocol)
    || origin.username || origin.password || origin.pathname !== '/'
    || origin.search || origin.hash) {
    throw new WttClaimError('failed-precondition', 'WTT contribution provenance origin is invalid.');
  }
  const displayNumber = String(contributionNumber).padStart(3, '0');
  return `who touched this | contribution #${displayNumber} | ${origin.origin}/history/${contributionNumber}`;
}

export function createWttClaimMemoInstructions(
  entitlementIds: readonly string[],
  appOrigin: string,
): TransactionInstruction[] {
  const contributionNumbers = entitlementIds.flatMap((entitlementId) => {
    if (!entitlementId.startsWith('contribution:')) return [];
    const match = CONTRIBUTION_ENTITLEMENT_ID_PATTERN.exec(entitlementId);
    const contributionNumber = match ? Number(match[1]) : Number.NaN;
    if (!Number.isSafeInteger(contributionNumber)) {
      throw new WttClaimError('failed-precondition', 'WTT contribution provenance is invalid.');
    }
    return [contributionNumber];
  }).sort((left, right) => left - right);

  return contributionNumbers.map((contributionNumber) => new TransactionInstruction({
    programId: WTT_MEMO_PROGRAM_ID,
    keys: [],
    data: Buffer.from(buildWttContributionMemo(contributionNumber, appOrigin), 'utf8'),
  }));
}

export function assertWttTokenAccountInvariants(
  walletAddress: string,
  account: WttTokenAccountState,
): WttAtaState {
  const canonicalAta = getAssociatedTokenAddressSync(
    MINT,
    new PublicKey(walletAddress),
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  ).toBase58();
  if (account.address !== canonicalAta
    || account.programAddress !== WTT_TOKEN_PROGRAM_ADDRESS
    || account.mintAddress !== WTT_MINT_ADDRESS
    || account.ownerAddress !== walletAddress
    || !account.isInitialized) {
    throw new WttClaimError('failed-precondition', 'the canonical WTT token account has unexpected mint or owner state.');
  }
  return account.isFrozen ? 'frozen' : 'initialized';
}

export function createWttClaimInstructions(
  walletAddress: string,
  amount: number,
  ataState: WttAtaState,
  entitlementIds: readonly string[],
  appOrigin: string,
): { ata: PublicKey; instructions: TransactionInstruction[] } {
  const owner = new PublicKey(walletAddress);
  const ata = getAssociatedTokenAddressSync(
    MINT,
    owner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const instructions: TransactionInstruction[] = [];
  if (ataState === 'missing') {
    instructions.push(createAssociatedTokenAccountIdempotentInstruction(
      AUTHORITY, ata, owner, MINT, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
    ));
  } else if (ataState === 'frozen') {
    instructions.push(createThawAccountInstruction(
      ata, MINT, AUTHORITY, [], TOKEN_PROGRAM_ID,
    ));
  }
  instructions.push(
    createMintToCheckedInstruction(
      MINT, ata, AUTHORITY, wttClaimAmount(amount), WTT_DECIMALS, [], TOKEN_PROGRAM_ID,
    ),
    createFreezeAccountInstruction(ata, MINT, AUTHORITY, [], TOKEN_PROGRAM_ID),
    ...createWttClaimMemoInstructions(entitlementIds, appOrigin),
  );
  return { ata, instructions };
}

export async function buildExternallySignedTransaction(input: {
  authority: PublicKey;
  instructions: readonly TransactionInstruction[];
  blockhash: string;
  lastValidBlockHeight: number;
  signer: WttKmsMessageSigner;
}): Promise<{ transactionSignature: string; rawTransactionBase64: string; message: Uint8Array }> {
  const transaction = new Transaction({
    feePayer: input.authority,
    blockhash: input.blockhash,
    lastValidBlockHeight: input.lastValidBlockHeight,
  });
  transaction.add(...input.instructions);
  const message = transaction.serializeMessage();
  const signature = await input.signer.signMessage(message);
  if (signature.length !== 64
    || !ed25519.verify(signature, message, input.authority.toBytes(), { zip215: false })) {
    throw new WttClaimError('failed-precondition', 'KMS signature did not verify against the operational authority.');
  }
  transaction.addSignature(input.authority, Buffer.from(signature));
  if (!transaction.verifySignatures(true)) {
    throw new WttClaimError('failed-precondition', 'completed Solana transaction signatures are invalid.');
  }
  return {
    transactionSignature: bs58.encode(signature),
    rawTransactionBase64: Buffer.from(transaction.serialize({
      requireAllSignatures: true,
      verifySignatures: true,
    })).toString('base64'),
    message,
  };
}

export function validatePreparedTransaction(
  attempt: WttPreparedAttempt,
  authority: PublicKey = AUTHORITY,
): Buffer {
  const raw = Buffer.from(attempt.rawTransactionBase64, 'base64');
  if (raw.toString('base64') !== attempt.rawTransactionBase64) {
    throw new WttClaimError('failed-precondition', 'stored Solana transaction encoding is invalid.');
  }
  let transaction: Transaction;
  try {
    transaction = Transaction.from(raw);
  } catch {
    throw new WttClaimError('failed-precondition', 'stored Solana transaction bytes are invalid.');
  }
  const authoritySignature = transaction.signatures.find(({ publicKey }) => publicKey.equals(authority));
  if (!transaction.feePayer?.equals(authority)
    || transaction.recentBlockhash !== attempt.blockhash
    || !authoritySignature?.signature
    || bs58.encode(authoritySignature.signature) !== attempt.transactionSignature
    || !transaction.verifySignatures(true)) {
    throw new WttClaimError('failed-precondition', 'stored Solana transaction failed its local signature or authority check.');
  }
  return raw;
}

function accountOwner(info: AccountInfo<Buffer>): string {
  return info.owner.toBase58();
}

export class MainnetWttSolanaGateway implements WttSolanaGateway {
  readonly #connection: Connection;

  constructor(
    rpcUrl: string,
    private readonly signer: WttKmsMessageSigner,
    private readonly appOrigin: string,
    private readonly observe: (event: WttSolanaOperationalEvent, fields: Record<string, unknown>) => void = () => {},
  ) {
    this.#connection = new Connection(rpcUrl, COMMITMENT);
  }

  async #inspectMint(): Promise<void> {
    const info = await this.#connection.getAccountInfo(MINT, COMMITMENT);
    if (!info) throw new WttClaimError('failed-precondition', 'the configured WTT mint does not exist.');
    let decoded;
    try {
      decoded = unpackMint(MINT, info, TOKEN_PROGRAM_ID);
    } catch {
      throw new WttClaimError('failed-precondition', 'the configured WTT mint is not a valid Classic SPL mint.');
    }
    assertWttMintInvariants({
      address: decoded.address.toBase58(),
      programAddress: accountOwner(info),
      decimals: decoded.decimals,
      isInitialized: decoded.isInitialized,
      mintAuthority: decoded.mintAuthority?.toBase58() ?? null,
      freezeAuthority: decoded.freezeAuthority?.toBase58() ?? null,
    });
  }

  async #inspectAta(walletAddress: string): Promise<WttAtaState> {
    const owner = new PublicKey(walletAddress);
    const ata = getAssociatedTokenAddressSync(
      MINT, owner, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    const info = await this.#connection.getAccountInfo(ata, COMMITMENT);
    if (!info) return 'missing';
    if (!info.owner.equals(TOKEN_PROGRAM_ID)) {
      throw new WttClaimError('failed-precondition', 'the canonical WTT token account is owned by the wrong program.');
    }
    let decoded;
    try {
      decoded = unpackAccount(ata, info, TOKEN_PROGRAM_ID);
    } catch {
      throw new WttClaimError('failed-precondition', 'the canonical WTT token account is invalid.');
    }
    return assertWttTokenAccountInvariants(walletAddress, {
      address: decoded.address.toBase58(),
      programAddress: accountOwner(info),
      mintAddress: decoded.mint.toBase58(),
      ownerAddress: decoded.owner.toBase58(),
      isInitialized: decoded.isInitialized,
      isFrozen: decoded.isFrozen,
    });
  }

  async prepareAttempt(
    claim: WttClaimRecord,
    attemptNumber: number,
    preparedAt: Date,
  ): Promise<WttPreparedAttempt> {
    wttClaimAmount(claim.amount);
    const balance = await this.#connection.getBalance(AUTHORITY, COMMITMENT);
    if (balance < WTT_OPERATIONAL_MINIMUM_LAMPORTS) {
      this.observe('insufficient_operational_sol', { attemptNumber, balanceLamports: balance });
      throw new WttClaimError('failed-precondition', 'the WTT operational account needs more SOL before this claim can continue.');
    }
    try {
      await this.#inspectMint();
    } catch (error) {
      if (error instanceof WttClaimError && error.code === 'failed-precondition') {
        this.observe('mint_invariant_failure', { attemptNumber });
      }
      throw error;
    }
    const ataState = await this.#inspectAta(claim.walletAddress);
    const { instructions } = createWttClaimInstructions(
      claim.walletAddress,
      claim.amount,
      ataState,
      claim.entitlementIds,
      this.appOrigin,
    );
    const { blockhash, lastValidBlockHeight } = await this.#connection.getLatestBlockhash(COMMITMENT);
    let signed;
    try {
      signed = await buildExternallySignedTransaction({
        authority: AUTHORITY,
        instructions,
        blockhash,
        lastValidBlockHeight,
        signer: this.signer,
      });
    } catch (error) {
      this.observe('kms_signing_failure', { attemptNumber });
      throw error;
    }
    return {
      number: attemptNumber,
      transactionSignature: signed.transactionSignature,
      rawTransactionBase64: signed.rawTransactionBase64,
      blockhash,
      lastValidBlockHeight,
      preparedAt,
      submittedAt: null,
    };
  }

  async getAttemptStatus(transactionSignature: string): Promise<WttChainAttemptStatus> {
    const response = await this.#connection.getSignatureStatuses(
      [transactionSignature],
      { searchTransactionHistory: true },
    );
    const status = response.value[0];
    if (!status) return 'not_found';
    if (status.err !== null) return 'failed';
    return status.confirmationStatus === 'finalized' ? 'confirmed' : 'pending';
  }

  async isAttemptExpired(attempt: WttPreparedAttempt): Promise<boolean> {
    const [validity, currentBlockHeight] = await Promise.all([
      this.#connection.isBlockhashValid(attempt.blockhash, { commitment: COMMITMENT }),
      this.#connection.getBlockHeight(COMMITMENT),
    ]);
    return attemptIsDefinitivelyExpired(
      validity.value, currentBlockHeight, attempt.lastValidBlockHeight,
    );
  }

  async submitPreparedAttempt(attempt: WttPreparedAttempt): Promise<void> {
    const raw = validatePreparedTransaction(attempt);
    const signature = await this.#connection.sendRawTransaction(raw, {
      skipPreflight: false,
      preflightCommitment: COMMITMENT,
      maxRetries: 3,
    });
    if (signature !== attempt.transactionSignature) {
      throw new WttClaimError('unavailable', 'Solana RPC returned an unexpected transaction signature.');
    }
  }
}
