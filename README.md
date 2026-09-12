# Who Touched This

Who Touched This is a social coding experiment in which one public website is modified sequentially by contributors. Each accepted change will eventually become part of a permanent, public contribution history.

## Status

Milestone #17 adds the owner-only, one-time trusted bootstrap used to record a real, already-merged
Founder Contribution #000 without inventing a queue, invitation, participation, or turn. Nothing has
been deployed or written to production; the canonical repository is still private and public
contributions are not open.

The editable PR #000 canvas has intentionally not been designed yet. GitHub review/merge automation,
automatic screenshot capture/archive, final creative design, and production deployment remain deferred.

Production preparation and eventual release procedures are documented in
[`docs/PRODUCTION.md`](docs/PRODUCTION.md). Production remains a deliberate maintainer operation;
contributor CI has no deployment step or production credentials.

Pre-merge contributor review uses a privileged metadata-only boundary check followed by a trusted
default-branch `workflow_run` orchestrator. Only the proposed canvas is overlaid onto the exact base;
hostile Node/browser execution is secretless, networkless, containerized, and resource bounded.
Maintainer workflow, rule classifications, artifact review, repository settings, and limitations are in
[`docs/PR_REVIEW.md`](docs/PR_REVIEW.md).

## Technology

- Astro file-based routing and static generation with strict TypeScript
- React and TypeScript for most owner-maintained platform UI
- Vue, Svelte, and Solid support through official Astro integrations
- Firebase JavaScript SDK, Cloud Firestore rules, and the Firebase Emulator Suite
- Firebase Cloud Functions on Node.js 22 for trusted server-side email delivery
- Resend as the single planned production transactional-email provider
- Classic Firebase Hosting for the generated static site
- GitHub Actions with trusted metadata validation and default-branch-orchestrated sandbox review
- Plain CSS
- npm

Node.js 22.12 or newer is required. The repository includes an `.nvmrc` for Node version managers.

## Local development

```sh
npm install
npm --prefix functions install
npm run build
npm run dev
```

Useful checks and builds:

```sh
npm run check
npm run build
npm run preview
```

### Contributor-local preview

Future contributors do not need production Firebase configuration or any server secret. After
installing root dependencies, they can run:

```sh
npm run dev:contributor
```

This explicit contributor mode replaces the Firebase-backed status island with a clearly marked
local contributor-preview status. It previews the protected shell and `src/canvas/**` without a
`.env`, emulators, Functions, Firebase credentials, Storage access, Resend configuration, webhook
secret, or service account. `npm run dev:contributor` enables it only for the local development
server; `npm run build:contributor` enables the same deterministic fixture for maintainer snapshot
builds. Normal `npm run build` and production behavior remain Firebase-backed.

Normal `npm run check` and `npm run build` also require no private secrets. Operational pages are not
part of the contributor preview and may show unavailable configuration when opened without `.env`.

## Future public contribution model

The canonical repository remains private during platform construction. Before Founder Contribution
#000/community launch, the owner intends to make it public. Contributors will not receive collaborator
or write access: an invited contributor accepts a turn, forks the public repository, works in a branch
of that fork, and opens a pull request against `JeffSandov6/who-touched-this:main`.

Only `src/canvas/**` is contributor-editable. The protected validator checks complete diff metadata,
including both sides of renames and copies, sensitive filenames, Git object modes, and file/media
sizes. Objective violations fail; more than 12 changed files or 800 changed text lines produces an
advisory warning. The ordinary contributor command is:

```sh
npm run contribution:validate -- --base upstream/main
```

The full fork, upstream, installation, preview, validation, push, and pull-request procedure is in
`CONTRIBUTING.md`.

Small media can remain in `src/canvas/assets/**`. Individual changed/added Git files are limited to
25 MiB, and aggregate changed/added binary media is limited to 50 MiB. Larger media requires prior
maintainer coordination; the maintainer can use protected Firebase Storage management and give the
contributor the resulting public download URL. That URL can be used directly from `src/canvas/**`
without Firebase credentials or Firebase initialization. Contributors receive neither Storage write
access nor an internal Storage path as their integration artifact.

## Founder Contribution #000 bootstrap

Founder Contribution #000 is the first real creative contribution, not platform maintenance or an
application startup seed. Milestone #17 provides only the protected recording infrastructure. The
creative canvas remains empty until the owner deliberately creates, reviews, and merges a separate
creative PR.

The future maintainer sequence is:

1. Ensure this bootstrap infrastructure is already merged into canonical `main`.
2. Create a dedicated creative branch and modify only the intended canvas.
3. Open a normal PR against `JeffSandov6/who-touched-this:main` and review/test it.
4. Manually merge it. Record the exact canonical main SHA immediately before the merge, the exact SHA
   containing the merge, and GitHub's assigned PR number. GitHub PR #27 can legitimately become Who
   Touched This Contribution #000; these number systems are independent.
5. Sign into `/admin` as the active owner and open **Founder Contribution #000**.
6. Enter the intentional public alias, PR number, summary, optional public message, BEFORE SHA, and
   AFTER SHA. Confirm the permanent one-time operation.
7. Copy the generated `snapshots:capture` command, capture all historical editable routes, review the
   local viewer, and run `snapshots:verify`.
8. Open `/admin` → Snapshot Archive and archive the reviewed bundle.
9. Use the deliberate production release procedure only when ready. Recording #000 does not deploy.

