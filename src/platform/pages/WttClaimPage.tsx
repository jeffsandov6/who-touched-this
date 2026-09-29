/** @jsxImportSource react */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AuthenticationError,
  observeAuthState,
  resolveGitHubIdentity,
  signInWithGitHub,
  signOutOfPlatform,
} from '../firebase/auth';
import {
  reconcileGitHubIdentity,
  type GitHubIdentity,
} from '../firebase/github-identity';
import {
  loadOwnWttEntitlements,
  WttEntitlementServiceError,
} from '../firebase/wtt-entitlements';
import {
  claimWtt,
  issueWttClaimChallenge,
  signatureBytesToBase64,
  verifyWttClaimChallenge,
  type VerifiedWttClaimChallenge,
  type WttClaimExecutionResult,
} from '../firebase/wtt-claim-challenges';
import {
  calculateWttEntitlementTotals,
  wttEntitlementSourceLabel,
  type ParsedWttEntitlement,
} from '../wtt-entitlements';
import {
  availableMessageSigningWallets,
  connectSolanaWallet,
  shortenSolanaAddress,
  signSolanaMessage,
  watchConnectedWallet,
  watchMessageSigningWallets,
  type ConnectedSolanaWallet,
  type MessageSigningWallet,
} from '../solana-wallet';

function safeMessage(error: unknown, fallback: string): string {
  return error instanceof AuthenticationError || error instanceof WttEntitlementServiceError
    ? error.message
    : fallback;
}

function EntitlementSource({ entitlement }: { entitlement: ParsedWttEntitlement }) {
  const label = wttEntitlementSourceLabel(entitlement);
  return entitlement.sourceType === 'contribution' ? (
    <a href={`/history/${entitlement.sourceId}`}>{label}</a>
  ) : label;
}

