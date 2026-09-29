import { PublicKey, Connection, type AccountInfo, type Commitment } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, unpackMint } from '@solana/spl-token';
import {
  WTT_DECIMALS,
  WTT_MINT_ADDRESS,
  WTT_TOKEN_PROGRAM_ADDRESS,
} from './config.js';
import { PublicWttStatsError, type WttSupplyReader } from './public-stats.js';

const MINT = new PublicKey(WTT_MINT_ADDRESS);
const COMMITMENT: Commitment = 'confirmed';

export interface WttMintSupplyState {
  address: string;
  programAddress: string;
  decimals: number;
  isInitialized: boolean;
  supply: bigint;
}

export function validateWttMintSupply(state: WttMintSupplyState): number {
  if (state.address !== WTT_MINT_ADDRESS
    || state.programAddress !== WTT_TOKEN_PROGRAM_ADDRESS
    || state.decimals !== WTT_DECIMALS
    || !state.isInitialized
    || state.supply < 0n
    || state.supply > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new PublicWttStatsError('on-chain WTT mint supply does not match the required mainnet invariants.');
  }
  return Number(state.supply);
}

function programAddress(info: AccountInfo<Buffer>): string {
  return info.owner.toBase58();
}

export class MainnetWttSupplyReader implements WttSupplyReader {
  readonly #connection: Connection;

  constructor(rpcUrl: string) {
    this.#connection = new Connection(rpcUrl, COMMITMENT);
  }

  async loadSupply(): Promise<number> {
    const info = await this.#connection.getAccountInfo(MINT, COMMITMENT);
    if (!info) throw new PublicWttStatsError('the configured WTT mint does not exist.');
    if (!info.owner.equals(TOKEN_PROGRAM_ID)) {
      throw new PublicWttStatsError('the configured WTT mint is not owned by the Classic SPL Token Program.');
    }
    let decoded;
    try {
      decoded = unpackMint(MINT, info, TOKEN_PROGRAM_ID);
    } catch {
      throw new PublicWttStatsError('the configured WTT mint is not a valid Classic SPL mint.');
    }
    return validateWttMintSupply({
      address: decoded.address.toBase58(),
      programAddress: programAddress(info),
      decimals: decoded.decimals,
      isInitialized: decoded.isInitialized,
      supply: decoded.supply,
    });
  }
}