The callable accepts no contribution number, GitHub username, PR URL, timestamps, counters, or
lifecycle state from the browser. It derives those fields, requires a stable-ID authenticated active
`owner`, and atomically creates `contributions/0`, `historyEvents/founder_seed_000`, and the inactive
public counter projection. It rejects a repeat, any earlier permanent contribution, a pending
invitation, an active-turn lock, or an active/submitted/under-review public projection.

The resulting public state is intentionally:

```text
currentVersion = 0
totalContributions = 1
turnStatus = none
```

There is no founder queue, participation, invitation, turn, countdown, or lifecycle email. The next
ordinary accepted community turn still targets `currentVersion + 1`, which is Contribution #001; its
successful merge produces `currentVersion = 1` and `totalContributions = 2`.

The server validates both Git SHAs as distinct full hexadecimal commit identities and stores them in
the immutable public founder contribution. It does not claim to prove ancestry. The subsequent exact-
revision snapshot command resolves the commits and proves BEFORE is an ancestor of AFTER:

```sh
npm run snapshots:capture -- \
  --contribution 0 \
  --before <RECORDED_BEFORE_SHA> \
  --after <RECORDED_AFTER_SHA>
```

Once `contributions/0` exists, the ordinary snapshot finalizer accepts the normal archive namespace
`public/history/contributions/000/{captureId}/`; no founder-only snapshot path or fake lifecycle is
needed.

### Emulator founder bootstrap walkthrough

Start the full emulators and Astro in separate terminals, then deliberately prepare the empty state:

```sh
npm run firebase:emulators
npm run dev

FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
GCLOUD_PROJECT=who-touched-this \
npm --prefix functions run emulator:prepare:founder
```

The helper refuses to run without the exact emulator host/project. In the Auth Emulator GitHub flow,
use stable provider ID `9001`, open `/admin`, and record synthetic values such as alias `Founder`, PR
number `27`, summary `Initial creative seed`, and two different 40-character hexadecimal SHAs. Inspect
`contributions/0`, `historyEvents/founder_seed_000`, and `site/public` in Emulator UI. Confirm no
founder document exists in queue, participation, invitations, turns, or email deliveries. History
must show **Founder Contribution #000**, while Admin becomes read-only and shows the copyable capture
command. A second callable attempt must be rejected.

To verify snapshot compatibility after recording:

```sh
npm run snapshots:fixture -- --contribution 0
npm run snapshots:verify -- \
  .wtt/snapshot-archive-fixture/contribution-000/emulator-founder-snapshot-fixture
```

Select that directory in Admin → Snapshot Archive. It uses the standard
`public/history/contributions/000/emulator-founder-snapshot-fixture/` namespace and finalizes
`contributionSnapshots/0` only because the permanent founder record now exists.

For the negative lock check, restart with fresh emulator data, join a synthetic contributor, and use
the existing Admin invitation flow to create a pending invitation (or accept it to create an active
turn). Leave that lock in place and submit the Founder #000 form. The callable must reject it without
changing the invitation, turn, queue, participation, or public projection. The trusted unit suite
exercises pending, active, submitted, and under-review blocking states.

## Complete-site contribution snapshots

One contribution snapshot represents the **entire canonical editable site** at a Git boundary, not
only the route a contributor intended to change. The protected, versioned registry at
`src/platform/config/editable-routes.json` currently defines:

```text
/
/random
/thoughts
```

Every capture produces BEFORE and AFTER images for all three routes—six PNGs—even when some images
are visually identical. A future protected platform change can add `/gallery` to this registry; the
same capture engine then produces four BEFORE plus four AFTER images without code changes. Ordinary
contributors cannot edit the registry or create routes under the current contribution policy.

The capture command reads the registry with `git show` from the supplied historical AFTER commit.
It never substitutes the route list from the maintainer's current checkout. This means a later
recapture retains the editable surface that existed at that contribution boundary. A missing or
invalid historical registry fails the operation clearly.

### Maintainer setup and capture

Install the one supported browser once after `npm ci`:

```sh
npx playwright install chromium
```

After an accepted contribution has been merged into canonical `main` and both commits are available
locally, run:

```sh
git fetch origin
npm run snapshots:capture -- \
  --contribution 42 \
  --before <SHA_BEFORE_MERGE> \
  --after <SHA_AFTER_MERGE>
```

Canonical routes need no command-line arguments. A repeated `--route /extra-public-route` is additive
for an unusual extra public page and can never suppress canonical routes. `--wait-ms 1500` may adjust
the bounded post-load settling interval from its 1500 ms default (maximum 10000 ms).

The tool validates that both revisions resolve to distinct commits and that BEFORE is an ancestor of
AFTER. It creates detached worktrees in an operating-system temporary directory, runs each revision's
own `npm ci` and `npm run build:contributor`, serves each static output only on loopback, and captures
it with Playwright Chromium. The main working tree, branches, and uncommitted changes are never built,
checked out, reset, or stashed. Servers, browser contexts, temporary directories, and registered
worktrees are cleaned on success and failure; SIGINT/SIGTERM abort child builds and then use the same
cleanup path.

Capture uses a 1440 × 900 viewport, device scale factor 1, UTC, `en-US`, full-page PNGs, explicit
navigation timeouts, document load readiness, font readiness, and a bounded settling delay. Required
routes must return a successful local response; a missing BEFORE route, 404, timeout, or render error
fails with its side, SHA, and route. Animation, randomness, external public media, or other dynamic
canvas behavior may yield a different frame on recapture; the full Git SHAs remain the canonical code
identity. Run this trusted maintainer tool only on reviewed canonical commits, never an unreviewed fork
head in privileged CI.

