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
  createWttClaimPreview,
  resolveWttClaimPreview,
  WTT_PREVIEW_WALLET,
  type WttClaimPreviewKind,
} from '../wtt-claim-preview';
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

type ClaimStepState = 'complete' | 'current' | 'pending';

function ClaimProgress({
  hasClaimableWtt,
  walletConnected,
  walletVerified,
  claimInProgress,
  allClaimed,
}: {
  hasClaimableWtt: boolean;
  walletConnected: boolean;
  walletVerified: boolean;
  claimInProgress: boolean;
  allClaimed: boolean;
}) {
  const walletComplete = walletConnected || walletVerified || claimInProgress || allClaimed;
  const verificationComplete = walletVerified || claimInProgress || allClaimed;
  const steps: Array<{ label: string; state: ClaimStepState }> = [
    { label: 'find your wtt', state: 'complete' },
    {
      label: 'connect wallet',
      state: walletComplete ? 'complete' : hasClaimableWtt ? 'current' : 'pending',
    },
    {
      label: 'verify wallet',
      state: verificationComplete
        ? 'complete'
        : hasClaimableWtt && walletConnected ? 'current' : 'pending',
    },
    {
      label: 'claim',
      state: allClaimed ? 'complete' : claimInProgress || walletVerified ? 'current' : 'pending',
    },
  ];

  return (
    <nav aria-label="WTT claim progress">
      <ol className="wtt-claim-steps">
        {steps.map((step, index) => (
          <li key={step.label} data-state={step.state} aria-current={step.state === 'current' ? 'step' : undefined}>
            <span className="wtt-step-marker" aria-hidden="true">
              {step.state === 'complete' ? '✓' : index + 1}
            </span>
            <span>
              <span className="visually-hidden">{step.state}: </span>
              {step.label}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function WalletSetupHelp() {
  return (
    <details className="wtt-wallet-help">
      <summary>set up a wallet</summary>
      <div className="wtt-wallet-help-content">
        <h4>new to wallets?</h4>
        <p>A wallet is an app that lets you receive and hold WTT.</p>
        <ol>
          <li>
            <h5>get a Solana wallet</h5>
            <p>Phantom is an easy option for beginners. Other compatible Solana wallets work too.</p>
            <p>On desktop, Phantom installs as a browser extension. On mobile, it's an app.</p>
            <a className="button button-secondary" href="https://phantom.com/download" target="_blank" rel="noreferrer">
              get Phantom <span className="visually-hidden">(opens in a new tab)</span>
            </a>
          </li>
          <li>
            <h5>create a wallet</h5>
            <p>Follow the wallet provider's setup process. Use a self-custody wallet you control, not a crypto exchange deposit address.</p>
          </li>
          <li>
            <h5>back it up safely</h5>
            <p><strong>Who Touched This will NEVER ask for your recovery phrase or private key.</strong></p>
            <p>Store any recovery phrase safely and never share it. Never paste a recovery phrase into this page.</p>
          </li>
          <li>
            <h5>return to Who Touched This</h5>
            <p>Come back to this page and click <strong>connect wallet</strong>.</p>
          </li>
          <li>
            <h5>verify the wallet</h5>
            <p>Your wallet will ask you to sign a message. This is NOT a transaction, costs no SOL, does not send WTT, and does not give Who Touched This control of your wallet.</p>
          </li>
          <li>
            <h5>claim wtt</h5>
            <p>You explicitly click claim afterward. You do not need to buy SOL; Who Touched This pays the Solana network and token-account cost.</p>
          </li>
        </ol>
        <p>need help? <a href="mailto:hello@whotouchedthis.website">hello@whotouchedthis.website</a></p>
      </div>
    </details>
  );
}

export default function WttClaimPage() {
  const [previewKind, setPreviewKind] = useState<WttClaimPreviewKind | null>(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return null;
    return resolveWttClaimPreview(window.location.search, true);
  });
  const previewState = useMemo(
    () => import.meta.env.DEV && previewKind ? createWttClaimPreview(previewKind) : null,
    [previewKind],
  );
  const previewActive = import.meta.env.DEV && previewState !== null;
  const requestSequence = useRef(0);
  const verificationSequence = useRef(0);
  const [loading, setLoading] = useState(!previewState);
  const [busy, setBusy] = useState(false);
  const [identity, setIdentity] = useState<GitHubIdentity | null>(previewState?.identity ?? null);
  const [entitlements, setEntitlements] = useState<ParsedWttEntitlement[]>(previewState?.entitlements ?? []);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [wallets, setWallets] = useState<readonly MessageSigningWallet[]>(() => (
    previewState ? [] : availableMessageSigningWallets()
  ));
  const [selectedWalletName, setSelectedWalletName] = useState('');
  const [connection, setConnection] = useState<ConnectedSolanaWallet | null>(null);
  const [selectedEntitlementIds, setSelectedEntitlementIds] = useState<Set<string>>(() => new Set(
    previewState?.entitlements.filter((record) => record.status === 'unclaimed').map((record) => record.id) ?? [],
  ));
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
    if (previewActive) return;
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
    if (previewActive) return undefined;
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
  }, [previewActive]);

  useEffect(() => {
    if (previewActive) return undefined;
    return watchMessageSigningWallets((nextWallets) => {
      setWallets(nextWallets);
      setSelectedWalletName((current) => current || nextWallets[0]?.name || '');
    });
  }, [previewActive]);

  useEffect(() => {
    if (previewActive) return undefined;
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
  }, [connection, previewActive]);

  async function handleSignIn() {
    if (previewActive) return;
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
    if (previewActive) return;
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
  const claimInProgress = claimBusy || inProgressClaims.length > 0;
  const allEntitlementsClaimed = entitlements.length > 0 && totals.unclaimed === 0;
  const displayedWalletAddress = connection?.account.address ?? previewState?.walletAddress ?? null;
  const displayedVerifiedChallenge = verifiedChallenge ?? (
    previewActive && previewKind === 'verified' ? {
      challengeId: 'local-preview-challenge',
      status: 'verified' as const,
      walletAddress: WTT_PREVIEW_WALLET,
      entitlementIds: [...selectedEntitlementIds].sort(),
      amount: selectedAmount,
      verifiedAt: '2026-01-01T00:05:00.000Z',
    } : null
  );

  function changeSelection(entitlementId: string, selected: boolean) {
    setSelectedEntitlementIds((current) => {
      const next = new Set(current);
      if (selected) next.add(entitlementId);
      else next.delete(entitlementId);
      return next;
    });
    if (previewActive && previewKind === 'verified') setPreviewKind('connected');
    clearVerifiedChallenge();
    setWalletMessage(null);
  }

  async function handleConnectWallet() {
    if (previewActive) {
      setPreviewKind('connected');
      setWalletMessage('local preview wallet connected. no wallet API was called.');
      return;
    }
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
    if (previewActive) {
      if (selectedEntitlementIds.size === 0) return;
      setPreviewKind('verified');
      setWalletMessage('wallet ownership verified. nothing has been minted yet.');
      return;
    }
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
    if (previewActive) {
      setClaimMessage(`local preview only. ${claimId} was not submitted.`);
      return;
    }
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
      <h1 id="wtt-claim-heading">wtt</h1>
      {previewActive && <p className="wtt-preview-label">local preview — no real wallet or wtt</p>}
      <p className="wtt-intro">a crypto token that can only be earned by touching the website</p>
      <section className="wtt-about" aria-labelledby="wtt-about-heading">
        <h2 id="wtt-about-heading">what is wtt?</h2>
        <p>WTT is a crypto token on Solana. think of it like a little digital coin: an artifact & reward for participating in Who Touched This.</p>
        <p>WTT is not required to participate. claiming your wtt is optional & free. you don't need to buy SOL or pay anything to claim it. we cover the Solana fees, & earned wtt does not expire.</p>
        <p>wtt can't be bought (for now), sold (for now), traded (for now), or transferred (for now). the only way to get one is to earn it by contributing to Who Touched This.</p>
        <p>we first use GitHub to find the WTT you earned. then you choose a wallet to receive it.</p>
        <p>
          <a
            href="https://explorer.solana.com/address/B6GqRNfVZ5aW2mkB4u7PJqAvh49qCaEF7uHUoPgRnQet"
            target="_blank"
            rel="noreferrer"
          >
            view wtt on solana ↗
          </a>
        </p>
      </section>

      {errorMessage && <p className="notice notice-error" role="alert">{errorMessage}</p>}

      {loading ? (
        <p role="status">checking GitHub &amp; WTT records…</p>
      ) : !identity ? (
        <section className="wtt-auth-panel" aria-labelledby="wtt-sign-in-heading">
          <h2 id="wtt-sign-in-heading">find your wtt</h2>
          <p>if you've contributed to Who Touched This, sign in with the same GitHub account you used to participate.</p>
          <button className="button" type="button" onClick={handleSignIn} disabled={busy}>
            {busy ? 'opening GitHub…' : 'continue with GitHub'}
          </button>
          <p className="wtt-auth-reassurance">
            you don't need a crypto wallet yet.<br />
            if you have WTT to claim, we'll walk you through it.
          </p>
        </section>
      ) : (
        <>
          <section className="github-identity" aria-labelledby="wtt-github-identity-heading">
            <div>
              <h2 id="wtt-github-identity-heading">signed in with GitHub</h2>
              {identity.githubUsername ? (
                <p><a href={identity.profileUrl ?? undefined} rel="noreferrer">@{identity.githubUsername}</a></p>
              ) : <p>GitHub account connected.</p>}
            </div>
            {identity.avatarUrl && (
              <img className="github-avatar" src={identity.avatarUrl} alt="" width="64" height="64" referrerPolicy="no-referrer" />
            )}
          </section>

          <ClaimProgress
            hasClaimableWtt={unclaimedIds.length > 0}
            walletConnected={Boolean(displayedWalletAddress)}
            walletVerified={Boolean(displayedVerifiedChallenge)}
            claimInProgress={claimInProgress}
            allClaimed={allEntitlementsClaimed}
          />

          {!errorMessage && (entitlements.length === 0 ? (
            <section className="empty-state" aria-labelledby="wtt-empty-heading">
              <h2 id="wtt-empty-heading">no wtt waiting for you</h2>
              <p>there is currently no WTT waiting for this GitHub account.</p>
              <p>Eligible contributions and awards will appear here. Earned WTT does not expire.</p>
              <p>You don't need to set up a wallet unless WTT appears here to claim.</p>
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
                  <p className="notice">all caught up. your wtt history is below.</p>
                ) : null}
              </section>

              <section className="wtt-entitlements" aria-labelledby="wtt-entitlements-heading">
                <h2 id="wtt-entitlements-heading">your wtt</h2>
                {unclaimedIds.length > 1 && (
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
                      {entitlement.status === 'unclaimed' && (
                        <input
                          type="checkbox"
                          aria-label={`Select ${wttEntitlementSourceLabel(entitlement)}`}
                          checked={selectedEntitlementIds.has(entitlement.id)}
                          onChange={(event) => changeSelection(entitlement.id, event.target.checked)}
                        />
                      )}
                      <div>
                        <h3><EntitlementSource entitlement={entitlement} /></h3>
                        <p>{entitlement.amount} WTT</p>
                        {entitlement.status === 'claimed' && (
                          <p>
                            sent to <span title={entitlement.claimedWallet}>{shortenSolanaAddress(entitlement.claimedWallet)}</span>
                            {' · '}
                            <a href={`https://solscan.io/tx/${encodeURIComponent(entitlement.claimTransaction)}`}
                              target="_blank" rel="noreferrer">view transaction</a>
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

              {unclaimedIds.length > 0 && (
                <section className="wtt-wallet-panel" aria-labelledby="wtt-wallet-heading">
                  <h3 id="wtt-wallet-heading">where should we send it?</h3>
                  <p>WTT lives on Solana, so you'll need a compatible Solana wallet to receive it.</p>
                  <p className="wtt-selected-amount"><strong>{selectedAmount} WTT selected</strong></p>
                  {!displayedWalletAddress ? (
                    <>
                      <div className="wtt-wallet-connect">
                        {previewActive ? (
                          <p>an obviously fake compatible wallet is available for this local preview.</p>
                        ) : wallets.length > 0 ? (
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
                          <p>No compatible Solana wallet was found in this browser. Phantom and other Wallet Standard wallets are supported.</p>
                        )}
                        <button className="button" type="button" onClick={handleConnectWallet}
                          disabled={walletBusy || (!previewActive && wallets.length === 0)}>
                          {walletBusy ? 'connecting…' : 'connect wallet'}
                        </button>
                      </div>
                      <div className="wtt-wallet-setup-prompt">
                        <span>don't have one?</span>
                        <WalletSetupHelp />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="wtt-connected-wallet">
                        <p>wallet</p>
                        <strong title={displayedWalletAddress}>{shortenSolanaAddress(displayedWalletAddress)}</strong>
                        {displayedVerifiedChallenge && <span className="wtt-verified">✓ verified</span>}
                        <button className="button-link" type="button" disabled={walletBusy} onClick={() => {
                          if (previewActive) setPreviewKind('unclaimed');
                          else setConnection(null);
                          clearVerifiedChallenge();
                          setWalletMessage(null);
                        }}>change wallet</button>
                      </div>
                      {!displayedVerifiedChallenge && (
                        <p><strong>Signing this message is not a transaction and costs no SOL.</strong> It does not send WTT or give Who Touched This control of your wallet.</p>
                      )}
                    </>
                  )}
                  {displayedWalletAddress && !displayedVerifiedChallenge && (
                    <button className="button" type="button" onClick={handleVerifyWallet}
                      disabled={walletBusy || selectedEntitlementIds.size === 0}>
                      {walletBusy ? 'waiting for wallet…' : 'verify wallet'}
                    </button>
                  )}
                  {displayedWalletAddress && displayedVerifiedChallenge && (
                    <button className="button" type="button"
                      onClick={() => handleClaim(displayedVerifiedChallenge.challengeId)} disabled={claimBusy}>
                      {claimBusy ? 'claiming…' : `claim ${displayedVerifiedChallenge.amount} wtt`}
                    </button>
                  )}
                  {walletMessage && <p className={displayedVerifiedChallenge ? 'notice' : 'notice notice-error'} role="status">{walletMessage}</p>}
                </section>
              )}

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
            </>
          ))}

          <button className="button-link" type="button" onClick={handleSignOut} disabled={busy || previewActive}>
            {busy ? 'signing out…' : 'sign out'}
          </button>
        </>
      )}
    </section>
  );
}
