# Contributing to Who Touched This

> Public contributions are **not open yet**. Follow this guide only after the repository becomes
> public and Who Touched This has invited you to contribute.

Who Touched This accepts one small, coherent canvas contribution at a time. Contributors work in
their own forks. They never receive collaborator or direct write access to the canonical repository.

## 1. Accept your turn first

Do not open a contribution pull request merely because the repository is public. First:

1. Join Who Touched This through the website.
2. Wait for an invitation.
3. Sign in with the same GitHub account used to join.
4. Accept the invitation on `/join`.
5. Confirm that your turn is active.

Only one community contributor has an active turn. Accepting starts your contribution clock and
assigns your target contribution number.

## 2. Fork the repository

In GitHub, open <https://github.com/JeffSandov6/who-touched-this>. Choose **Fork** and create the fork
in your own GitHub account. Do not request collaborator access.

## 3. Clone your fork

Replace `YOUR_GITHUB_USERNAME` with your GitHub username:

```sh
git clone https://github.com/YOUR_GITHUB_USERNAME/who-touched-this.git
cd who-touched-this
```

The remote named `origin` now refers to your personal fork—not the canonical repository.

## 4. Add the canonical upstream remote

```sh
git remote add upstream https://github.com/JeffSandov6/who-touched-this.git
git remote -v
```

Verify that `origin` points to your fork and `upstream` points to
`JeffSandov6/who-touched-this`. If `upstream` already exists, inspect it rather than adding a duplicate.

## 5. Synchronize before beginning

```sh
git fetch upstream
git checkout main
git merge --ff-only upstream/main
git push origin main
```

`--ff-only` stops instead of creating an unexpected merge commit. If it cannot fast-forward, do not
use a destructive reset; inspect your fork or ask the maintainer for help.

## 6. Create a contribution branch

Do not work directly on `main`:

```sh
git checkout -b contribution/my-weird-change
```

Choose a short branch name describing your idea.

## 7. Install dependencies

Node.js 22.12 or newer is required; `.nvmrc` selects Node 22. If you use `nvm`:

```sh
nvm use
npm ci
```

If `nvm` is unavailable, install a supported Node.js 22 release using your normal Node version
manager or the official Node.js installer, verify with `node --version`, then run `npm ci`.
Contributors do not need to install the Functions package separately.

## 8. Run the safe contributor preview

```sh
npm run dev:contributor
```

The terminal prints the local address, normally <http://localhost:4321>. Open it in a browser. You
should see the protected site shell, a clearly marked local/contributor-preview status, and the
current canvas. Edits under `src/canvas/**` hot reload where supported.

This mode requires no `.env`, Firebase project configuration, production credentials, Storage write
access, Resend key, webhook secret, service account, Functions emulator, or private backend. It does
not connect shell status to production Firebase. Operational pages such as Join and Admin are outside
the contributor preview workflow and may show unavailable configuration if opened.

## 9. Edit only the canvas

The only contributor-editable path is:

```text
src/canvas/**
```

Examples include:

```text
src/canvas/pages/Home.tsx
src/canvas/components/react/**
src/canvas/components/vue/**
src/canvas/components/svelte/**
src/canvas/components/solid/**
src/canvas/components/astro/**
src/canvas/assets/**
```

Everything else is protected, including platform UI, routes, global styles, Functions, tests,
workflows, public files, Firebase rules/configuration, package manifests, validation scripts,
documentation, and environment examples. Although your fork technically lets you edit them, the
trusted contribution-boundary check rejects a pull request that adds, changes, deletes, renames, or
copies any protected path. Put canvas-specific styles and components inside `src/canvas/**`; do not
change `src/styles/**` or create routes under `src/pages/**`.

## 10. Handle media deliberately

Normal images, GIFs, audio, and small video may be committed under `src/canvas/assets/**`. A changed
or added Git file may be at most 25 MiB, and changed/added binary media may total at most 50 MiB.

