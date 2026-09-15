# Production release guide

This is the maintainer runbook for the single intended production Firebase project,
`who-touched-this`, and canonical origin, `https://whotouchedthis.website`. Nothing in this guide is
part of the contributor workflow. A successful build is not a deployment, and a platform deployment
is not a contribution.

## Architecture and prerequisites

Production consists of Firebase Hosting static output, Firestore Rules and indexes, Storage Rules,
and Node.js 22 Firebase Functions. Milestone #17 adds the owner-only
`recordFounderContributionZero` callable and Founder #000 Admin/History presentation. Milestone #16
adds the `finalizeSnapshotArchive` callable, immutable `public/history/contributions/**` Storage
policy, public `contributionSnapshots/**` metadata, and History UI; all four deployed surfaces must be
released together before archive use. Before first deployment, the owner must confirm Firebase/GCP
billing and API requirements, provision the default Storage bucket, authenticate the
repository-pinned Firebase CLI, and have access to Firebase Auth, Secret Manager, Hosting, DNS,
Resend, and the GitHub OAuth/GitHub App settings. Do not run release tooling against unreviewed
contributor code.

## Local production configuration

Firebase Web SDK configuration identifies the public browser app; it is not a service-account secret.
Contributors still do not need it. Copy the placeholder template to the ignored owner file:

```sh
cp .env.production.example .env.production.local
```

Fill all values from the existing Firebase Web app:

```text
PUBLIC_FIREBASE_API_KEY
PUBLIC_FIREBASE_AUTH_DOMAIN
PUBLIC_FIREBASE_PROJECT_ID=who-touched-this
PUBLIC_FIREBASE_MESSAGING_SENDER_ID
PUBLIC_FIREBASE_APP_ID
PUBLIC_FIREBASE_STORAGE_BUCKET
PUBLIC_USE_FIREBASE_EMULATORS=false
PUBLIC_SITE_INDEXING_ENABLED=false
APP_ORIGIN=https://whotouchedthis.website
```

Never put a service-account credential, Resend key, webhook secret, or other server secret in a
`PUBLIC_*` variable. Keep pre-launch indexing `false` until the public announcement.

Functions already use Firebase v2 parameterized configuration. Copy the project-specific non-secret
template:

```sh
cp functions/.env.who-touched-this.example functions/.env.who-touched-this
```

Its production values are:

```text
EMAIL_PROVIDER_MODE=resend
APP_ORIGIN=https://whotouchedthis.website
GITHUB_REPOSITORY=JeffSandov6/who-touched-this
GITHUB_BASE_BRANCH=main
```

Both owner files are ignored. Do not commit them.

## Secrets

The source binds exactly two current Firebase Secret Manager names: `RESEND_API_KEY` and
`GITHUB_WEBHOOK_SECRET`. Configure their values interactively only when preparing production:

```sh
npm exec -- firebase functions:secrets:set RESEND_API_KEY --project who-touched-this
npm exec -- firebase functions:secrets:set GITHUB_WEBHOOK_SECRET --project who-touched-this
```

Do not paste values into source, dotenv examples, browser configuration, shell history, logs, smoke
output, or GitHub fork workflows. Preflight verifies source bindings, not remote secret values.

## Authentication

In Firebase Authentication and the production GitHub OAuth App, verify:

- GitHub sign-in is enabled.
- The OAuth client configuration is the intended production application.
- The Firebase-provided OAuth callback URL exactly matches the GitHub OAuth App callback.
- `whotouchedthis.website` is an authorized Firebase Auth domain where required.
- The Firebase `web.app`/`firebaseapp.com` test host is authorized if it will be tested.
- Emulator mode is disabled.
- Stable numeric GitHub provider ID remains the authorization identity; email and username are not.

Never document or commit the OAuth client secret.

## Email

- Create/use the intended Resend account and verify `whotouchedthis.website` and its DNS records.
- Configure `Who Touched This <hello@whotouchedthis.website>` as sender and the same address as reply-to,
  matching current server configuration.
- Put only the API key in Firebase Secret Manager under `RESEND_API_KEY`.
- Keep `EMAIL_PROVIDER_MODE=resend` and `APP_ORIGIN=https://whotouchedthis.website`.
- Verify the hourly dispatcher remains approximate: active turns longer than 72 hours use the
  `(24h, 72h]` reminder window, active turns longer than 24 hours use `(0h, 24h]`, and the
  deadline-passed notice begins at `dueAt`. A missed earlier window is not sent late. These notices
  have independent stable IDs and never expire or otherwise mutate the turn.
