# WTT deployment and Founder #000 rehearsal

This is a runbook for the next checkpoint. None of these production commands
were run while preparing this document.

## Fixed production contract

- Firebase project: `who-touched-this`
- key project: `who-touched-this-keys`
- region: `us-central1`
- claim runtime service account:
  `wtt-claim-signer@who-touched-this.iam.gserviceaccount.com`
- runtime KMS key: `wtt-mainnet/wtt-operational-mainnet`, version `1`
- WTT RPC variable: `WTT_SOLANA_RPC_URL`; it must be a public HTTPS mainnet
  endpoint. The official public endpoint is suitable only for the single
  controlled rehearsal.

The founder's recipient wallet is deliberately not stored here. The recipient
must come from the wallet connected to, and verified by, the claim page.

## Minimum IAM and API preparation

The current local Firebase/gcloud deploy identity is
`user:jeffrysandoval24@gmail.com`. Reconfirm that identity immediately before
deployment; substitute the actual deployer below if it changes.

Read the policies before making either binding:

```sh
gcloud projects get-iam-policy who-touched-this \
  --flatten='bindings[].members' \
  --filter='bindings.members:wtt-claim-signer@who-touched-this.iam.gserviceaccount.com'

gcloud kms keys get-iam-policy wtt-operational-mainnet \
  --project=who-touched-this-keys \
  --location=us-central1 \
  --keyring=wtt-mainnet

gcloud iam service-accounts get-iam-policy \
  wtt-claim-signer@who-touched-this.iam.gserviceaccount.com \
  --project=who-touched-this
```

The only new runtime grant expected is Firestore read/write access:

```sh
gcloud projects add-iam-policy-binding who-touched-this \
  --member='serviceAccount:wtt-claim-signer@who-touched-this.iam.gserviceaccount.com' \
  --role='roles/datastore.user'
```

The deployer must be allowed to attach the runtime identity:

```sh
gcloud iam service-accounts add-iam-policy-binding \
  wtt-claim-signer@who-touched-this.iam.gserviceaccount.com \
  --project=who-touched-this \
  --member='user:jeffrysandoval24@gmail.com' \
  --role='roles/iam.serviceAccountUser'
```

Do not grant KMS permissions in `who-touched-this`. Confirm the existing
cross-project policy gives that runtime service account only
`roles/cloudkms.signerVerifier` on `wtt-operational-mainnet`, not the metadata
key.

Enable or verify the deployment/runtime APIs:

```sh
gcloud services enable \
  cloudfunctions.googleapis.com run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com eventarc.googleapis.com pubsub.googleapis.com \
  firestore.googleapis.com cloudkms.googleapis.com secretmanager.googleapis.com \
  logging.googleapis.com \
  --project=who-touched-this

gcloud services enable cloudkms.googleapis.com \
  --project=who-touched-this-keys
```

No extra logging role is needed for normal Cloud Run functions stdout/stderr.
No extra callable invoker configuration is expected: Firebase callable
deployment keeps the HTTPS endpoint invokable and `claimWtt` enforces Firebase
authentication in application code. Verify after deployment that an
unauthenticated callable request reaches the function and is rejected as
`unauthenticated` rather than being blocked by an unintended IAM policy.

The standard Cloud Functions and Cloud Build service agents should retain their
Google-managed roles. A custom runtime identity does not by itself require a
new grant to those agents. If deployment reports `iam.serviceAccounts.actAs`,
fix the deployer's binding above; do not broaden the runtime account's roles.

## Runtime configuration and controlled deployment

Set non-secret Functions environment values in the established Functions env
file/configuration before preflight:

```text
EMAIL_PROVIDER_MODE=resend
APP_ORIGIN=https://whotouchedthis.website
GITHUB_REPOSITORY=jeffsandov6/who-touched-this
GITHUB_BASE_BRANCH=main
WTT_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

`RESEND_API_KEY` and `GITHUB_WEBHOOK_SECRET` remain Firebase secrets. There is
no private key, seed phrase, service-account JSON, or RPC API key in source.

Run the complete local verification matrix, then deploy in this order:

```sh
npm run release:preflight
npm run deploy:rules
npm run deploy:functions
npm run deploy:hosting
```

Immediately inspect the deployed `claimWtt` revision and confirm its runtime
service account is exactly the dedicated claim signer. Confirm the challenge
functions use their ordinary runtime identity.

## Founder #000 preflight

Stop if any item does not match.

1. Query the mainnet mint read-only. Confirm the address, Classic SPL Token
   Program owner, decimals `0`, supply `0`, and both authorities equal the
   operational authority. Confirm neither authority has been revoked.
2. Fetch `https://whotouchedthis.website/wtt/metadata.json`; validate its JSON,
   mint/name/symbol/image references, and confirm the on-chain metadata still
   points to that URL with the expected metadata authority.
3. Check the operational authority's mainnet SOL balance. It must remain above
   the code threshold after allowing for ATA rent and transaction fees. Top-up
   is a separate explicitly approved operation.
4. Reconfirm the key-scoped KMS policy and use IAM Policy Troubleshooter (or an
   approved harmless signing probe under the runtime identity) to verify
   `cloudkms.cryptoKeyVersions.useToSign`. Verify the KMS public key corresponds
   to the operational Solana address. Never export private material.
5. Run `npm --prefix functions run wtt:reconcile -- --project=who-touched-this`
   in dry-run mode. Review every conflict. Do not apply until the report is
   clean and the intended contribution record exists.
6. Confirm `admins/<founder numeric GitHub ID>.founderCompletionEmail` has the intended
   private contact email and the record is the matching active owner. Founder #000 must not have
   contributor, participation, queue, invitation, or turn records. Then inspect `contributions/0` and
   `wttEntitlements/contribution:0` through an authorized read-only admin path.
   Exactly one canonical entitlement must exist, be owned by that same numeric
   GitHub provider ID, have amount `1`, and be `unclaimed`. There must be no
   fake/test production entitlement.

   For an already-recorded Founder contribution, inspect the dry-run first:

   ```sh
   npm --prefix functions run founder:repair-contact -- \
     --project=who-touched-this --email='<intended private address>'
   ```

   After reviewing the identity checks and exact two-field write, separately approve apply mode:

   ```sh
   npm --prefix functions run founder:repair-contact -- \
     --project=who-touched-this --email='<intended private address>' \
     --apply --confirm-project=who-touched-this
   ```
7. If the canonical entitlement is missing and the dry-run reports only valid
   missing records, separately approve and run:

   ```sh
   npm --prefix functions run wtt:reconcile -- \
     --project=who-touched-this --apply --confirm-project=who-touched-this
   ```

8. Confirm the completion email contains the universal `/wtt/claim` URL and
   that its delivery record is sent. After a contact repair, first allow the retry-enabled original
   delivery to settle; use the admin resend only if the canonical delivery remains failed. A resend
   uses a new delivery ID, so sending it while the original retry is live can duplicate the email.
   Neither path alters the entitlement.
9. Smoke-test the three callable endpoints. Unauthenticated issue, verify, and
   claim calls must reject. A normal authenticated challenge must work. Direct
   browser get/list/create/update/delete against `wttClaimChallenges` and
   `wttClaims`, and browser writes against `wttEntitlements`, must fail.
10. Confirm there is no existing `wttClaims` record for the rehearsal and no
    prepared/submitted attempt tied to contribution #000.

## Controlled first claim

1. Founder opens `/wtt/claim` and signs in with the GitHub account whose numeric
   provider ID owns `contribution:0`.
2. Founder selects only Contribution #000, connects the intended personal
   Phantom wallet, and compares the full address in the wallet and UI.
3. Founder explicitly verifies the wallet by signing the exact message. Confirm
   the prompt says it is not a transaction, amount is `1`, and entitlement is
   `contribution:0`.