If your idea needs larger media, contact the maintainer **before submitting the pull request**. Large
media is hosted separately to keep Git manageable. The maintainer may upload it through the protected
Media manager and give you the resulting public download URL. You may use that public URL directly
from `src/canvas/**`; it requires no Firebase credentials or Firebase initialization. Storage paths
remain an internal maintainer/admin detail. Contributors do not receive Firebase Storage upload
credentials. Do not commit enormous files or choose arbitrary third-party hosting without approval.

## 11. Validate and build

Run these from the repository root:

```sh
npm run contribution:validate -- --base upstream/main
npm run check
npm run build
```

The validator compares the complete working tree with canonical `upstream/main`, including added,
modified, deleted, renamed, copied, and untracked files. `PASS` means the objective structural rules
passed. `FAIL` identifies a hard violation and exits non-zero. `WARNING` reports advisory scope—more
than 12 files or more than 800 added plus deleted text lines—and still exits zero. A warning should
prompt simplification; the maintainer makes the final scope judgment.

The validator also rejects symbolic links, submodules/gitlinks, credential-like filenames, files
over 25 MiB, and aggregate changed binary media over 50 MiB. It is intentionally not a complete
secret scanner, so inspect your work manually too.

## 12. Inspect your own diff

```sh
git status
git diff upstream/main...HEAD
git diff upstream/main
```

The three-dot command shows committed branch changes; the final command also shows current tracked
working-tree changes. Confirm there are no unrelated or private files. Untracked files appear in
`git status` and are also inspected by the contribution validator.

## 13. Commit only canvas work

```sh
git add src/canvas
git status
git commit -m "Add [short contribution description]"
```

Review `git status` before committing. Avoid `git add .`, which can accidentally stage unrelated files.

## 14. Push your branch

```sh
git push -u origin contribution/my-weird-change
```

This pushes only to your fork.

## 15. Open the pull request

GitHub should offer **Compare & pull request**. Verify:

- Base repository: `JeffSandov6/who-touched-this`
- Base branch: `main`
- Head repository: your fork
- Compare branch: your `contribution/...` branch

Complete the contribution pull-request template. A draft pull request does **not** count as turn
submission, so your clock remains active. You may use a draft while working, but submit by either
opening a non-draft pull request or choosing **Ready for review**. 
Who Touched This automatically detects and associates the PR with you as long as it is opened from the same GitHub account you used to join.

## 16. Respond to CI

Fork pull requests run:

- A trusted protected-path and Git-object metadata check
- Contributor validation
- Astro/TypeScript checking
- Static production build
- Fast platform unit tests

CI receives no production secrets and performs no deployment. A CI failure does not expire, skip,
extend, or restart your turn, and it does not revert a submitted turn to active. Fix the issue locally,
commit it, and push to the same branch; GitHub updates the same pull request. Pushing fixes to that
branch does not create another contribution or restart your turn.
GitHub may require maintainer approval before workflows run for a first-time contributor. If so, no action is required from you unless the maintainer asks for changes.

## 17. Maintainer review

Passing automation does not guarantee acceptance. The maintainer reviews scope, safety, project
rules, and whether the result is one coherent contribution. Changes may be requested, and a
contribution may be rejected. The owner performs any merge manually.

## 18. After an accepted merge

After the PR is manually merged and recorded by the owner, the contribution becomes permanent,
public History records it, the site version advances, and your Season participation completes.
Deployment timing is separate and is not promised by this workflow.

## Protected infrastructure summary

The machine-readable boundary source is `src/platform/config/contribution-boundaries.ts`. Firebase
Auth, Firestore, Storage, Functions, emails, GitHub webhooks, admin/queue/turn code, validation tooling,
CI, documentation, and project configuration remain owner-maintained platform infrastructure.
Deadline and CI outcomes never mutate lifecycle automatically; explicit lifecycle operations remain
authoritative.