export default function WttClaimPage() {
  const requestSequence = useRef(0);
  const verificationSequence = useRef(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [identity, setIdentity] = useState<GitHubIdentity | null>(null);
  const [entitlements, setEntitlements] = useState<ParsedWttEntitlement[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [wallets, setWallets] = useState<readonly MessageSigningWallet[]>(() => availableMessageSigningWallets());
  const [selectedWalletName, setSelectedWalletName] = useState('');
  const [connection, setConnection] = useState<ConnectedSolanaWallet | null>(null);
  const [selectedEntitlementIds, setSelectedEntitlementIds] = useState<Set<string>>(new Set());
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletMessage, setWalletMessage] = useState<string | null>(null);
  const [verifiedChallenge, setVerifiedChallenge] = useState<VerifiedWttClaimChallenge | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimMessage, setClaimMessage] = useState<string | null>(null);
  const [claimResult, setClaimResult] = useState<WttClaimExecutionResult | null>(null);

  function clearVerifiedChallenge() {
    ++verificationSequence.current;
    setVerifiedChallenge(null);
  }

  async function loadAuthenticatedState(nextIdentity: GitHubIdentity) {
    const request = ++requestSequence.current;
    setLoading(true);
    setErrorMessage(null);
    setIdentity((current) => reconcileGitHubIdentity(current, nextIdentity));
    try {
      const records = await loadOwnWttEntitlements(nextIdentity.githubUserId);
      if (request === requestSequence.current) {
        setEntitlements(records);
        setSelectedEntitlementIds(new Set(
          records.filter((record) => record.status === 'unclaimed').map((record) => record.id),
        ));
        clearVerifiedChallenge();
      }
    } catch (error) {
      if (request === requestSequence.current) {
        setEntitlements([]);
        setErrorMessage(safeMessage(error, 'your WTT records could not be loaded.'));
      }
    } finally {
      if (request === requestSequence.current) setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    let unsubscribe = () => { };
    try {
      unsubscribe = observeAuthState((user) => {
        void (async () => {
          const request = ++requestSequence.current;
          setLoading(true);
          setErrorMessage(null);
          if (!user) {
            if (active && request === requestSequence.current) {
              setIdentity(null);
              setEntitlements([]);
              setLoading(false);
            }
            return;
          }
          try {
            const nextIdentity = await resolveGitHubIdentity(user);
            if (active && request === requestSequence.current) {
              await loadAuthenticatedState(nextIdentity);
            }
          } catch (error) {
            if (active && request === requestSequence.current) {
              setIdentity(null);
              setEntitlements([]);
              setErrorMessage(safeMessage(error, 'your authenticated GitHub identity could not be loaded.'));
              setLoading(false);
            }
          }
        })();
      });
    } catch {
      setErrorMessage('Firebase configuration is unavailable. check the local environment setup.');
      setLoading(false);
    }
    return () => {
      active = false;
      ++requestSequence.current;
      unsubscribe();
    };
  }, []);

  useEffect(() => watchMessageSigningWallets((nextWallets) => {
    setWallets(nextWallets);
    setSelectedWalletName((current) => current || nextWallets[0]?.name || '');
  }), []);

  useEffect(() => {
    if (!connection) return undefined;
    return watchConnectedWallet(connection, (account) => {
      if (!account) {
        setConnection(null);
        setWalletMessage('the connected wallet account is no longer available.');
      } else if (account.address !== connection.account.address) {
        setConnection({ wallet: connection.wallet, account });
        setWalletMessage('wallet account changed. verify the new wallet when you are ready.');
      }
      clearVerifiedChallenge();
    });
  }, [connection]);

  async function handleSignIn() {
    setBusy(true);
    setErrorMessage(null);
    try {
      await loadAuthenticatedState(await signInWithGitHub());
    } catch (error) {
      setErrorMessage(safeMessage(error, 'GitHub sign-in could not be completed.'));
      setLoading(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    setBusy(true);
    setErrorMessage(null);
    ++requestSequence.current;
    setEntitlements([]);
    setSelectedEntitlementIds(new Set());
    clearVerifiedChallenge();
    try {
      await signOutOfPlatform();
    } catch {
      setErrorMessage('sign out could not be completed. please try again.');
    } finally {
      setBusy(false);
    }
  }

  const totals = useMemo(() => calculateWttEntitlementTotals(entitlements), [entitlements]);
  const selectedAmount = useMemo(() => entitlements.reduce(
    (sum, entitlement) => sum + (entitlement.status === 'unclaimed'
      && selectedEntitlementIds.has(entitlement.id) ? entitlement.amount : 0),
    0,
  ), [entitlements, selectedEntitlementIds]);
  const unclaimedIds = useMemo(() => entitlements
    .filter((entitlement) => entitlement.status === 'unclaimed')
    .map((entitlement) => entitlement.id), [entitlements]);
  const inProgressClaims = useMemo(() => {
    const claims = new Map<string, { amount: number; walletAddress: string | null }>();
    for (const entitlement of entitlements) {
      if (entitlement.status !== 'claiming') continue;
      const current = claims.get(entitlement.claimId);
      claims.set(entitlement.claimId, {
        amount: (current?.amount ?? 0) + entitlement.amount,
        walletAddress: current?.walletAddress ?? null,
      });
    }
    return [...claims.entries()].map(([claimId, value]) => ({ claimId, ...value }));
  }, [entitlements]);

  function changeSelection(entitlementId: string, selected: boolean) {
    setSelectedEntitlementIds((current) => {
      const next = new Set(current);
      if (selected) next.add(entitlementId);
      else next.delete(entitlementId);
      return next;
    });
    clearVerifiedChallenge();
    setWalletMessage(null);
  }

  async function handleConnectWallet() {
    const wallet = wallets.find((candidate) => candidate.name === selectedWalletName);
    if (!wallet) {
      setWalletMessage('no compatible Solana wallet was found in this browser.');
      return;
    }
    setWalletBusy(true);
    setWalletMessage(null);
    clearVerifiedChallenge();
    try {
      setConnection(await connectSolanaWallet(wallet));
    } catch {
      setConnection(null);
      setWalletMessage('wallet connection was cancelled or failed. you can try again.');
    } finally {
      setWalletBusy(false);
    }
  }

  async function handleVerifyWallet() {
    if (!connection || selectedEntitlementIds.size === 0) return;
    const verificationRequest = ++verificationSequence.current;
    setWalletBusy(true);
    setWalletMessage(null);
    setVerifiedChallenge(null);
    try {
      const entitlementIds = [...selectedEntitlementIds].sort();
      const challenge = await issueWttClaimChallenge({
        walletAddress: connection.account.address,
        entitlementIds,
      });
      if (challenge.walletAddress !== connection.account.address) {
        throw new Error('the server returned a challenge for a different wallet.');
      }
      const signature = await signSolanaMessage(connection, challenge.message);
      const verified = await verifyWttClaimChallenge({
        challengeId: challenge.challengeId,
        signature: signatureBytesToBase64(signature),
      });
      if (verified.walletAddress !== connection.account.address
        || verified.entitlementIds.join('\n') !== entitlementIds.join('\n')) {
        throw new Error('the verified wallet challenge did not match this selection.');
      }
      if (verificationRequest === verificationSequence.current) {
        setVerifiedChallenge(verified);
        setWalletMessage('wallet ownership verified. nothing has been minted yet.');
      }
    } catch (error) {
      if (verificationRequest === verificationSequence.current) {
        setWalletMessage(error instanceof Error && error.message.includes('WTT')
          ? error.message
          : 'message signing was cancelled or verification failed. you can try again.');
      }
    } finally {
      setWalletBusy(false);
    }
  }

  async function handleClaim(claimId: string) {
    if (!identity || claimBusy) return;
    setClaimBusy(true);
    setClaimMessage(null);
    setClaimResult(null);
    try {
      const result = await claimWtt(claimId);
      setClaimResult(result);
      clearVerifiedChallenge();
      if (result.status === 'confirmed') {
        setClaimMessage(`${result.amount} WTT confirmed for ${shortenSolanaAddress(result.walletAddress)}.`);
      } else {
        setClaimMessage('claim is in progress. it is safe to resume this same claim later.');
      }
      await loadAuthenticatedState(identity);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'claim could not continue right now. it is safe to resume later.';
      if (message.toLowerCase().includes('challenge has expired')) {
        clearVerifiedChallenge();
        setWalletMessage('wallet verification expired before the claim started. verify the wallet again.');
      }
      setClaimMessage(message);
    } finally {
      setClaimBusy(false);
    }
  }

  return (
    <section className="page-content wtt-claim-page" aria-labelledby="wtt-claim-heading">
      <h1 id="wtt-claim-heading">claim wtt</h1>
      <p className="wtt-intro">you touched the website. unfortunately, you may have earned WTT.</p>
      <p>
        WTT earned here is a record of what the project owes you. nothing is sent to a wallet yet.
      </p>

      <section className="wtt-wallet-help" aria-labelledby="wtt-about-heading">
        <h2 id="wtt-about-heading">what is wtt?</h2>
        <p>WTT is a fungible token on Solana: an artifact and reward for participating in Who Touched This.</p>
        <p>WTT is not required to participate. Claiming is optional, and earned WTT does not expire.</p>
        <details>
          <summary>new to Solana wallets?</summary>
          <p>If you already have a compatible wallet, connect it, sign the verification message, then explicitly claim your WTT. Message signing is not a transaction and costs no SOL.</p>
          <ol>
            <li>Install a compatible Solana wallet, such as Phantom.</li>
            <li>Create a self-custody wallet you control—not a crypto exchange deposit address.</li>
            <li>Securely back up its recovery phrase and never share it.</li>
            <li>Return here, connect the wallet, verify it, and claim your WTT.</li>
          </ol>
          <p><strong>Who Touched This will NEVER ask for your recovery phrase or private key.</strong> Do not paste a recovery phrase into this page.</p>
          <p>You do not need to buy SOL. Who Touched This pays the network and token-account cost.</p>
        </details>
        <p>need help? <a href="mailto:hello@whotouchedthis.website">hello@whotouchedthis.website</a></p>
      </section>

      {errorMessage && <p className="notice notice-error" role="alert">{errorMessage}</p>}

      {loading ? (
        <p role="status">checking GitHub &amp; WTT records…</p>
      ) : !identity ? (
        <section className="wtt-auth-panel" aria-labelledby="wtt-sign-in-heading">
          <h2 id="wtt-sign-in-heading">find your wtt</h2>
          <p>sign in with the same GitHub account you used for Who Touched This.</p>
          <button className="button" type="button" onClick={handleSignIn} disabled={busy}>
            {busy ? 'opening GitHub…' : 'continue with GitHub'}
          </button>
        </section>
      ) : (
        <>
          <section className="github-identity" aria-labelledby="wtt-github-identity-heading">
            <div>
              <h2 id="wtt-github-identity-heading">signed in with GitHub</h2>
              {identity.githubUsername ? (
                <p><a href={identity.profileUrl ?? undefined} rel="noreferrer">@{identity.githubUsername}</a></p>
              ) : <p>GitHub account connected.</p>}
              <p className="wtt-provider-id">GitHub account ID {identity.githubUserId}</p>
            </div>
            {identity.avatarUrl && (
              <img className="github-avatar" src={identity.avatarUrl} alt="" width="64" height="64" referrerPolicy="no-referrer" />
            )}
          </section>

          {!errorMessage && (entitlements.length === 0 ? (
            <section className="empty-state" aria-labelledby="wtt-empty-heading">
              <h2 id="wtt-empty-heading">no wtt waiting for you</h2>
              <p>WTT appears here after an eligible contribution or award.</p>
            </section>
          ) : (
            <>
              <section aria-labelledby="wtt-summary-heading">
                <h2 id="wtt-summary-heading">you've earned {totals.earned} wtt</h2>
                <dl className="wtt-totals">
                  <div><dt>earned</dt><dd>{totals.earned}</dd></div>
                  <div><dt>unclaimed</dt><dd>{totals.unclaimed}</dd></div>
                  <div><dt>claimed</dt><dd>{totals.claimed}</dd></div>
                </dl>
                {totals.unclaimed === 0 ? (
                  <p className="notice">nothing remains to claim. your earned WTT history stays below.</p>
                ) : unclaimedIds.length > 0 ? (
                  <section className="wtt-wallet-panel" aria-labelledby="wtt-wallet-heading">
                    <h3 id="wtt-wallet-heading">verify a Solana wallet</h3>
                    <p>choose the WTT records below, then connect the wallet you want to use later.</p>
                    <p><strong>Signing this message does not send a transaction and does not cost SOL.</strong></p>
                    {!connection ? (
                      <div className="wtt-wallet-connect">
                        {wallets.length > 0 ? (
                          <label>
                            wallet
                            <select value={selectedWalletName} onChange={(event) => {
                              setSelectedWalletName(event.target.value);
                              clearVerifiedChallenge();
                            }} disabled={walletBusy}>
                              {wallets.map((wallet) => <option key={wallet.name} value={wallet.name}>{wallet.name}</option>)}
                            </select>
                          </label>
                        ) : (
                          <p>No compatible Solana wallet was found. Phantom and other Wallet Standard wallets are supported.</p>
                        )}
                        <button className="button" type="button" onClick={handleConnectWallet} disabled={walletBusy || wallets.length === 0}>
                          {walletBusy ? 'connecting…' : 'connect wallet'}
                        </button>
                      </div>
                    ) : (
                      <div className="wtt-connected-wallet">
                        <p>wallet</p>
                        <strong title={connection.account.address}>{shortenSolanaAddress(connection.account.address)}</strong>
                        {verifiedChallenge && <span className="wtt-verified">✓ verified</span>}
                        <button className="button-link" type="button" disabled={walletBusy} onClick={() => {
                          setConnection(null);
                          clearVerifiedChallenge();
                          setWalletMessage(null);
                        }}>change wallet</button>
                      </div>
                    )}
                    <p>{selectedAmount} WTT selected</p>
                    {connection && !verifiedChallenge && (
                      <button className="button" type="button" onClick={handleVerifyWallet}
                        disabled={walletBusy || selectedEntitlementIds.size === 0}>
                        {walletBusy ? 'waiting for wallet…' : 'verify wallet'}
                      </button>
                    )}
                    {connection && verifiedChallenge && (
                      <button className="button" type="button"
                        onClick={() => handleClaim(verifiedChallenge.challengeId)} disabled={claimBusy}>
                        {claimBusy ? 'claiming…' : `claim ${verifiedChallenge.amount} wtt`}
                      </button>
                    )}
                    {walletMessage && <p className={verifiedChallenge ? 'notice' : 'notice notice-error'} role="status">{walletMessage}</p>}
                  </section>
                ) : null}
                {inProgressClaims.map((claim) => (
                  <section className="wtt-claim-progress" key={claim.claimId} aria-label="WTT claim in progress">
                    <h3>claim in progress</h3>
                    <p>{claim.amount} WTT is reserved. resuming uses the same claim and cannot create a second logical claim.</p>
                    <button className="button" type="button" onClick={() => handleClaim(claim.claimId)} disabled={claimBusy}>
                      {claimBusy ? 'checking claim…' : 'resume claim'}
                    </button>
                  </section>
                ))}
                {claimMessage && <p className={claimResult ? 'notice' : 'notice notice-error'} role="status">{claimMessage}</p>}
                {claimResult?.status === 'confirmed' && (
                  <p>
                    <a href={`https://solscan.io/tx/${encodeURIComponent(claimResult.transactionSignature)}`}
                      target="_blank" rel="noreferrer">view confirmed transaction on Solscan</a>
                  </p>
                )}
              </section>
              <section className="wtt-entitlements" aria-labelledby="wtt-entitlements-heading">
                <h2 id="wtt-entitlements-heading">earned wtt</h2>
                {totals.unclaimed > 0 && (
                  <div className="wtt-selection-actions">
                    <button className="button-link" type="button" onClick={() => {
                      setSelectedEntitlementIds(new Set(unclaimedIds));
                      clearVerifiedChallenge();
                    }}>select all unclaimed</button>
                    <button className="button-link" type="button" onClick={() => {
                      setSelectedEntitlementIds(new Set());
                      clearVerifiedChallenge();
                    }}>clear selection</button>
                  </div>
                )}
                <ul>
                  {entitlements.map((entitlement) => (
                    <li key={entitlement.id}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${wttEntitlementSourceLabel(entitlement)}`}
                        checked={entitlement.status === 'unclaimed' && selectedEntitlementIds.has(entitlement.id)}
                        disabled={entitlement.status !== 'unclaimed'}
                        onChange={(event) => changeSelection(entitlement.id, event.target.checked)}
                      />
                      <div>
                        <h3><EntitlementSource entitlement={entitlement} /></h3>
                        <p>{entitlement.amount} WTT</p>
                        {entitlement.status === 'claimed' && (
                          <p>
                            sent to <span title={entitlement.claimedWallet}>{shortenSolanaAddress(entitlement.claimedWallet)}</span>
                            {' · '}
                            <a href={`https://solscan.io/tx/${encodeURIComponent(entitlement.claimTransaction)}`}
                              target="_blank" rel="noreferrer">transaction</a>
                          </p>
                        )}
                      </div>
                      <strong className={`wtt-status wtt-status-${entitlement.status}`}>
                        {entitlement.status === 'claiming' ? 'claim in progress' : entitlement.status}
                      </strong>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          ))}

          <button className="button-link" type="button" onClick={handleSignOut} disabled={busy}>
            {busy ? 'signing out…' : 'sign out'}
          </button>
        </>
      )}
    </section>
  );
}