4. Recheck supply `0` and operational SOL immediately before the irreversible
   step.
5. Founder explicitly clicks `claim 1 wtt` once. Do not issue a second
   challenge or change wallets while it is processing. If the request times
   out, use **resume claim**; never create or manually submit a replacement.
6. Watch structured logs for reservation, preparation, submission,
   confirmation, and Firestore finalization. Stop on an invariant, KMS, RPC, or
   low-balance event and follow the stored-attempt recovery path.

## Post-claim verification

Confirm all of the following independently:

- mainnet mint supply is exactly `1`;
- the canonical ATA of the verified recipient wallet has balance `1`, uses the
  Classic Token Program, has the correct mint/owner, and is `Frozen`;
- the recorded Solana transaction succeeded and contains the expected one
  atomic instruction sequence;
- `wttEntitlements/contribution:0` is `claimed`, amount `1`, has the verified
  wallet, confirmed transaction signature, claim ID, and `claimedAt`;
- `wttClaims/<challengeId>` is `confirmed` with the same signature and amount;
- the challenge is `consumed`;
- no second contribution entitlement exists for #000;
- a refresh shows claimed history and zero remaining for #000;
- calling `claimWtt` again with the same challenge returns the same confirmed
  result and does not change supply or create another transaction.

Retain the transaction signature, relevant structured-log correlation fields,
and redacted Firestore audit snapshot in the rehearsal record. Never retain auth
tokens, wallet-auth signatures, raw signed transactions outside the protected
claim record, or private key material.

## Initial alert policy

Before broader traffic, alert on operational SOL below the configured threshold,
repeated KMS signing failures, mint-invariant failures, repeated definitive
transaction failures, and repeated reconciliation conflicts. The official
public mainnet RPC is rate-limited and not intended for production-scale use;
move to a monitored dedicated mainnet provider before opening claims broadly.

## Dependency review record

The safe compatible update to `firebase-admin@14.5.0` and npm's non-forced
lockfile remediation reduced the production audit from 14 advisories to 9
(6 moderate, 3 high). Do not run `npm audit fix --force`: npm proposes old,
incompatible Solana package versions rather than patched current versions.

The residual findings are transitive to the maintained versions currently in
use: `@solana/web3.js@1.99.0` and `@solana/spl-token@0.4.15`.

- `bigint-buffer@1.1.5` has no patched release. SPL mint/account decoding and
  `mintToChecked` do reach its fixed-width integer layouts, but this service
  supplies fixed eight-byte SPL fields and a server-validated positive safe
  integer. The published issue is an availability/buffer-overflow condition;
  it does not expose a signing-key or transaction-substitution path here.
  Native bindings may compile in Cloud Build; when unavailable, the package
  uses its JavaScript fallback (as local tests did). Both paths remain covered
  by transaction construction and signature tests, but the advisory remains a
  launch risk to track upstream.
- `stream-json` is installed under `jayson`, but web3 imports jayson's browser
  JSON-RPC client, which parses bounded RPC responses with `JSON.parse`; the
  vulnerable server-side streaming filters are not loaded by the claim path.
- jayson's `uuid@8.3.2` is used as UUID v4 for outbound JSON-RPC request IDs.
  The advisory concerns v3/v5/v6 calls with caller-supplied output buffers, so
  that vulnerable operation is not reached here.
- optional native `bufferutil` and `utf-8-validate` accelerate WebSocket code;
  the claim path uses HTTP RPC and does not require them. `fast-crc32c` falls
  back to its JavaScript implementation when its optional SSE binding is
  unavailable; KMS integrity-check tests exercise that behavior.

Residual launch decision: acceptable for the single closely monitored founder
rehearsal because attacker-controlled oversized SPL buffers and jayson server
stream parsing are not exposed. Reassess and upgrade/replace before broad claim
traffic, and stop launch if the transaction-construction tests or upstream
reachability assumptions change.
