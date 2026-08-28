# Who Touched This

Who Touched This is a social coding experiment in which one public website is modified sequentially by contributors. Each accepted change will eventually become part of a permanent, public contribution history.

## Status

Milestone #1 establishes the static application scaffold and the boundary between protected platform infrastructure and future community-editable content. Public contributions are not open.

The editable PR #000 canvas has intentionally not been designed yet. Firebase and all backend, authentication, queue, admin, and persistence functionality are intentionally deferred.

## Technology

- Astro file-based routing and static generation with strict TypeScript
- React and TypeScript for most owner-maintained platform UI
- Vue, Svelte, and Solid support through official Astro integrations
- Plain CSS
- npm

Node.js 22.12 or newer is required. The repository includes an `.nvmrc` for Node version managers.

## Local development

```sh
npm install
npm run dev
```

Useful checks and builds:

```sh
npm run check
npm run build
npm run preview
```

## Architecture

The application deliberately separates two ownership areas:

- `src/platform/**` contains protected navigation, page UI, layouts, status, configuration, services, and types. Most owner-maintained UI is static React/TSX; `PlatformLayout.astro` remains the thin Astro document shell.
- `src/canvas/**` is the future contributor-editable area. It has designated component directories for Astro, React, Vue, Svelte, and Solid.

Protected Astro routes in `src/pages/**` remain thin and compose the platform shell around React page components. Astro owns routing and static generation; React Router and client hydration are not used. The homepage is the key example: `src/pages/index.astro` renders the canvas-owned `Home.tsx` inside the protected `PlatformLayout.astro`.

```text
src/
  canvas/              Future contributor-editable pages and multi-framework components
  platform/            Protected React UI and application infrastructure
  pages/               Thin protected Astro route wrappers
  styles/              Protected global/platform styles
public/                Static public assets
```

See `CONTRIBUTING.md` for the eventual contribution workflow and current restrictions.