Bundles are collision-safe and ignored by Git:

```text
.wtt/snapshots/contribution-042/<capture-id>/
  manifest.json
  index.html
  before/home.png
  before/random.png
  before/thoughts.png
  after/home.png
  after/random.png
  after/thoughts.png
```

The versioned portable manifest records the contribution, capture ID/time, exact full SHAs, historical
registry source/revision, canonical/additional/final routes, collision-safe route keys, capture
settings, relative image paths, and every PNG's SHA-256 checksum. It contains no absolute home path,
Firebase credential, GitHub token, contributor email, or private identity. Open `index.html` directly
to review every route's BEFORE and AFTER images side by side, then verify integrity with:

```sh
npm run snapshots:verify -- .wtt/snapshots/contribution-042/<capture-id>
```

Capture remains observational and local. It creates no Firestore documents and does not change
versions, turns, queue state, History, or contributions. After visually reviewing `index.html` and
running `snapshots:verify`, an authenticated active owner/admin can open `/admin` → Snapshot Archive,
select that complete capture directory, review its SHA/route/checksum summary, and explicitly archive
it. The browser verifies every PNG checksum and uploads only `manifest.json` plus BEFORE/AFTER PNGs to:

```text
public/history/contributions/{zero-padded-number}/{captureId}/
```

A trusted `finalizeSnapshotArchive` callable then verifies admin identity, the permanent contribution,
uploaded manifest, exact object set, MIME/size/path/checksum metadata, and the one-archive policy before
creating immutable public `contributionSnapshots/{number}` metadata. The local `index.html` is not
uploaded. Interrupted uploads can retry the same capture: matching immutable objects are reused and
public History changes only after finalization. Unfinalized orphan objects are not shown and require a
future protected cleanup process.

Public History queries snapshot metadata once, attaches it only to permanent contribution events, and
initially shows a compact “Before & after · N pages” control. Expanding it uses the historical routes
stored in the archive—not today's registry—and only then resolves public Storage URLs. Screenshots are
lazy-loaded with explicit BEFORE/AFTER labels and alt text; failures do not hide the contribution.
Known archive objects and manifests are anonymously readable, but directories cannot be listed and no
browser client can overwrite or delete archive objects or metadata.

The browser computes SHA-256 over the selected local PNG bytes before upload. Finalization rereads the
uploaded manifest and verifies each immutable object's path, MIME type, size, and checksum metadata
against it without downloading every image. That metadata comparison is retry-safe integrity plumbing,
not independent cryptographic proof of the remote bytes; the trusted maintainer's reviewed browser
session is the byte-verification boundary. Finalized metadata is written only after the complete exact
object set exists. One finalized archive per contribution is canonical in V1; correction, replacement,
deletion, and orphan cleanup are deliberately deferred.

### Emulator snapshot archive walkthrough

Start the complete local suite and normal Astro development in separate terminals:

```sh
npm run firebase:emulators
npm run dev
```

With the Firestore Emulator running, seed only synthetic emulator data and generate a tiny verified
three-route bundle:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
GCLOUD_PROJECT=who-touched-this \
npm --prefix functions run emulator:seed:snapshots

npm run snapshots:fixture
npm run snapshots:verify -- \
  .wtt/snapshot-archive-fixture/contribution-001/emulator-snapshot-fixture
