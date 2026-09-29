import {
  StandardConnect,
  StandardEvents,
  getWallets,
  type StandardConnectFeature,
  type StandardEventsFeature,
  type Wallet,
  type WalletAccount,
} from '@wallet-standard/core';
import {
  SolanaSignMessage,
  type SolanaSignMessageFeature,
} from '@solana/wallet-standard-features';

export type MessageSigningWallet = Wallet & {
  features: StandardConnectFeature & SolanaSignMessageFeature & Partial<StandardEventsFeature>;
};

export interface ConnectedSolanaWallet {
  wallet: MessageSigningWallet;
  account: WalletAccount;
}

function hasFunction(value: unknown, property: string): boolean {
  return Boolean(value && typeof value === 'object'
    && typeof (value as Record<string, unknown>)[property] === 'function');
}

export function isMessageSigningWallet(wallet: Wallet): wallet is MessageSigningWallet {
  return hasFunction(wallet.features[StandardConnect], 'connect')
    && hasFunction(wallet.features[SolanaSignMessage], 'signMessage');
}

export function availableMessageSigningWallets(): readonly MessageSigningWallet[] {
  return getWallets().get().filter(isMessageSigningWallet);
}

export function watchMessageSigningWallets(listener: (wallets: readonly MessageSigningWallet[]) => void): () => void {
  const wallets = getWallets();
  const notify = () => listener(wallets.get().filter(isMessageSigningWallet));
  const unregister = wallets.on('register', notify);
  const unregistered = wallets.on('unregister', notify);
  notify();
  return () => {
    unregister();
    unregistered();
  };
}

function supportsMessageSigning(account: WalletAccount): boolean {
  return account.features.includes(SolanaSignMessage)
    && account.chains.some((chain) => chain.startsWith('solana:'));
}

export async function connectSolanaWallet(wallet: MessageSigningWallet): Promise<ConnectedSolanaWallet> {
  const result = await wallet.features[StandardConnect].connect();
  const account = result.accounts.find(supportsMessageSigning);
  if (!account) throw new Error('this wallet did not provide a Solana account that can sign messages.');
  return { wallet, account };
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export async function signSolanaMessage(
  connection: ConnectedSolanaWallet,
  message: string,
): Promise<Uint8Array> {
  const messageBytes = new TextEncoder().encode(message);
  const outputs = await connection.wallet.features[SolanaSignMessage].signMessage({
    account: connection.account,
    message: messageBytes,
  });
  const output = outputs[0];
  if (!output || !equalBytes(output.signedMessage, messageBytes) || output.signature.length !== 64
    || (output.signatureType !== undefined && output.signatureType !== 'ed25519')) {
    throw new Error('the wallet did not sign the exact verification message.');
  }
  return new Uint8Array(output.signature);
}

export function watchConnectedWallet(
  connection: ConnectedSolanaWallet,
  listener: (account: WalletAccount | null) => void,
): () => void {
  const events = connection.wallet.features[StandardEvents];
  if (!events) return () => { };
  return events.on('change', ({ accounts }) => {
    if (!accounts) return;
    const matchingAccount = accounts.find((account) => account.address === connection.account.address
      && supportsMessageSigning(account));
    listener(matchingAccount ?? accounts.find(supportsMessageSigning) ?? null);
  });
}

export function shortenSolanaAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}
