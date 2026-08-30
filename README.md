# Who Touched This

Who Touched This is a social coding experiment in which one public website is modified sequentially by contributors. Each accepted change will eventually become part of a permanent, public contribution history.

## Status

Milestone #3 adds Firebase GitHub Authentication and the self-service Season 1 join flow. Public contributions beyond this controlled signup flow are not open.

The editable PR #000 canvas has intentionally not been designed yet. Admin functionality, queue management, turns, GitHub repository automation, and production deployment remain deferred.

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

### Firestore boundaries

- `contributions/{contributionNumber}` and `site/public` are public-readable projections. Client
  writes are denied.
- `contributors/**`, `participation/**`, `queue/**`, and `turns/**` are private operational data.
  A GitHub-authenticated user may get their own contributor and Season 1 participation documents
  and create the initial three-document join transaction. Queue reads and all operational updates,
  deletes, and list queries remain denied.

Rules deny every unrecognized path. Composite indexes remain empty until implemented queries prove
which indexes are actually required.

## Architecture

The application deliberately separates two ownership areas:

- `src/platform/**` contains protected navigation, page UI, layouts, status, configuration, services, and types. Most owner-maintained UI is static React/TSX; `PlatformLayout.astro` remains the thin Astro document shell.
- `src/canvas/**` is the future contributor-editable area. It has designated component directories for Astro, React, Vue, Svelte, and Solid.

Protected Astro routes in `src/pages/**` remain thin and compose the platform shell around React page components. Astro owns routing and static generation; React Router is not used. The interactive Join page is hydrated deliberately, while unrelated protected pages remain static. The homepage renders the canvas-owned `Home.tsx` inside the protected `PlatformLayout.astro`.

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