```

The seed command refuses to run without that exact emulator host/project. It creates active owner
`admins/9001`, synthetic permanent `contributions/1`, and its public History event only in Emulator
Firestore. In the Auth Emulator, sign into `/admin` with the mock GitHub identity whose stable provider
ID is `9001`. In **Snapshot Archive**, select:

```text
.wtt/snapshot-archive-fixture/contribution-001/emulator-snapshot-fixture/
```

Confirm the summary reports three canonical pages and six valid checksums, then archive. Storage
Emulator should contain seven immutable objects beneath:

```text
public/history/contributions/001/emulator-snapshot-fixture/
```

Firestore Emulator should contain `contributionSnapshots/1`. Open `/history`, expand “Before & after ·
3 pages,” and verify Home, `/random`, and `/thoughts` each show BEFORE and AFTER. Sign out or use an
incognito window to repeat the History check; known image URLs remain public. The authoritative
authorization checks are `npm run firebase:storage:rules:test` and `npm run firebase:rules:test`.

To inspect interrupted-upload behavior without production data, use browser DevTools offline mode or
cancel during a larger emulator-only bundle before finalization. No `contributionSnapshots` document
appears. Restore connectivity and select the same capture again: matching immutable objects are reused,
missing objects upload, and finalization occurs only after completeness checks. Tiny fixture files may
finish too quickly for manual cancellation; importer/finalizer tests cover the same retry contract.

## Firebase development

Firebase is the V1 platform backend. This repository is bound to the existing Firebase project
`who-touched-this`; do not create a replacement project.

Create local browser configuration from the committed template, then fill it with the existing
Firebase Web app values:

```sh
cp .env.example .env
```

The Web configuration uses Astro's `PUBLIC_` prefix intentionally because Firebase client app
identifiers—including `PUBLIC_FIREBASE_STORAGE_BUCKET`—are sent to browsers. Never commit `.env`
or unrelated secrets.

For emulator-backed development, set the following in the local `.env` and restart Astro:

```sh
PUBLIC_USE_FIREBASE_EMULATORS=true
```

With this flag enabled, browser Auth, Firestore, Storage, and Functions traffic is explicitly routed
to local emulators. Leave it false only when intentionally testing against the configured Firebase
project.

The repository pins the Firebase CLI as a development dependency. Useful commands are:

```sh
npm run firebase:emulators
npm run firebase:emulators:export
npm run firebase:emulators:import
npm run firebase:rules:test
npm run firebase:storage:rules:test
npm run functions:check
npm run functions:test
npm run test:admin-queue
npm run test:turn-state
npm run test:turn-lifecycle
npm run test:contribution-history
npm run test:invitation
npm run test:media
```

The local suite provides Authentication on port 9099, Firestore on 8080, Storage on 9199, Functions
on 5001, Pub/Sub for scheduled-function dispatch on 8085, Hosting on 5002, and the Emulator UI on
4000. Hosting uses 5002 because macOS commonly reserves port 5000.
Emulator exports live under ignored `.firebase/` data. The emulator script builds Functions first.

Classic Firebase Hosting serves Astro's generated `dist/` directory. Run `npm run build` before
using Hosting locally; Firebase's Hosting predeploy hook also builds before a future deployment.
No deployment is performed by these commands.

### GitHub Authentication

GitHub Authentication is configured in Firebase Console using the existing GitHub OAuth app. The
GitHub OAuth Client Secret belongs only in Firebase Console—never in `.env`, source code, logs, or
Firestore. The client requests Firebase's default identity access and does not request `repo`,
organization, or `user:email` scopes.

For real-provider local testing, the local hostname must be listed under Firebase Authentication's
authorized domains, and the GitHub OAuth app must retain Firebase's generated OAuth callback URL.
Emulator Auth uses a synthetic local provider flow and does not require the live GitHub OAuth app.

The canonical duplicate-prevention identity is the numeric GitHub provider ID in the Firebase Auth
token. GitHub username is presentation metadata only and is never used for authorization. The
username can be unavailable after a reload before signup; the Join page asks the user to
reauthenticate rather than guessing it.

### Join flow

`/join` is intentionally hydrated for authentication and form behavior. After GitHub authentication, the visitor supplies a
required public display name, private contact email, optional social link, and explicit rules
acknowledgement. Display names are trimmed and never inferred from GitHub, Firebase profile data, or
email. A bare but structurally valid social hostname/path is normalized to HTTPS before storage.
A Firestore transaction checks `participation/1_{githubUserId}` and atomically creates:

- `contributors/{githubUserId}`
- `participation/1_{githubUserId}`
- `queue/1_{githubUserId}`

Security Rules require all three new documents in the same atomic request. The browser cannot set
another season, participation state, contribution number, queue priority, promotion timestamp, or
sort order. Returning users read only their deterministic participation document; the queue and
numeric queue position remain private.

### Admin authorization and provisioning

`/admin` reuses Firebase GitHub Authentication and is also intentionally hydrated as a platform
route. Authorization requires the stable GitHub provider ID in the Firebase token to match an
active private `admins/{githubUserId}` document whose role is `owner` or `admin`. Username, email,
display name, UI state, and environment variables never grant admin access.

Admin records are trusted configuration. Browser clients may get only their own authorization
document and cannot create, update, delete, or list admin records.

For local emulator testing, first authenticate the intended owner with the mock GitHub provider and
find that stable provider ID in the Authentication Emulator UI or the matching contributor document
ID. In the Firestore Emulator UI at `http://localhost:4000`, manually create:

```text
admins/{githubUserId}
  githubUserId: "{the same GitHub provider ID}"  (string)
  role: "owner"                                 (string)
  active: true                                  (boolean)
```

An optional `createdAt` timestamp may also be added. Do not add secrets. Before production admin
use, perform the equivalent manual provisioning in the existing project’s Firestore console after
determining the owner’s stable authenticated GitHub provider ID. No owner ID belongs in source code,
and this repository does not provision or deploy the production record.

### Private queue management

After authorization succeeds, the admin interface reads Season 1 queue entries and only the
corresponding private contributor records. It displays internal effective position, contact email,
GitHub attribution, join time, status, priority, and optional social link. Search is local and can
match display name, GitHub username, or contact email. None of this private data is requested before
authorization or projected publicly.

V1 effective ordering is:

1. `priority` descending
2. `joinedAt` ascending within equal priority

Ordinary joins start at priority `0`, preserving FIFO order. **Move to top** transactionally assigns
the selected waiting entry one more than the current highest waiting priority and records
`promotedAt`. **Restore natural order** resets only that entry to priority `0`, removes
`promotedAt`, and lets its original `joinedAt` determine its natural position. Effective positions
are computed in the admin UI and are never stored. The reserved optional `sortOrder` field is not
used in the active ordering algorithm. Only waiting entries receive effective positions; invited,
active, completed, and failed entries are excluded.

### Invitations, turn activation, and public status

Only the effective first waiting contributor can be invited from `/admin`. The admin chooses a
private acceptance deadline (24 hours by default) and a bounded contribution duration (seven days by
default). The invite transaction creates a private `invitations/{invitationId}` record, changes the
participation and queue from `waiting` to `invited`, and sets `site/admin.pendingInvitationId`.
It does not create a turn, assign a target number, publish the contributor, or start a countdown.

