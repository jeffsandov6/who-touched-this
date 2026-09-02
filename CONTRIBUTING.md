# Contributing to Who Touched This

> Public contributions are **not open yet**. Please do not open contribution pull requests at this stage.

Who Touched This will eventually accept one community contribution at a time through a managed turn system. Detailed contribution limits will be finalized before launch.

A turn deadline passing does not itself create, accept, or remove a contribution. An explicit
protected lifecycle operation is required. A contribution becomes permanent only after its PR is
manually merged on GitHub and an administrator atomically records that successful outcome.

## Eventual workflow

1. A contributor gets a turn.
2. The contributor forks the repository.
3. The contributor creates a branch in their fork.
4. The contributor changes only allowed canvas code.
5. The contributor opens a pull request.
6. A maintainer reviews the change.
7. An accepted pull request is merged.
8. The contribution becomes part of the permanent public history.

## Code boundaries

- `src/canvas/**` is the future contributor-editable area.
- `src/platform/**`, protected route wrappers in `src/pages/**`, project configuration, build and deployment configuration, Firebase configuration, and GitHub workflows are protected.

Ownership follows directory boundaries, not file extensions. React/TSX under `src/platform/**` remains protected, while future canvas contributors may use any configured framework within `src/canvas/**`.

Firebase project configuration, authentication, join, admin, queue, turn, public-status code,
Firestore rules and indexes, emulator configuration, protected Firebase source modules, and
security-rule tests are platform infrastructure and may not be changed by community contributions.

The machine-readable source of these boundaries is `src/platform/config/contribution-boundaries.ts`. Enforcement tooling will be added in a later milestone. Until public contributions formally open, this repository is project scaffolding only.
