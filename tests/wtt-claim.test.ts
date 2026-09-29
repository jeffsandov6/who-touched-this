import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  calculateWttEntitlementTotals,
  parseWttEntitlement,
  wttEntitlementSourceLabel,
  type ParsedWttEntitlement,
} from '../src/platform/wtt-entitlements.ts';
import {
  createWttClaimPreview,
  resolveWttClaimPreview,
  WTT_CLAIM_PREVIEW_KINDS,
  WTT_PREVIEW_TRANSACTION,
  WTT_PREVIEW_WALLET,
} from '../src/platform/wtt-claim-preview.ts';

const timestamp = (milliseconds: number) => ({ toDate: () => new Date(milliseconds) });

function record(sourceId: string, overrides: Record<string, unknown> = {}) {
  return {
    sourceType: 'contribution', sourceId, githubProviderId: '1001', contributorId: '1001',
    amount: 1, status: 'unclaimed', claimId: null, earnedAt: timestamp(Number(sourceId) * 1000),
    claimedAt: null, claimedWallet: null, claimTransaction: null, ...overrides,
  };
}

function parse(sourceId: string, overrides: Record<string, unknown> = {}) {
  return parseWttEntitlement(`contribution:${sourceId}`, record(sourceId, overrides), '1001');
}

test('no-entitlement state totals are all zero', () => {
  assert.deepEqual(calculateWttEntitlementTotals([]), { earned: 0, unclaimed: 0, claimed: 0 });
});

test('multiple entitlements for one stable GitHub identity parse independently', () => {
  const entitlements = ['12', '47', '81'].map((sourceId) => parse(sourceId));
  assert.equal(entitlements.every(Boolean), true);
  assert.deepEqual(calculateWttEntitlementTotals(entitlements as ParsedWttEntitlement[]), {
    earned: 3, unclaimed: 3, claimed: 0,
  });
  assert.equal(wttEntitlementSourceLabel(entitlements[0]!), 'Contribution #012');
});

test('claimed and unclaimed amounts coexist in earned totals', () => {
  const claimed = parse('12', {
    amount: 2, status: 'claimed', claimId: 'claim-1', claimedAt: timestamp(20_000),
    claimedWallet: 'FakeWallet111111111111111111111111111111', claimTransaction: 'fake-tx-1',
  });
  const unclaimed = parse('47');
  assert.ok(claimed && unclaimed);
  assert.deepEqual(calculateWttEntitlementTotals([claimed, unclaimed]), {
    earned: 3, unclaimed: 1, claimed: 2,
  });
});

test('all-claimed totals leave nothing unclaimed while preserving earned history', () => {
  const claimed = ['12', '47'].map((sourceId, index) => parse(sourceId, {
    status: 'claimed', claimId: `claim-${index + 1}`, claimedAt: timestamp(20_000 + index),
    claimedWallet: `FakeWallet${index + 1}`, claimTransaction: `fake-tx-${index + 1}`,
  })) as ParsedWttEntitlement[];
  assert.deepEqual(calculateWttEntitlementTotals(claimed), {
    earned: 2, unclaimed: 0, claimed: 2,
  });
});

test('claiming remains unclaimed in public totals and final claim fields parse safely', () => {
  const claiming = parse('12', { status: 'claiming', claimId: 'challenge-12' });
  const claimed = parse('47', {
    status: 'claimed', claimId: 'challenge-47', claimedAt: timestamp(47_000),
    claimedWallet: 'RecipientWallet', claimTransaction: 'confirmed-signature',
  });
  assert.ok(claiming && claimed);
  assert.deepEqual(calculateWttEntitlementTotals([claiming, claimed]), {
    earned: 2, unclaimed: 1, claimed: 1,
  });
  assert.equal(claiming.status, 'claiming');
  assert.equal(claimed.status, 'claimed');
  assert.equal(claimed.claimedWallet, 'RecipientWallet');
  assert.equal(claimed.claimTransaction, 'confirmed-signature');
  assert.equal(parse('81', {
    status: 'claimed', claimId: 'challenge-81', claimedAt: timestamp(81_000),
    claimedWallet: null, claimTransaction: null,
  }), null);
});

