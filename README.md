# who touched this

one website, one contributor at a time.

take your turn, make a change, & become part of its history.

who touched this is a social coding experiment where one public website is passed from contributor to contributor.
each person gets one turn to make a small change, and every accepted contribution becomes part of the site's permanent history.

> **Pre-launch:** the repository & contribution queue are not public yet. This note can be removed
> when public contributions open.

## how it works

1. Join the queue.
2. Wait for your turn.
3. Accept your invitation.
4. Fork the repository.
5. Make one small change to the editable canvas.
6. Open a pull request.
7. If accepted, your change goes live, becomes part of the site's permanent history, & the website passes to the next contributor.

## want to contribute?

Start at [whotouchedthis.website/join](https://whotouchedthis.website/join). Do not begin coding until
your turn is active.

When your turn starts:

1. Fork the repository & clone your fork.
2. Run `npm run contributor:setup`.
3. Run `npm run dev:contributor`.
4. Edit only `src/canvas/**`.
5. Run the contributor checks.
6. Open a non-draft pull request from your fork into canonical `main`.

Read the full [contributor guide](CONTRIBUTING.md) before opening your pull request. It is the
authoritative setup, validation, scope, & review workflow.

## what can contributors edit?

Editable:

```text
src/canvas/**
```

Protected areas include `src/platform/**`, `src/pages/**`, `src/styles/**`, platform configuration,
lifecycle & security infrastructure, & every other path identified by the contribution boundary.
The detailed & authoritative policy lives in [CONTRIBUTING.md](CONTRIBUTING.md).

## editable pages

The current canvas has three public pages:

- `/`
- `/random`
- `/thoughts`

Their rendered content is canvas-owned. Routing, the protected shell, & route configuration remain
protected platform infrastructure.

## technology

- Astro
- React & TypeScript
- Firebase
- GitHub Actions
- plain CSS
- npm

Node.js 22.12 or newer is required.

## maintainer documentation

- [Platform architecture & maintainer operations](docs/PLATFORM.md)
- [Production release guide](docs/PRODUCTION.md)
- [Pre-merge contributor review & security](docs/PR_REVIEW.md)
