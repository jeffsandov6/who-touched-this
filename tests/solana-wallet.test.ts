import assert from 'node:assert/strict';
import test from 'node:test';
import { StandardConnect, type WalletAccount } from '@wallet-standard/core';
import { SolanaSignMessage } from '@solana/wallet-standard-features';
import {
  connectSolanaWallet,
  isMessageSigningWallet,
  shortenSolanaAddress,
  signSolanaMessage,
  type MessageSigningWallet,
} from '../src/platform/solana-wallet.ts';

const account: WalletAccount = {
  address: '11111111111111111111111111111111',
  publicKey: new Uint8Array(32),
  chains: ['solana:mainnet'],
  features: [SolanaSignMessage],
};

function wallet(overrides: Partial<MessageSigningWallet['features']> = {}): MessageSigningWallet {
  return {
    version: '1.0.0',
    name: 'Test Wallet',
    icon: 'data:image/svg+xml;base64,AA==',
    chains: ['solana:mainnet'],
    accounts: [],
    features: {
      [StandardConnect]: { version: '1.0.0', connect: async () => ({ accounts: [account] }) },
      [SolanaSignMessage]: {
        version: '1.0.0',
        signMessage: async (...inputs) => inputs.map(({ message }) => ({
          signedMessage: message,
          signature: new Uint8Array(64).fill(7),
        })),
      },
      ...overrides,
    },
  };
}

test('Wallet Standard feature detection is wallet-brand agnostic', () => {
  assert.equal(isMessageSigningWallet(wallet()), true);
  assert.equal(isMessageSigningWallet({ ...wallet(), features: {} }), false);
});

test('wallet connection is explicit and selects a Solana message-signing account', async () => {
  const selected = wallet();
  const connection = await connectSolanaWallet(selected);
  assert.equal(connection.wallet, selected);
  assert.equal(connection.account.address, account.address);
});

test('connection rejection remains a retryable rejected promise', async () => {
  const selected = wallet({
    [StandardConnect]: {
      version: '1.0.0',
      connect: async () => { throw new Error('user rejected'); },
    },
  });
  await assert.rejects(connectSolanaWallet(selected), /user rejected/);
});

test('message signing returns a 64-byte signature only for the exact UTF-8 message', async () => {
  const connection = await connectSolanaWallet(wallet());
  const signature = await signSolanaMessage(connection, 'Who Touched This');
  assert.equal(signature.length, 64);

  const modifiedWallet = wallet({
    [SolanaSignMessage]: {
      version: '1.0.0',
      signMessage: async () => [{
        signedMessage: new TextEncoder().encode('modified'),
        signature: new Uint8Array(64),
      }],
    },
  });
  await assert.rejects(
    signSolanaMessage(await connectSolanaWallet(modifiedWallet), 'original'),
    /exact verification message/,
  );
});

test('signature rejection remains retryable and address display is shortened', async () => {
  const rejectingWallet = wallet({
    [SolanaSignMessage]: {
      version: '1.0.0',
      signMessage: async () => { throw new Error('user rejected'); },
    },
  });
  await assert.rejects(
    signSolanaMessage(await connectSolanaWallet(rejectingWallet), 'message'),
    /user rejected/,
  );
  assert.equal(shortenSolanaAddress('ABC123456789XYZ9'), 'ABC1…XYZ9');
});