The owner can still contact the contributor using the private email shown in Admin. A trusted
Firestore-triggered Function attempts the initial invitation email automatically, while lifecycle
triggers and the hourly dispatcher handle confirmations and eligible reminders. Delivery is
notification infrastructure and never controls invitation validity or lifecycle state. On `/join`,
only the invited GitHub identity can see and accept
its pending invitation. Acceptance atomically:

- creates a unique private `turns/{turnId}` document
- changes the invitation from `pending` to `accepted`
- changes participation and queue from `invited` to `active`
- clears the pending-invitation lock and sets the active-turn lock in `site/admin`
- projects public-safe current-turn data into `site/public`

`startedAt` is the acceptance time. `dueAt` is derived from that time plus the trusted duration on
the admin-created invitation, so the contribution clock begins only after explicit acceptance.
The contributor cannot choose either duration or deadline.

There can be only one pending invitation or one current turn. Passing `acceptBy` does not mutate
Firestore. After the deadline, an admin may explicitly expire the invitation, changing participation
and queue to `invitation_expired` and clearing the pending lock. No turn, public History event,
public contributor, or target contribution number is created. This private outcome is distinct from
expiration of an accepted active turn.

A turn's `targetContributionNumber` is `currentVersion + 1`, but it is only a proposed target. Turn
activation neither increments `currentVersion` nor creates `contributions/{number}`. An expired or
failed turn therefore does not consume a permanent contribution number; permanent numbering happens
only when an admin records a successful merge.

`site/admin` guarantees at most one pending invitation or active turn and is readable only by active admins. `site/public`
contains only current/total version counts, public contributor presentation data, turn status, target
number, deadline, and update timestamp. It never contains email, Firebase UID, stable provider ID,
queue position, priority, promotion metadata, or admin details.

The protected shell reads only `site/public`. If it is absent or malformed, the UI safely shows
Version #000 and no active turn. When active, a small hydrated status island derives time remaining
from the absolute `dueAt` timestamp once per second. It never writes countdown values or changes an
expired turn automatically.

For a deliberate initial document, create `site/public` manually with `currentVersion: 0`,
`totalContributions: 0`, `turnStatus: "none"`, null contributor/target/deadline fields, and an
`updatedAt` timestamp. This is optional in a clean emulator because acceptance can create the first
public state. `site/admin` may remain absent until the first invitation. Production initialization is
manual and is not performed by this repository.

### Transactional lifecycle email

Firestore lifecycle documents remain the source of truth. Second-generation Functions load the
matching private contributor through the Admin SDK, build plain-text and escaped HTML email, and
send through one narrow provider adapter. Delivery success or failure never advances, rolls back, or
otherwise mutates invitation, queue, participation, turn, contribution, History, or site state.

The notification set is intentionally transactional and small:

- invitation creation sends the initial invitation;
- accepting an invitation creates a turn and triggers one turn-started confirmation;
- an hourly dispatcher may send one invitation reminder at about six hours remaining;
- active turns may receive one about-72-hour and one about-24-hour reminder;
- an active overdue turn may receive one deadline-passed notice, which **does not expire the turn**;
- the first transition to merged sends one contribution-completed confirmation.

The 6-hour invitation reminder requires an original invitation window longer than six hours. The
72-hour turn reminder requires an original duration longer than 72 hours and is sent only while more
than 24 hours remain. The 24-hour reminder requires an original duration longer than 24 hours. The
hourly sweep makes these approximate thresholds, not exact appointment times. Submitted,
under-review, merged, expired, and skipped turns receive no active-turn reminders.

The intended production sender and reply-to address is:

```text
Who Touched This <hello@whotouchedthis.website>
```

Production uses Resend and the Firebase secret named `RESEND_API_KEY`. Set that secret only before a
future deployment:

```sh
npm exec -- firebase functions:secrets:set RESEND_API_KEY
```

`APP_ORIGIN` supplies the trusted application origin and defaults to
`https://whotouchedthis.website`. The production sending domain and address must be verified with
Resend and configured in DNS before deployment. No domain, secret, Function, or email is deployed by
this milestone.

For emulator development, copy the Functions-only non-secret example:

```sh
cp functions/.env.example functions/.env.local
npm run firebase:emulators
```

The Functions emulator forcibly selects the local mailbox unless `EMAIL_PROVIDER_MODE=failure` is
set. If the emulator asks for declared secrets, create ignored `functions/.secret.local` containing
synthetic `RESEND_API_KEY` and `GITHUB_WEBHOOK_SECRET` values; the local email adapter never reads the
Resend placeholder. Successful
local messages appear under their deterministic notification ID in `devEmailSink/**` in the Firestore
Emulator UI. That emulator-only document contains the generated recipient and body for inspection;
all browser access is denied. Set `EMAIL_PROVIDER_MODE=failure` in `functions/.env.local` to exercise
the failure path without an external outage. The Admin page shows the initial invitation delivery
state after a manual refresh, retains its contact-email fallback, and offers `Retry email` only for a
failed pending invitation. That callable accepts only an invitation ID and re-verifies the caller's
stable GitHub identity and active admin record server-side before rebuilding the recipient and email.

Scheduled behavior can be exercised without waiting by building Functions and running the private
dispatcher harness inside the Firestore emulator:

