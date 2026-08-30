# Who Touched This

Who Touched This is a social coding experiment in which one public website is modified sequentially by contributors. Each accepted change will eventually become part of a permanent, public contribution history.

## Status

Milestone #5 adds atomic turn activation, a public-safe current-contributor projection, and a live
browser countdown. Public contributions beyond the controlled signup flow are not open.

The editable PR #000 canvas has intentionally not been designed yet. Turn completion, GitHub
repository automation, notifications, and production deployment remain deferred.

## Technology

- Astro file-based routing and static generation with strict TypeScript
- React and TypeScript for most owner-maintained platform UI
- Vue, Svelte, and Solid support through official Astro integrations
- Firebase JavaScript SDK, Cloud Firestore rules, and the Firebase Emulator Suite
- Classic Firebase Hosting for the generated static site
- Plain CSS
- npm

Node.js 22.12 or newer is required. The repository includes an `.nvmrc` for Node version managers.

## Local development

```sh
npm install
npm run build
npm run dev
```

Useful checks and builds:

```sh
npm run check
npm run build
npm run preview
```

## Firebase development

Firebase is the V1 platform backend. This repository is bound to the existing Firebase project
`who-touched-this`; do not create a replacement project.

Create local browser configuration from the committed template, then fill it with the existing
Firebase Web app values:

```sh
cp .env.example .env
```

The Web configuration uses Astro's `PUBLIC_` prefix intentionally because Firebase client app
identifiers are sent to browsers. Never commit `.env` or unrelated secrets.

For emulator-backed development, set the following in the local `.env` and restart Astro:

```sh
PUBLIC_USE_FIREBASE_EMULATORS=true
```

With this flag enabled, browser Auth and Firestore traffic is explicitly routed to the local
emulators. Leave it false only when intentionally testing against the configured Firebase project.

The repository pins the Firebase CLI as a development dependency. Useful commands are:

```sh
npm run firebase:emulators
npm run firebase:emulators:export
npm run firebase:emulators:import
npm run firebase:rules:test
npm run test:admin-queue
npm run test:turn-state
```

The local suite provides Authentication on port 9099, Firestore on 8080, Hosting on 5002, and the
Emulator UI on 4000. Hosting uses 5002 because macOS commonly reserves port 5000. Emulator exports
live under ignored `.firebase/` data.

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

`/join` is the only hydrated platform page. After GitHub authentication, the visitor supplies a
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

`/admin` reuses Firebase GitHub Authentication and is the second intentionally hydrated platform
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
used in the active ordering algorithm. Active entries are excluded from effective waiting positions.

### Turn activation and public status

Only the effective first waiting contributor can be started from `/admin`. The admin chooses an
editable absolute deadline. A Firestore transaction verifies the admin, contributor, participation,
queue, deadline, and absence of another active turn before atomically:

- creating a unique private `turns/{turnId}` document
- changing that contributor's participation and queue status from `waiting` to `active`
- setting the private authoritative active-turn lock in `site/admin`
- projecting public-safe current-turn data into `site/public`

A turn's `targetContributionNumber` is `currentVersion + 1`, but it is only a proposed target. Turn
activation neither increments `currentVersion` nor creates `contributions/{number}`. An expired or
failed turn therefore does not consume a permanent contribution number; permanent numbering happens
only after an accepted merge in a later milestone.

`site/admin` guarantees at most one active turn and is readable only by active admins. `site/public`
contains only current/total version counts, public contributor presentation data, turn status, target
number, deadline, and update timestamp. It never contains email, Firebase UID, stable provider ID,
queue position, priority, promotion metadata, or admin details.

The protected shell reads only `site/public`. If it is absent or malformed, the UI safely shows
Version #000 and no active turn. When active, a small hydrated status island derives time remaining
from the absolute `dueAt` timestamp once per second. It never writes countdown values or changes an
expired turn automatically.

For a deliberate initial document, create `site/public` manually with `currentVersion: 0`,
`totalContributions: 0`, `turnStatus: "none"`, null contributor/target/deadline fields, and an
`updatedAt` timestamp. This is optional in a clean emulator because the activation transaction can
create the first public state. Leave `site/admin` absent until activation. Production initialization
is also manual and is not performed by this repository.

Expiration/cancellation is intentionally not implemented. To reset an emulator-only active turn,
stop application writes and use the Emulator UI to delete the active `turns/{turnId}` and
`site/admin` documents, return the selected `participation/1_{githubUserId}` and
`queue/1_{githubUserId}` statuses to `waiting`, and either delete `site/public` or restore the
inactive initial shape above. Do not use this manual reset procedure against production data.

### Firestore boundaries

- `contributions/{contributionNumber}` and `site/public` are public-readable projections. Public and
  ordinary authenticated writes are denied; an active admin may write `site/public` only inside a
  rules-validated complete activation transaction.
- `contributors/**`, `participation/**`, `queue/**`, and `turns/**` are private operational data.
  A GitHub-authenticated user may get their own contributor and Season 1 participation documents
  and create the initial three-document join transaction. Active allowlisted admins may read the
  private operational collections. Admin browser writes are limited to queue promotion/restoration
  and the exact five-document turn-activation transaction. Queue creation/deletion, contributor
  mutation, arbitrary participation/queue transitions, turn mutation/deletion, history writes, and
  admin writes remain denied.
- `admins/**` is private trusted authorization configuration. A GitHub-authenticated account may get
  only its own document; listing and all client writes are denied.
- `site/admin` is the private active-turn singleton. Only active admins may read it, and it can be
  written only as part of a complete activation.

Rules deny every unrecognized path. Composite indexes remain empty until implemented queries prove
which indexes are actually required.

## Architecture

The application deliberately separates two ownership areas:

- `src/platform/**` contains protected navigation, page UI, layouts, status, configuration, services, and types. Most owner-maintained UI is static React/TSX; `PlatformLayout.astro` remains the thin Astro document shell.
- `src/canvas/**` is the future contributor-editable area. It has designated component directories for Astro, React, Vue, Svelte, and Solid.

Protected Astro routes in `src/pages/**` remain thin and compose the platform shell around React
page components. Astro owns routing and static generation; React Router is not used. Join and Admin
are hydrated for their interactive workflows, and the small SiteStatus island is hydrated for its
public Firestore subscription and local countdown. Unrelated page content remains static. The
homepage renders the canvas-owned `Home.tsx` inside the protected `PlatformLayout.astro`.

```text
src/
  canvas/              Future contributor-editable pages and multi-framework components
  platform/            Protected React UI, Firebase modules, and infrastructure
  pages/               Thin protected Astro route wrappers
  styles/              Protected global/platform styles
public/                Static public assets
tests/                 Protected Firebase security-rule tests
```

See `CONTRIBUTING.md` for the eventual contribution workflow and current restrictions.