- Confirm `hello@whotouchedthis.website` receives the one-time admin notice when a controlled test PR
  first changes its active turn to submitted. The recipient is the server-controlled public project
  mailbox, not a configurable webhook field.
- Perform controlled email testing only after deployment; this milestone sends nothing.

Creative email redesign remains separate.

## Storage

Confirm the actual production bucket and put its Web SDK bucket name in
`PUBLIC_FIREBASE_STORAGE_BUCKET`. Deploy existing Storage Rules, then verify that
`public/canvas/founder/**` remains known-object public-read and active-admin list/create/delete with
immutable objects. Because Storage Rules consult Firestore `admins/{githubUserId}`, configure any
required cross-service Rules-to-Firestore IAM permission manually. After deployment, use a small
disposable admin media object to verify upload/public read/delete, then delete it. Do not upload
Founder Contribution #000 media during this milestone.

## GitHub App webhook

After Functions are deployed and the HTTPS `githubWebhook` URL exists:

- Create/configure the GitHub App if it does not exist and install it only on
  `JeffSandov6/who-touched-this`.
- Grant Metadata read-only and Pull requests read-only only.
- Subscribe to Pull request events.
- Set its webhook URL to the deployed `githubWebhook` Function.
- Configure the same random signing value in GitHub and Firebase Secret Manager as
  `GITHUB_WEBHOOK_SECRET`.
- Verify the expected repository and base branch remain `JeffSandov6/who-touched-this` and `main`.

No App ID/private key is currently required because the application makes no outbound GitHub API
calls. Do not broaden permissions.

## Custom domain and indexing

Use Firebase Hosting's custom-domain wizard for the canonical apex
`https://whotouchedthis.website`. Add only the verification and serving DNS records supplied by
Firebase; do not invent them. Wait for DNS propagation and Firebase TLS certificate provisioning,
then verify HTTPS. If `www.whotouchedthis.website` is configured, redirect it to the apex canonical
host.

With `PUBLIC_SITE_INDEXING_ENABLED=false`, every platform page contains
`<meta name="robots" content="noindex, nofollow">`, and generated `robots.txt` disallows crawling.
This is not access control: anyone with the URL can still visit. At public launch, deliberately set
the value to `true`, rerun preflight, inspect the build, deploy Hosting, and smoke-test with
`--expect-indexing enabled`. Never enable indexing automatically.

## Release preflight

From a clean `main` checkout on Node.js 22.12 or newer:

```sh
npm ci
npm --prefix functions ci
npm run release:preflight
```

Preflight fails for a dirty tree, non-`main` branch, wrong Firebase alias, malformed Firebase config,
wrong project/origin/repository/branch, emulator/contributor mode, missing/placeholder browser values,
non-Resend production mode, unsupported Node, or missing source secret bindings. It runs Astro checks,
the production build, Functions check/build, application/Functions/contribution/snapshot/release
tests, and scans `dist/` for emulator endpoints, localhost, demo project IDs, contributor-preview
markers, and server-secret names. It prints only project, origin, SHA, branch, indexing state, and
PASS status—never config values. It does not deploy.

Before an important backend/rules release, also run the full emulator suites:

```sh
npm run firebase:rules:test
npm run firebase:storage:rules:test
```

## Explicit deployment commands

All commands use the pinned local `firebase-tools` binary and explicitly target
`who-touched-this`:

```sh
npm run deploy:rules
npm run deploy:functions
npm run deploy:hosting
```

`deploy:rules` deploys Firestore Rules/indexes and Storage Rules. `deploy:functions` deploys the
existing contributor/admin email triggers, hourly scheduler, callable retry, snapshot finalizer,
owner-only founder recorder, and webhook endpoint. `deploy:hosting` first
runs the complete release preflight, which creates a fresh production—not contributor—`dist/`, then
deploys Hosting. Firebase Hosting's configured predeploy build runs production build again, so stale
output is not used. There is intentionally no all-in-one or automatic deployment command.

## First deployment order

