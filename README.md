# Who Touched This

Who Touched This is a social coding experiment in which one public website is modified sequentially by contributors. Each accepted change will eventually become part of a permanent, public contribution history.

## Status

Milestone #1 establishes the static application scaffold and the boundary between protected platform infrastructure and future community-editable content. Public contributions are not open.

The editable PR #000 canvas has intentionally not been designed yet. Firebase and all backend, authentication, queue, admin, and persistence functionality are intentionally deferred.

## Technology

- Astro with strict TypeScript
- React, Vue, Svelte, and Solid through official Astro integrations
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

- `src/platform/**` contains protected navigation, layouts, status, configuration, services, and types. Future contributors must not modify this infrastructure.
- `src/canvas/**` is the future contributor-editable area. It has designated component directories for Astro, React, Vue, Svelte, and Solid.

Protected routes in `src/pages/**` compose the platform shell around page content. The homepage is the key example: `src/pages/index.astro` renders the canvas-owned `Home.astro` inside the protected `PlatformLayout.astro`.

```text
src/
  canvas/              Future contributor-editable pages and components
  platform/            Protected application infrastructure
  pages/               Protected Astro route wrappers
  styles/              Protected global/platform styles
public/                Static public assets
```

See `CONTRIBUTING.md` for the eventual contribution workflow and current restrictions.