```sh
npm run functions:build
npm exec -- firebase emulators:exec --only firestore "npm --prefix functions run test:emulator:reminders"
```

The harness seeds emulator-only timestamps for the invitation, 72-hour, 24-hour, and overdue cases,
invokes the same dispatcher directly, and verifies deterministic local mailbox records. It exposes
no production HTTP testing endpoint.

Each logical notification uses deterministic `emailDeliveries/{deliveryId}` state plus the same
deterministic Resend idempotency key. A successfully sent record prevents later sends. Concurrent
attempts use a short private claim lease, failed provider attempts are recorded with a bounded safe
code, and later event/scheduler executions can claim failed work again. Resend additionally deduplicates
the provider request for its documented idempotency window. This is retry-safe duplicate reduction,
not a claim of theoretical exactly-once delivery: a crash after provider acceptance but before the
sent record, outside the provider's idempotency window, remains an unavoidable edge case.

Provider failure never changes authoritative lifecycle state. A failed initial invitation remains
pending and can still be accepted while the owner contacts the contributor manually. Final creative
email styling is deliberately deferred.

The production dispatcher uses one `onSchedule` job every 60 minutes and bounded status queries for
pending invitations and active turns; no per-contributor Scheduler jobs are created. Deploying Cloud
Functions and Cloud Scheduler requires production billing/API setup. This repository does not enable
billing, enable cloud APIs, deploy Functions, or create Scheduler jobs.

### GitHub App webhook

The public HTTPS Function `githubWebhook` consumes inbound GitHub App deliveries. It reads the exact
raw request bytes and verifies `X-Hub-Signature-256` with the server-only `GITHUB_WEBHOOK_SECRET`
before parsing JSON. Missing, malformed, or invalid signatures receive `401`. Signed malformed
requests receive `400`; valid irrelevant events and duplicate deliveries are safely acknowledged.
Responses never disclose current-turn or contributor data.

Server-controlled Functions configuration is:

```text
GITHUB_REPOSITORY=JeffSandov6/who-touched-this
GITHUB_BASE_BRANCH=main
```

Only `pull_request` actions `opened` and `ready_for_review` are candidates. The PR base repository
must be the configured canonical repository and its base ref must be the configured branch; the head
repository may be a contributor fork. An opened draft is ignored, so creating a draft cannot stop the
clock. A later `ready_for_review` event qualifies only when the PR is no longer draft.

The webhook matches `pull_request.user.id` to the private turn's stable numeric GitHub provider ID.
Username, display name, and email are never authorization inputs. A qualifying event uses a trusted
Firestore transaction to perform the same `active → submitted` state shape as the manual admin path:
it adds immutable PR metadata/timestamps to the turn and changes only `site/public.turnStatus` plus
its timestamp. Queue and participation stay active, the current-turn lock stays held, counters do not
change, and no contribution or History event is created. A late PR still qualifies while the owner
has left the turn active.

Small private `githubWebhookDeliveries/{deliveryId}` records use `X-GitHub-Delivery` as their
deterministic identity. They retain only event, action, repository, timestamps, status, and a bounded
result code—not headers, payload bodies, email, tokens, or secrets. Repeated delivery IDs no-op. Once
a turn is submitted, a distinct event for the same PR no-ops and a different PR is recorded as a
private conflict without replacing the first submission. Every browser role is denied access.

The existing manual GitHub PR form remains available while a turn is active, providing recovery when
the App is absent or delivery fails. `under_review` and merged contribution recording remain manual.
Closed/merged/review events are not processed in this milestone.

For local verification, put this synthetic value only in ignored `functions/.secret.local`:

```text
GITHUB_WEBHOOK_SECRET=local-github-webhook-secret
```

Then run the signed emulator harness; it constructs realistic raw payloads and posts them to the
actual Functions emulator endpoint without contacting GitHub:

```sh
npm run functions:build
npm exec -- firebase emulators:exec --only firestore,functions,pubsub \
  "npm --prefix functions run test:emulator:webhook"
```

The harness covers valid opened and ready-for-review PRs, drafts, wrong contributor/repository/branch,
invalid signatures, unsupported events, duplicate delivery, same/different follow-up PRs, no active
turn, pending-invitation-only state, late PRs, and terminal/non-active turns.

For future production setup, create a GitHub App with Metadata read-only and Pull requests read-only,
subscribe only to Pull request events, and install it only on the canonical repository. Set the
deployed `githubWebhook` Function URL shown by Firebase as its webhook URL and configure the same
random webhook secret in GitHub and Firebase Secret Manager:

```sh
npm exec -- firebase functions:secrets:set GITHUB_WEBHOOK_SECRET
```

No App ID or private key is needed until outbound GitHub API calls are introduced. No GitHub App,
secret, installation, Function, or webhook endpoint is deployed by this repository.

### Turn lifecycle and successful merge recording

The protected lifecycle is:

```text
waiting → invited → active → submitted → under_review → merged
          ↘ invitation_expired
                           ↘ expired
active / submitted / under_review → skipped
```

PR recording may happen automatically through a qualifying signed webhook or manually as an owner
fallback. The manual form supplies an HTTPS `github.com/{owner}/{repo}/pull/{number}` URL and a
matching positive PR number. Recording submission and starting review update
the private turn and `site/public` together while participation/queue remain active and the
`site/admin` lock remains held.