1. Confirm project ownership, billing/APIs, local CLI authentication, and project `who-touched-this`.
2. Configure production Firebase Auth/GitHub OAuth and authorized domains.
3. Provision/confirm the Storage bucket and browser bucket value.
4. Create both ignored production configuration files.
5. Set the two Secret Manager values using the commands above.
6. Verify the Resend domain/sender and required DNS.
7. Configure required Storage Rules-to-Firestore IAM permission.
8. Run all checks, snapshot archive tests, Rules tests, and `npm run release:preflight` from clean `main`.
9. Run `npm run deploy:rules`.
10. Run `npm run deploy:functions`.
11. Configure/install the GitHub App webhook using the newly deployed endpoint.
12. Run `npm run deploy:hosting`.
13. Configure and verify the Hosting custom domain, apex redirect policy, DNS, TLS, and HTTPS.
14. Run the read-only smoke test below.
15. Carefully perform the separate manual stateful checks.
16. Keep indexing disabled until the actual public launch.

This milestone performs none of these production steps.

Before recording the real Founder Contribution #000, deploy the reviewed Function and Hosting UI from
the same canonical release and verify owner authorization in production. The owner must then create,
review, and manually merge the separate creative PR; retain GitHub's assigned PR number and exact
BEFORE/AFTER canonical SHAs; record #000 once in Admin; capture/review/verify/archive its snapshots;
and only then deliberately deploy the creative site when ready. Recording #000 is neither a GitHub
merge nor a Hosting deployment and sends no lifecycle email. Never test this one-time operation with
synthetic values in production.

Before production snapshot archival, verify the deployed release includes the History Storage Rules,
`contributionSnapshots/**` Firestore read/immutability Rules, `finalizeSnapshotArchive` Function, and
Hosting History/Admin UI from the same reviewed commit. Capture and verify exact-revision bundles
locally first; archival is a separate authenticated admin action. Do not upload a production archive
until its permanent contribution exists and the local comparison viewer has been reviewed.

Before accepting contributions, deploy the reviewed History release as one coordinated change:
Hosting for the timeline/avatar UI, Firestore Rules for the successful-contribution identity snapshot
and identity-free missed-turn projection, and Functions for Founder #000's equivalent trusted identity
snapshot. Confirm a legacy contribution without `githubUserId` renders its initials fallback. Confirm
an expired/skipped entry exposes only its public nickname and outcome. Successful contribution data
needs no migration; do not backfill numeric identity from mutable usernames. Before launch, inspect
any pre-existing failed-turn documents: Rules prevent new identity-bearing outcomes but cannot remove
legacy fields already stored in a public document. Any such cleanup is a deliberate owner data task
and was not performed by this change.

## Read-only smoke test

For pre-launch:

```sh
npm run release:smoke -- \
  --origin https://whotouchedthis.website \
  --expect-indexing disabled
```

The command issues only bounded GET requests to `/`, `/random`, `/thoughts`, `/history`, `/faq`,
`/rules`, and `/join`. Editable routes come from the canonical registry. It requires HTTPS and the
exact production origin, follows only same-origin redirects, checks success/HTML/platform title,
rejects localhost/emulator/demo markers, and verifies expected robots metadata. It creates no user,
write, upload, email, webhook, or lifecycle event.

Do these stateful checks manually and deliberately after a real deployment; they do not belong in the
read-only command: GitHub sign-in, admin authorization, controlled Join, queue/admin display, a
disposable Storage upload/read/delete, controlled invitation email, and a deliberate test PR/webhook.

## Subsequent releases

For Hosting-only canonical changes:

```sh
git checkout main
git pull --ff-only
npm ci
npm --prefix functions ci
npm run release:preflight
npm run deploy:hosting
```

When reviewed changes include rules or Functions, run their explicit deploy commands before Hosting.
Do not redeploy unchanged backend resources for every creative contribution.

## Rollback

For Hosting, use Firebase Hosting's release/version rollback controls; do not rewrite Git history.
For Functions or Rules, check out a known-good canonical commit, restore its matching owner
configuration, rerun validation, and redeploy the affected service explicitly. Backend/rules rollback
can conflict with newer stored data, so inspect schema compatibility before proceeding. There is no
automatic destructive rollback command.

## Launch checklist

Before public announcement: complete all production prerequisites, stateful tests, custom-domain and
HTTPS verification; make the repository public; configure branch protection/code-owner and required
CI checks; verify GitHub App installation; create Founder Contribution #000 through the deliberate
workflow; switch indexing to enabled and redeploy/smoke-test Hosting. Repository launch, PR #000,
automatic snapshot capture/archive and production deployment remain outside the current milestone.
