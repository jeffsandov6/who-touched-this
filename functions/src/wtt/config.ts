import { defineString } from 'firebase-functions/params';

export const WTT_SOLANA_NETWORK = 'mainnet-beta' as const;
export const WTT_SOLANA_RPC_DEFAULT = 'https://api.mainnet-beta.solana.com' as const;
export const WTT_MINT_ADDRESS = 'B6GqRNfVZ5aW2mkB4u7PJqAvh49qCaEF7uHUoPgRnQet' as const;
export const WTT_TOKEN_PROGRAM_ADDRESS = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as const;
export const WTT_DECIMALS = 0 as const;
export const WTT_OPERATIONAL_AUTHORITY = 'DsAVrEurQPbgz6wCsuXKTD9xkCuet38YjUv6uhusqVuH' as const;
export const WTT_OPERATIONAL_KMS_KEY_VERSION =
  'projects/who-touched-this-keys/locations/us-central1/keyRings/wtt-mainnet/cryptoKeys/wtt-operational-mainnet/cryptoKeyVersions/1' as const;
export const WTT_CLAIM_SERVICE_ACCOUNT =
  'wtt-claim-signer@who-touched-this.iam.gserviceaccount.com' as const;

export const wttSolanaRpcUrl = defineString('WTT_SOLANA_RPC_URL', {
  default: WTT_SOLANA_RPC_DEFAULT,
  description: 'Server-only Solana mainnet-beta RPC URL used by the WTT claim executor.',
});

export function configuredWttSolanaRpcUrl(): string {
  const value = wttSolanaRpcUrl.value();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('WTT_SOLANA_RPC_URL must be an absolute HTTPS URL.');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('WTT_SOLANA_RPC_URL must be an HTTPS URL without embedded credentials.');
  }
  return url.toString();
}