A deadline passing only changes the locally derived countdown to `Deadline passed`; it never mutates
Firestore. The owner may explicitly expire an active turn after its deadline or may accept a late PR
while it is still active. Submitted and under-review turns cannot expire, but the owner may explicitly
skip any current turn. Expiration and skipping atomically mark the turn, participation, and queue;
clear the current-turn lock; and reset the public projection without changing version counters.

Neither failure transition creates a contribution or consumes `targetContributionNumber`. The next
waiting contributor therefore targets the same `currentVersion + 1`.

The application does not merge a GitHub pull request or verify its GitHub state. After manually
merging an under-review PR on GitHub, an admin records the outcome with a required public summary
and optional public contributor message. The GitHub PR number is independent of the Who Touched
This contribution number: for example, Contribution #001 may refer to GitHub PR #27.

That single transaction changes the turn from `under_review` to terminal `merged`, completes its
participation and queue entries, creates `contributions/{number}` and a matching public History
event, clears the current-turn lock, advances `currentVersion` to the target, increments
`totalContributions` once, and clears current contributor data. This is the first operation that
permanently consumes a contribution number. The next turn targets the new version plus one.

### Public History

`/history` is a small hydrated public view because History changes independently of static Astro
builds. It queries public `historyEvents/**`, successful `contributions/{number}`, and one public
`contributionSnapshots/**` collection snapshot. Events are displayed newest-first.

Successful events prominently show Contribution number, contributor presentation identity,
summary, optional message, GitHub PR, and merge time. Explicit expiration and skipping also create
compact public events such as `Turn for #001 — Expired`; these explain the chronology without
mislabeling an unsuccessful turn as Contribution #001. Event documents never contain email,
Firebase UID, stable GitHub provider ID, queue metadata, admin identity, or private reasons.
Founder Contribution #000 uses the additive public `contributionKind: "founder_seed"` discriminator,
so History labels it distinctly without pretending it had a turn. Older/community records without a
kind remain valid and default to `community`. The founder record also preserves public-safe exact Git
provenance for later snapshot capture.

### Firestore boundaries

- `contributions/{contributionNumber}`, `historyEvents/{turnId}`, and `site/public` are
  public-readable projections. Anonymous writes are denied. The invited contributor may write
  `site/public` only inside the exact acceptance transaction; active admins may write it only inside
  validated lifecycle transactions.
- `contributors/**`, `participation/**`, `queue/**`, `invitations/**`, `emailDeliveries/**`,
  `githubWebhookDeliveries/**`, and `turns/**` are private operational data.
  A GitHub-authenticated user may get their own contributor and Season 1 participation documents
  and create the initial three-document join transaction. Active allowlisted admins may read the
  private operational collections. An invited GitHub identity may read only its own pending invitation
  and perform the exact coupled acceptance transaction. Admin browser writes are limited to queue
  promotion/restoration plus exact invitation, invitation-expiration, submission, review, accepted-turn
  expiration, skip, and merge-recording transitions. Queue creation/deletion,
  contributor mutation, arbitrary participation/queue transitions, terminal-turn mutation,
  arbitrary public History/contribution writes, and admin writes remain denied.
- Founder #000 creation is not exposed through Firestore Rules. The owner-only trusted callable uses
  Admin SDK access after verifying the stable numeric provider ID and atomic pre-seed invariants;
  every browser remains unable to edit or delete the resulting contribution and History record.
- `contributionSnapshots/{contributionNumber}` is public-readable, schema-versioned visual-history
  metadata. Every browser role, including admins, is denied create/update/delete; only the authorized
  finalization Function writes the first canonical archive.
- `admins/**` is private trusted authorization configuration. A GitHub-authenticated account may get
  only its own document; listing and all client writes are denied.
- `site/admin` is the private pending-invitation/current-turn singleton. Only active admins may read
  it; contributors receive only the narrowly validated write needed to accept their own invitation.
- `emailDeliveries/**` is server-owned. Active admins may get a known delivery-status document but
  cannot list or write the collection. `devEmailSink/**` is emulator-only and denies every browser
  read and write, including admin browser access.
- `githubWebhookDeliveries/**` is server-owned and denied to every browser role. It contains only
  bounded delivery diagnostics, never raw webhook payloads or headers.

Rules deny every unrecognized path. Composite indexes remain empty until implemented queries prove
which indexes are actually required.

### Public canvas media Storage

Media has two intended tiers. Small contribution assets may live in `src/canvas/assets/**` and be
versioned with the contribution. Large founder-managed images, audio, and video live in Firebase
Cloud Storage under:

```text
public/canvas/founder/{opaqueAssetId}/{safeFileName}
```

Known objects in that namespace are deliberately readable without authentication so a static public
canvas can display them. Namespace listing, creation, and deletion require Firebase Authentication
with a stable numeric GitHub provider identity and a matching active `owner` or `admin` document in
`admins/{githubUserId}`. Authenticated contributors receive no additional Storage permission.
Everything outside this exact namespace is denied. Objects are immutable: replacement means creating
a new uniquely addressed object and later deleting the old object deliberately.

The protected `/admin` Media section uploads directly from the browser with resumable progress,
lists existing founder objects, previews supported media, copies Storage paths/download URLs, and
deletes only after confirmation. Storage remains the object catalog; this milestone adds no Firestore
media metadata. The reusable `getPublicCanvasMediaUrl(storagePath)` helper resolves only validated
founder-media paths and is ready for a later Founder Contribution #000.

