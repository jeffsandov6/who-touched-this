import { defineSecret } from 'firebase-functions/params';

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
export const WTT_OPERATIONAL_MINIMUM_LAMPORTS = 10_000_000 as const;

export const wttSolanaRpcUrl = defineSecret('WTT_SOLANA_RPC_URL');

function isPrivateIpv4(hostname: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return true;
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

export function validateWttSolanaRpcUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('WTT_SOLANA_RPC_URL must be an absolute HTTPS URL.');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('WTT_SOLANA_RPC_URL must be an HTTPS URL without embedded credentials.');
  }
  const hostname = url.hostname.toLowerCase();
  const endpoint = `${hostname}${url.pathname}${url.search}`.toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]'
    || hostname.endsWith('.local') || endpoint.includes('devnet') || endpoint.includes('testnet')
    || isPrivateIpv4(hostname)) {
    throw new Error('WTT_SOLANA_RPC_URL must be a public mainnet endpoint.');
  }
  return url.toString();
}

export function configuredWttSolanaRpcUrl(): string {
  return validateWttSolanaRpcUrl(wttSolanaRpcUrl.value());
}