test('records cannot cross GitHub identities and malformed claim state fails closed', () => {
  assert.equal(parseWttEntitlement('contribution:12', record('12'), '2002'), null);
  assert.equal(parse('12', { githubProviderId: 'mutable-username' }), null);
  assert.equal(parse('12', { status: 'claimed', claimId: null, claimedAt: null }), null);
  assert.equal(parseWttEntitlement('contribution:13', record('12'), '1001'), null);
});

test('future source types have centralized display labels', () => {
  const base = parse('12')!;
  assert.equal(wttEntitlementSourceLabel({ ...base, id: 'easter_egg:first-touch', sourceType: 'easter_egg', sourceId: 'first-touch' }), 'Easter egg: first-touch');
  assert.equal(wttEntitlementSourceLabel({ ...base, id: 'game:cursor-run', sourceType: 'game', sourceId: 'cursor-run' }), 'Game: cursor-run');
  assert.equal(wttEntitlementSourceLabel({ ...base, id: 'season_bonus:2', sourceType: 'season_bonus', sourceId: '2' }), 'Season 2 bonus');
});

test('claim page presents signed-out, empty, totals, history, wallet, and all-claimed states', async () => {
  const source = await readFile(new URL('../src/platform/pages/WttClaimPage.tsx', import.meta.url), 'utf8');
  for (const text of [
    'continue with GitHub',
    "you don't need a crypto wallet yet",
    'no wtt waiting for you',
    "you've earned {totals.earned} wtt",
    'where should we send it?',
    'connect wallet',
    'verify wallet',
    'Signing this message is not a transaction and costs no SOL.',
    'wallet ownership verified. nothing has been minted yet.',
    'claim ${displayedVerifiedChallenge.amount} wtt',
    'claim in progress',
    'resume claim',
    'view confirmed transaction on Solscan',
    'all caught up. your wtt history is below.',
    'view transaction',
    'entitlement.status',
    'WTT is a crypto token on Solana. think of it like a little digital coin: an artifact & reward for participating in Who Touched This.',
    "WTT is not required to participate. claiming your wtt is optional & free. you don't need to buy SOL or pay anything to claim it. we cover the Solana fees, & earned wtt does not expire.",
    'Who Touched This will NEVER ask for your recovery phrase or private key.',
    'Never paste a recovery phrase into this page.',
    'not a crypto exchange deposit address',
    'You do not need to buy SOL',
    'Who Touched This pays the Solana network and token-account cost.',
    'hello@whotouchedthis.website',
  ]) assert.ok(source.includes(text), text);
  assert.match(source, /entitlements\.map\(\(entitlement\)/);
  assert.match(source, /href=\{`\/history\/\$\{entitlement\.sourceId\}`\}/);
});

test('local preview parameters resolve only when development is explicitly enabled', () => {
  for (const kind of WTT_CLAIM_PREVIEW_KINDS) {
    assert.equal(resolveWttClaimPreview(`?preview=${kind}`, true), kind);
    assert.equal(resolveWttClaimPreview(`?preview=${kind}`, false), null);
  }
  assert.equal(resolveWttClaimPreview('?preview=unknown', true), null);
  assert.equal(resolveWttClaimPreview('', true), null);
});

test('local unclaimed preview has exactly one fake founder entitlement', () => {
  const preview = createWttClaimPreview('unclaimed');
  assert.equal(preview.identity.firebaseUid, 'local-preview-firebase-user');
  assert.equal(preview.identity.githubUserId, '999999999');
  assert.equal(preview.walletAddress, null);
  assert.equal(preview.walletVerified, false);
  assert.deepEqual(preview.entitlements.map((entitlement) => ({
    id: entitlement.id,
    sourceId: entitlement.sourceId,
    amount: entitlement.amount,
    status: entitlement.status,
  })), [{ id: 'contribution:0', sourceId: '0', amount: 1, status: 'unclaimed' }]);
  assert.equal(wttEntitlementSourceLabel(preview.entitlements[0]!), 'Contribution #000');
});

test('preview fixtures cover the real states with obviously fake chain values', () => {
  assert.equal(createWttClaimPreview('no-entitlements').entitlements.length, 0);
  assert.equal(createWttClaimPreview('multiple').entitlements.length, 3);
  assert.equal(createWttClaimPreview('connected').walletAddress, WTT_PREVIEW_WALLET);
  assert.equal(createWttClaimPreview('verified').walletVerified, true);
  assert.equal(createWttClaimPreview('claiming').entitlements[0]?.status, 'claiming');
  const claimed = createWttClaimPreview('claimed').entitlements[0];
  assert.equal(claimed?.status, 'claimed');
  if (claimed?.status === 'claimed') {
    assert.equal(claimed.claimedWallet, WTT_PREVIEW_WALLET);
    assert.equal(claimed.claimTransaction, WTT_PREVIEW_TRANSACTION);
  }
});

test('claim page development preview gates every external-effect entry point', async () => {
  const source = await readFile(new URL('../src/platform/pages/WttClaimPage.tsx', import.meta.url), 'utf8');
  const route = await readFile(new URL('../src/pages/wtt/claim.astro', import.meta.url), 'utf8');
  const layout = await readFile(new URL('../src/platform/layouts/PlatformLayout.astro', import.meta.url), 'utf8');
  const siteStatus = await readFile(new URL('../src/platform/components/SiteStatus.tsx', import.meta.url), 'utf8');
  assert.match(source, /if \(!import\.meta\.env\.DEV \|\| typeof window === 'undefined'\) return null;/);
  assert.match(source, /previewState \? \[\] : availableMessageSigningWallets\(\)/);
  assert.match(source, /const previewActive = import\.meta\.env\.DEV && previewState !== null;/);
  assert.match(source, /useEffect\(\(\) => \{\s*if \(previewActive\) return undefined;[\s\S]*observeAuthState/);
  assert.match(source, /useEffect\(\(\) => \{\s*if \(previewActive\) return undefined;\s*return watchMessageSigningWallets/);
  assert.match(source, /async function handleConnectWallet\(\) \{\s*if \(previewActive\)/);
  assert.match(source, /async function handleVerifyWallet\(\) \{\s*if \(previewActive\)/);
  assert.match(source, /async function handleClaim\(claimId: string\) \{\s*if \(previewActive\)/);
  assert.ok(source.includes('local preview — no real wallet or wtt'));
  assert.match(route, /resolveWttClaimPreview\(Astro\.url\.search, import\.meta\.env\.DEV\)/);
  assert.match(route, /backendFreePreview=\{localPreview !== null\}/);
  assert.match(layout, /contributorPreview \|\| backendFreePreview \? <ContributorSiteStatus \/> : <SiteStatus client:load \/>/);
  assert.match(siteStatus, /if \(localWttPreview\) return undefined;[\s\S]*subscribeToPublicSiteState/);
});

test('signed-out hierarchy makes GitHub the primary action and defers wallet setup', async () => {
  const source = await readFile(new URL('../src/platform/pages/WttClaimPage.tsx', import.meta.url), 'utf8');
  const signedOutStart = source.indexOf('<section className="wtt-auth-panel"');
  const authenticatedStart = source.indexOf('<section className="github-identity"');
  const signedOut = source.slice(signedOutStart, authenticatedStart);

  assert.ok(signedOutStart > 0 && authenticatedStart > signedOutStart);
  assert.ok(signedOut.includes('find your wtt'));
  assert.ok(signedOut.includes('continue with GitHub'));
  assert.ok(signedOut.includes("you don't need a crypto wallet yet"));
  assert.doesNotMatch(signedOut, /WalletSetupHelp|connect wallet|phantom\.com/i);
  assert.equal(source.match(/<WalletSetupHelp \/>/g)?.length, 1);
  assert.ok(source.indexOf('<WalletSetupHelp />') > authenticatedStart);
});

test('authenticated claim UX presents entitlements before its prominent wallet action', async () => {
  const source = await readFile(new URL('../src/platform/pages/WttClaimPage.tsx', import.meta.url), 'utf8');
  const authenticatedStart = source.indexOf('<section className="github-identity"');
  const entitlementsStart = source.indexOf('<section className="wtt-entitlements"', authenticatedStart);
  const walletStart = source.indexOf('<section className="wtt-wallet-panel"', authenticatedStart);

  assert.ok(entitlementsStart > authenticatedStart);
  assert.ok(walletStart > entitlementsStart);
  assert.match(source, /\{unclaimedIds\.length > 0 && \(\s*<section className="wtt-wallet-panel"/);
  assert.ok(source.includes("there is currently no WTT waiting for this GitHub account."));
  assert.ok(source.includes("You don't need to set up a wallet unless WTT appears here to claim."));
});

test('authenticated identity card shows the GitHub username without exposing its numeric provider ID', async () => {
  const source = await readFile(new URL('../src/platform/pages/WttClaimPage.tsx', import.meta.url), 'utf8');
  const identityStart = source.indexOf('<section className="github-identity"');
  const identityEnd = source.indexOf('</section>', identityStart);
  const identityCard = source.slice(identityStart, identityEnd);
  assert.ok(identityCard.includes('signed in with GitHub'));
  assert.ok(identityCard.includes('@{identity.githubUsername}'));
  assert.doesNotMatch(identityCard, /githubUserId|GitHub account ID|provider ID/i);
  assert.match(source, /loadOwnWttEntitlements\(nextIdentity\.githubUserId\)/);
});

test('entitlement history uses one heading and only offers bulk controls for multiple choices', async () => {
  const source = await readFile(new URL('../src/platform/pages/WttClaimPage.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes('<h2 id="wtt-entitlements-heading">your wtt</h2>'));
  assert.match(source, /\{unclaimedIds\.length > 1 && \(\s*<div className="wtt-selection-actions">/);
  assert.ok(source.includes('select all unclaimed'));
  assert.ok(source.includes('clear selection'));
  assert.match(source, /records\.filter\(\(record\) => record\.status === 'unclaimed'\)\.map\(\(record\) => record\.id\)/);
});

test('only unclaimed entitlement rows render selection checkboxes', async () => {
  const source = await readFile(new URL('../src/platform/pages/WttClaimPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /\{entitlement\.status === 'unclaimed' && \(\s*<input[\s\S]*?type="checkbox"/);
  assert.doesNotMatch(source, /disabled=\{entitlement\.status !== 'unclaimed'\}/);
  assert.match(source, /checked=\{selectedEntitlementIds\.has\(entitlement\.id\)\}/);
});

test('claimed presentation uses final history wording and preserves its Solscan link', async () => {
  const source = await readFile(new URL('../src/platform/pages/WttClaimPage.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes('all caught up. your wtt history is below.'));
  assert.match(source, /href=\{`https:\/\/solscan\.io\/tx\/\$\{encodeURIComponent\(entitlement\.claimTransaction\)\}`\}[\s\S]*?>view transaction<\/a>/);
});

test('beginner wallet disclosure is actionable, provider-neutral, and safety-forward', async () => {
  const source = await readFile(new URL('../src/platform/pages/WttClaimPage.tsx', import.meta.url), 'utf8');
  for (const text of [
    '<details className="wtt-wallet-help">',
    '<summary>set up a wallet</summary>',
    'A wallet is an app that lets you receive and hold WTT.',
    'Phantom is an easy option for beginners. Other compatible Solana wallets work too.',
    "On desktop, Phantom installs as a browser extension. On mobile, it's an app.",
    'href="https://phantom.com/download"',
    'self-custody wallet you control',
    'not a crypto exchange deposit address',
    'Who Touched This will NEVER ask for your recovery phrase or private key.',
    'Never paste a recovery phrase into this page.',
    'does not give Who Touched This control of your wallet',
    'You do not need to buy SOL',
    'Who Touched This pays the Solana network and token-account cost.',
    'hello@whotouchedthis.website',
  ]) assert.ok(source.includes(text), text);
  assert.match(source, /target="_blank" rel="noreferrer"/);
  const walletHelp = source.slice(source.indexOf('function WalletSetupHelp'), source.indexOf('export default function WttClaimPage'));
  assert.ok(walletHelp.includes('Come back to this page and click'));
  assert.doesNotMatch(walletHelp, /\/wtt\/claim/);
});

test('claim progress reflects connection, verification, claiming, and completed history', async () => {
  const source = await readFile(new URL('../src/platform/pages/WttClaimPage.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes('aria-label="WTT claim progress"'));
  assert.ok(source.includes("{ label: 'find your wtt', state: 'complete' }"));
  assert.match(source, /walletComplete \? 'complete' : hasClaimableWtt \? 'current' : 'pending'/);
  assert.match(source, /hasClaimableWtt && walletConnected \? 'current' : 'pending'/);
  assert.match(source, /allClaimed \? 'complete' : claimInProgress \|\| walletVerified \? 'current' : 'pending'/);
  assert.match(source, /claimInProgress=\{claimInProgress\}/);
  assert.match(source, /allClaimed=\{allEntitlementsClaimed\}/);
  assert.ok(source.includes('wallet ownership verified. nothing has been minted yet.'));
});

test('an expired pre-reservation challenge returns the page to wallet verification', async () => {
  const source = await readFile(new URL('../src/platform/pages/WttClaimPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /includes\('challenge has expired'\)[\s\S]*clearVerifiedChallenge\(\)/);
  assert.ok(source.includes('verify the wallet again'));
});

test('admin completion-email recovery calls the protected resend operation only', async () => {
  const admin = await readFile(new URL('../src/platform/pages/AdminPage.tsx', import.meta.url), 'utf8');
  const service = await readFile(new URL('../src/platform/firebase/email-deliveries.ts', import.meta.url), 'utf8');
  assert.ok(admin.includes('completion email recovery'));
  assert.ok(admin.includes('This does not create or change an entitlement.'));
  assert.match(admin, /resendContributionCompletedEmail\(contributionNumber\)/);
  assert.match(service, /'resendContributionCompletedEmail'/);
  assert.doesNotMatch(service, /wttEntitlements|claimId|status:\s*'unclaimed'/);
});

test('claim page selection supports many unclaimed records while claimed history remains non-selectable', async () => {
  const source = await readFile(new URL('../src/platform/pages/WttClaimPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /new Set\(unclaimedIds\)/);
  assert.match(source, /selectedEntitlementIds\.has\(entitlement\.id\)/);
  assert.match(source, /entitlement\.status === 'unclaimed' && \(/);
  assert.match(source, /selectedEntitlementIds\.size === 0/);
  assert.ok(source.includes('select all unclaimed'));
  assert.ok(source.includes('clear selection'));
  assert.match(source, /filter\(\(entitlement\) => entitlement\.status === 'unclaimed'\)/);
  assert.match(source, /if \(entitlement\.status !== 'claiming'\) continue/);
});

test('claim execution sends only challengeId and guards repeat clicks', async () => {
  const page = await readFile(new URL('../src/platform/pages/WttClaimPage.tsx', import.meta.url), 'utf8');
  const callable = await readFile(new URL('../src/platform/firebase/wtt-claim-challenges.ts', import.meta.url), 'utf8');
  assert.match(callable, /callable\(\{ challengeId \}\)/);
  assert.match(page, /if \(!identity \|\| claimBusy\) return/);
  assert.match(page, /disabled=\{claimBusy\}/);
  assert.match(page, /claimWtt\(claimId\)/);
  assert.match(page, /handleClaim\(claim\.claimId\)/);
  assert.match(page, /https:\/\/solscan\.io\/tx/);
});

test('selection and wallet changes clear the local verified state', async () => {
  const source = await readFile(new URL('../src/platform/pages/WttClaimPage.tsx', import.meta.url), 'utf8');
  const resets = source.match(/clearVerifiedChallenge\(\)/g) ?? [];
  assert.ok(resets.length >= 6, 'verified state is reset across auth, selection, and wallet changes');
  assert.match(source, /changeSelection[\s\S]*clearVerifiedChallenge\(\)/);
  assert.match(source, /account\.address !== connection\.account\.address[\s\S]*clearVerifiedChallenge\(\)/);
  assert.match(source, /verificationRequest === verificationSequence\.current/);
});
