import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WTT_SOLANA_RPC_DEFAULT,
  validateWttSolanaRpcUrl,
} from '../src/wtt/config.js';

test('WTT RPC accepts the centralized HTTPS mainnet default', () => {
  assert.equal(validateWttSolanaRpcUrl(WTT_SOLANA_RPC_DEFAULT), `${WTT_SOLANA_RPC_DEFAULT}/`);
});

test('WTT RPC rejects credentials, insecure schemes, local networks, devnet, and testnet', () => {
  for (const value of [
    'http://api.mainnet-beta.solana.com', 'https://api.devnet.solana.com',
    'https://api.testnet.solana.com', 'https://localhost:8899',
    'https://127.0.0.1:8899', 'https://192.168.1.2:8899',
    'https://user:secret@rpc.example.com', 'not a url',
  ]) assert.throws(() => validateWttSolanaRpcUrl(value), /HTTPS|mainnet/);
});
