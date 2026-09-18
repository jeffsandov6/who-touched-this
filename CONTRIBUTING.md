# contribute to Who Touched This

> **Pre-launch:** the repository is still private. When contributions open, use this guide only after
> `/join` confirms that your turn is active.

This is the canonical manual for an active contribution turn. Who Touched This is one website changed
by one community contributor at a time. You work in your own fork, submit one small coherent idea, &
never need write access to the canonical repository.

## start here

Before touching Git, join through the website, wait for an invitation, sign in with the same GitHub
account, accept on `/join`, & confirm your turn is active. Each GitHub account gets one ordinary
contribution per season.

Then follow this path:

1. Fork <https://github.com/jeffsandov6/who-touched-this> into your GitHub account.
2. Clone **your fork**, not jeffsandov6's repository.
3. Run the safe setup helper. It verifies your fork, adds the canonical `upstream`, checks Node.js/npm,
   & installs dependencies.
4. Sync your fork's `main` with canonical `main`.
5. Create a contribution branch. Do not work directly on `main`.
6. Start the zero-secret contributor preview.
7. Edit only `src/canvas/**`.
8. Validate, test, check, & build your work.
9. Commit only the canvas files & push the branch to your fork.
10. Open a **non-draft** PR from your fork branch into `jeffsandov6/who-touched-this:main`.
11. Push requested revisions to that same branch & PR.
12. Wait for automated checks & maintainer review. Passing checks do not guarantee acceptance.

The exact commands are below.

## 1. fork, clone & set up

On GitHub, choose **Fork**. Replace `YOUR_GITHUB_USERNAME` in this command:

```sh
git clone https://github.com/YOUR_GITHUB_USERNAME/who-touched-this.git
cd who-touched-this
npm run contributor:setup
```

Already use GitHub CLI? You can optionally fork & clone in one step:

```sh
gh repo fork jeffsandov6/who-touched-this --clone
```

GitHub CLI is not required. The default flow remains **Fork** in GitHub, clone your fork, then run
`npm run contributor:setup`.

The setup command is safe to rerun. It:

- refuses an `origin` that points to `jeffsandov6/who-touched-this` instead of your fork
- adds `upstream` when it is missing, using HTTPS or SSH to match your `origin`
- verifies an existing `upstream` instead of silently replacing an unexpected remote
- checks the requirements in `package.json` & `.nvmrc`
- runs `npm ci` from the committed lockfile
- creates no environment file & asks for no production credentials

It never authenticates to GitHub, pushes, commits, switches branches, resets work, opens a PR, or
contacts Firebase. Use `npm run contributor:setup -- --skip-install` to rerun only its verification &
remote setup.

Node.js 22.12 or newer & npm 9.6.5 or newer are required. `.nvmrc` selects Node.js 22 when you use
`nvm`. If setup reports a version problem, run `nvm use` or install a supported Node.js release, then
rerun setup.

Confirm the remotes:

```sh
git remote -v
```

You should see:

```text
origin    YOUR_GITHUB_USERNAME/who-touched-this
upstream  jeffsandov6/who-touched-this
```

If the helper finds an unexpected existing remote, it stops without replacing it. Inspect the output
or ask the maintainer before changing anything.

## 2. sync main & create your branch

Start from the current canonical site:

```sh
git fetch upstream
git checkout main
git merge --ff-only upstream/main
git push origin main
git checkout -b contribution/SHORT-DESCRIPTION
```

For example: `contribution/animated-garden`. `--ff-only` stops rather than creating an unexpected
merge commit. If it cannot fast-forward, do not reset or force-push. Ask the maintainer for help.

## 3. run the safe local site

```sh
npm run dev:contributor
```

Open the local address printed by Astro, normally <http://localhost:4321>. You should see the protected
shell, a clearly marked contributor-preview status, & the current canvas.

Contributor preview requires no production credentials, secrets, or private configuration. Do not
copy production configuration into your fork. Join, Admin, & other operational pages are not part of
contributor preview.

## 4. make one coherent contribution

The contributor-editable area is exactly:

```text
src/canvas/**
```

Your contribution should revolve around one coherent main idea. It may touch multiple canvas files
when the idea requires it, but it should not become a full-site overhaul or bundle several unrelated
ideas into one turn. If the scope is too large, the maintainer may ask you to narrow it down.

Everything outside `src/canvas/**` is protected. This includes the routing shell, platform UI,
authentication, global styles, Firebase configuration, Functions, workflows, tests, package files,
validation tooling, contributor rules, docs, & public route definitions. The authoritative policy is
versioned in `src/platform/config/contribution-boundaries.ts`; the trusted boundary validates the full
Git diff, including renames, copies, deletions, file modes, & sizes.