For maintainer-assisted community contributions, the contributor-facing artifact is the public
download URL produced by the Media manager—not the internal Storage path or the Firebase client
helper. A contributor can reference that URL directly from `src/canvas/**`, including in contributor
preview mode, without initializing Firebase or receiving Firebase credentials.

Founder media accepts `image/*`, `audio/*`, and `video/*` content types and enforces a finite 500 MiB
per-object ceiling in both browser validation and Storage Rules. HTML, JavaScript, executables, empty
objects, malformed paths, and overwrites are rejected. This generous founder limit is unrelated to
future ordinary-contributor Git limits.

For local work, set `PUBLIC_USE_FIREBASE_EMULATORS=true`, provide the public Web app Storage bucket
value in `PUBLIC_FIREBASE_STORAGE_BUCKET`, and run `npm run firebase:emulators`. Storage runs on port
9199 and appears in the Emulator UI. The Storage Rules suite starts Firestore too because Storage
authorization reads the existing private admin allowlist.

Before production Storage use, the owner must deliberately provision or enable the existing
`who-touched-this` project's default bucket if it is not available, review current Firebase billing
and download-cost requirements, deploy `storage.rules`, and verify the cross-service Storage Rules →
Firestore authorization lookup has the required Firebase/GCP permissions. The public-read/admin-write
behavior must be tested against production before founder media is uploaded. No bucket, IAM, billing,
rules, or media is deployed by local setup.

### Fork pull-request CI security

Fork checks use two deliberately separate trust contexts:

1. `Contribution boundary` uses `pull_request_target`, read-only `contents` and `pull-requests`
   permissions, a GitHub-hosted runner, and the validator from the trusted base SHA. It never checks
   out the PR head, installs its dependencies, executes contributor-controlled code, receives
   application secrets, or deploys. It retrieves only GitHub diff/tree metadata through the API.
   Consequently a PR cannot bypass the gate by changing `.github/**`, validator source, manifests,
   tests, or boundary configuration: those changes are themselves rejected, while the executing
   policy comes from the base repository.
2. After success, `Contributor review` is loaded from the trusted default branch through
   `workflow_run`. It retrieves a tiny artifact from the triggering boundary run, checks the exact PR,
   base, and head identity against GitHub, sparsely retrieves only the PR's canvas, and overlays it on
   the exact trusted base. Dependencies install from trusted manifests before that overlay. Any phase
   that can execute contributor TSX runs in a non-root, network-disabled, capability-dropped,
   CPU/memory/PID/time-bounded container without tokens, secrets, production configuration, a Docker
   socket, deployment steps, or a self-hosted runner. Trusted code sanitizes artifacts before upload
   and after download, then creates the base-versus-proposed visual review.

CI is independent of contributor lifecycle. A valid non-draft PR or draft marked Ready for review can
move an active turn to submitted through the existing signed webhook. Later pushes and CI outcomes do
not revert, expire, skip, extend, or restart the turn. The maintainer remains responsible for review
and manual merge.

`CODEOWNERS` assigns the repository to `@JeffSandov6`, but that file alone does not enforce review.
Before live contribution launch, configure GitHub manually to:

- Make the canonical repository public.
- Require pull requests for `main`.
- Require maintainer/code-owner review.
- Require the genuine base-owned `Contribution boundary` check. Treat the `workflow_run` Contributor
  review as mandatory evidence; it is not necessarily a PR-head status context. If available, use an
  organization ruleset/required-workflow identity for the review check rather than a spoofable
  lookalike status name.
- Block force pushes to `main` and prevent accidental protected-branch deletion where appropriate.
- Keep workflow tokens read-only/minimal; disable sending write tokens and secrets to fork pull
  requests in repository Actions settings.
- Retain first-time-contributor workflow approval unless deliberately changing that policy.
- Review repository-wide Actions permissions and allowed actions.
- Verify the GitHub App is installed only on the canonical repository with its intended permissions.

None of these repository settings or the repository visibility are changed by this milestone.

## Architecture

The application deliberately separates two ownership areas:

- `src/platform/**` contains protected navigation, page UI, layouts, status, configuration, services, and types. Most owner-maintained UI is static React/TSX; `PlatformLayout.astro` remains the thin Astro document shell.
- `src/canvas/**` is the future contributor-editable area. It has designated component directories for Astro, React, Vue, Svelte, and Solid.

Protected Astro routes in `src/pages/**` remain thin and compose the platform shell around React
page components. Astro owns routing and static generation; React Router is not used. Join and Admin
are hydrated for their interactive workflows, History is hydrated for runtime public data, and the
small SiteStatus island is hydrated for its public Firestore subscription and local countdown.
Unrelated page content remains static. The canonical `/`, `/random`, and `/thoughts` routes render
their canvas-owned page components inside the protected `PlatformLayout.astro`; their protected
route wrappers and editable-route registry remain owner-maintained.

```text
src/
  canvas/              Future contributor-editable pages and multi-framework components
  platform/            Protected React UI, Firebase modules, and infrastructure
  pages/               Thin protected Astro route wrappers
  styles/              Protected global/platform styles
public/                Static public assets
tests/                 Protected Firestore/Storage security-rule and platform tests
functions/             Protected Firebase Functions, email adapters, templates, and server tests
scripts/snapshots/     Protected exact-revision capture and integrity tooling
```

See `CONTRIBUTING.md` for the eventual contribution workflow and current restrictions.
