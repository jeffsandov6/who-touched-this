# Who Touched This

Who Touched This is a social coding experiment in which one public website is modified sequentially by contributors. Each accepted change will eventually become part of a permanent, public contribution history.

## Status

Milestone #2 establishes the Firebase foundation, local emulators, Firestore data contracts, security rules, and classic Firebase Hosting configuration. Public contributions are not open.

The editable PR #000 canvas has intentionally not been designed yet. GitHub authentication, contributor signup, queue operations, admin functionality, and production data are intentionally deferred.

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

### Firestore boundaries

- `contributions/{contributionNumber}` and `site/public` are public-readable projections. Client
  writes are denied.
- `contributors/**`, `participation/**`, `queue/**`, and `turns/**` are private operational data.
  Client reads and writes are denied.

Rules deny every unrecognized path. Composite indexes remain empty until implemented queries prove
which indexes are actually required. GitHub authentication and its authorization rules are deferred
to a later milestone.

## Architecture

The application deliberately separates two ownership areas:

- `src/platform/**` contains protected navigation, page UI, layouts, status, configuration, services, and types. Most owner-maintained UI is static React/TSX; `PlatformLayout.astro` remains the thin Astro document shell.
- `src/canvas/**` is the future contributor-editable area. It has designated component directories for Astro, React, Vue, Svelte, and Solid.

Protected Astro routes in `src/pages/**` remain thin and compose the platform shell around React page components. Astro owns routing and static generation; React Router and client hydration are not used. The homepage is the key example: `src/pages/index.astro` renders the canvas-owned `Home.tsx` inside the protected `PlatformLayout.astro`.

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