Work introduced by another contributor generally may not be intentionally removed, hidden, or
substantially replaced until 5 later community contributions have merged. Safety, security,
compatibility, & platform fixes are exceptions. You can build around earlier work without erasing it.
The maintainer has final moderation authority.

## 5. media

Images, GIFs, audio, & reasonably sized video can live under `src/canvas/assets/**`.

If your idea needs unusually large media, contact the maintainer before submitting. The maintainer
can host the asset for you & give you a public URL to use from `src/canvas/**`.

Do not commit huge files or choose an external host for unusually large assets without checking first.

## 6. validate & test

Stop the development server when you are ready, then run:

```sh
npm run contribution:validate -- --base upstream/main
npm run test:contributor
npm run check
npm run build:contributor
```

- `contribution:validate` checks the complete diff & untracked files against the allowed boundary.
- `test:contributor` runs the fast application tests used for contributor confidence.
- `check` runs Astro/TypeScript diagnostics.
- `build:contributor` proves the static site builds with the same safe local fixture.

`PASS` means the structural rules passed. `FAIL` names a hard violation. A scope `WARNING` does not
fail automatically; simplify when practical & expect the maintainer to make the final scope judgment.

Inspect your work too:

```sh
git status
git diff upstream/main...HEAD
git diff upstream/main
```

The three-dot diff shows committed branch changes. The final command also shows tracked working-tree
changes. Confirm that no private or unrelated files are present.

## 7. commit & push to your fork

```sh
git add src/canvas
git status
git commit -m "Add SHORT DESCRIPTION"
git push -u origin contribution/SHORT-DESCRIPTION
```

Review `git status` before committing. Avoid `git add .`, which can stage unrelated files. The push
goes to your fork because the destination is `origin`.

## 8. open the PR in the correct direction

On GitHub, choose **Compare & pull request**. Confirm this exact direction:

```text
FROM:
YOUR_GITHUB_USERNAME/who-touched-this : contribution/SHORT-DESCRIPTION

INTO:
jeffsandov6/who-touched-this : main
```

In GitHub terminology, **head/compare** is your fork branch; **base** is the canonical `main` branch.
Do not reverse them.

Complete the PR template. **What did you change?** should be a concise, plain-language description;
if accepted, the maintainer uses it as the public History summary. The optional **Message/signature**
may also appear publicly. Successful History entries may show the public GitHub identity, avatar, &
social information already associated with participation. Missed or skipped turns do not publish that
GitHub/social identity.

A draft does not submit your turn. Open a non-draft PR, or choose **Ready for review**, only when you
are submitting. The first valid non-draft PR counts as your turn's submission. The system associates
it with you when it comes from the same GitHub account used to join Who Touched This.

## 9. checks & review

After submission:

- the trusted boundary verifies that only allowed canvas work changed
- isolated security/build checks examine & build the contribution
- an automated BEFORE versus PROPOSED AFTER visual review is generated for every editable route
- the maintainer reviews the source, scope, automated results, & visual result

Passing automation does not guarantee acceptance. If changes are requested, edit locally, commit, &
push to the **same branch**. GitHub updates the same PR; this does not create another contribution or
restart your turn. GitHub may require maintainer approval before a first-time contributor's checks run.

The owner merges manually if the contribution is accepted. After it is merged & recorded, it becomes
permanent History, the site version advances, & your participation for the season is complete.
Deployment timing is separate.

## if you want to read more rules

The practical stuff is above. These are a few extra things worth knowing:

- This is a public GitHub project. Your pull request, commits, GitHub identity, code changes, & review
  discussion may be publicly visible.
- Do not add analytics, tracking pixels, persistent visitor tracking, or collect or transmit visitor
  data without maintainer approval.
- If your idea requires a secret, backend service, persistent server-side storage, paid external
  service, or another change outside the editable canvas, ask the maintainer first.
- Only submit code, media, & other material that you created or have the right to use.
- If you discover a security vulnerability, report it privately rather than publishing exploit
  details or testing against production without permission. See `SECURITY.md`.
- If you accidentally commit a real secret or credential, treat it as exposed & contact the
  maintainer immediately. Removing it in a later commit is not enough.

### your contribution & ownership

You keep ownership of the original work you create.

If your contribution is accepted & merged, you give Who Touched This permanent permission to use,
display, modify, archive, reproduce, redistribute, preserve, & promote it as part of the project.
That includes preserving it in History & snapshots and allowing the site to keep evolving after your
turn.

Submitting a contribution means you agree to these contributor terms.