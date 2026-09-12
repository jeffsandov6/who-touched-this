# Pre-merge contributor review

This is the maintainer guide for pre-merge canvas review. The visual artifact is temporary evidence,
not the permanent History snapshot. Permanent snapshots still use the actual merged canonical commit.

## Trusted orchestration

`Contribution boundary` runs on `pull_request_target` from trusted base code. It checks only GitHub
metadata, never checks out the PR head, never runs npm or contributor code, and has only
`contents: read` and `pull-requests: read`. After a successful full-diff validation it creates a tiny
artifact containing the event-derived PR number, base repository/SHA, and head repository/SHA.

`Contributor review` runs on `workflow_run` only after that named boundary workflow succeeds. GitHub
loads its workflow definition from the default branch, not from the pull request. It has explicit
`actions: read`, `contents: read`, and `pull-requests: read` permissions. It downloads the handoff
only from the triggering run ID, validates its exact schema, confirms that the triggering run was a
successful `pull_request_target` run, rejects any conflicting workflow-run PR association, and
cross-checks every field against the current open pull request through the base-repository Pull Request API. (`workflow_run` can
omit PR associations for `pull_request_target`, so the trusted triggering-run artifact plus API
identity is authoritative.) Missing, stale, ambiguous, or mismatched data fails closed.

The review workflow sparsely fetches only `src/canvas` from the base repository's `refs/pull/N/head`.
Trusted code verifies the checkout HEAD equals the validated head SHA and reads regular blobs by Git
object ID. It rejects traversal, symlink, gitlink, non-blob, malformed, oversized, or excessive trees.
The complete overlaid canvas is capped at 2,000 regular files and 75 MiB; ordinary changed-file and
media limits remain stricter where applicable.
It creates the proposed workspace by copying the exact trusted base and replacing only
`src/canvas/**`. Package manifests, platform code, workflows, tests, scripts, Firebase configuration,
and deployment code always come from the base SHA.

## Dependencies and hostile execution

`npm ci` runs on the GitHub host after the proposed workspace is copied from the trusted base but
before contributor canvas files are overlaid. Its `package.json`, lockfile, and lifecycle scripts are
therefore trusted base versions. Trusted code compares both manifests again after overlay.

Astro renders canvas TSX in Node. Check, both builds, and fast tests therefore execute inside a Docker
container with:

- network namespace disabled (`--network none`)
- no GitHub token, Actions runtime credential, repository/environment secret, Firebase configuration,
  Resend key, webhook secret, service account, proxy variable, or Docker socket passed inside
- numeric non-root UID/GID `1001:1001`
- read-only container root filesystem, all Linux capabilities dropped, and `no-new-privileges`
- 4 GiB memory and memory+swap ceiling, 2 CPUs, 256 PIDs, and a 25 MiB process file-size limit
- a 1 GiB `noexec,nosuid,nodev` temporary filesystem
- an eight-minute inner phase timeout, ten-second forced termination grace, `--rm`, and a twelve-minute
  outer GitHub job timeout

The writable proposed workspace is disposable. The trusted checkout is not mounted into this build
container. When the container stops, trusted host code validates and copies only approved regular
`dist` files into a fresh staging directory.

## Deterministic source scanner

Trusted scanner code examines changed regular text files beneath `src/canvas/**` before execution.
Hard failures are direct `eval`, `Function` construction, literal script injection, literal
`javascript:` URLs, remote dynamic imports, unsafe file types, and source beyond 25 MiB. Warnings cover
raw HTML APIs, network APIs, embeds/forms/external navigation, browser storage/cookies, unusually large
encoded data, dense/minified-looking lines, and source over 2 MiB.

The scanner is heuristic review assistance, not a security boundary. It has false positives and false
negatives. Computed properties, aliases, string assembly, imported indirection, encoding, and other
obfuscation can bypass it. Review every warning and the actual source diff.

## Visual preview and artifact bounds

Before upload and again after download, trusted code rejects artifact traversal, unsafe/control
filenames, symlinks, hard links, FIFO/device/socket and other non-regular objects, more than 20,000
files, any file over 25 MiB, or more than 250 MiB total. It copies approved files into a new directory;
the hostile build never owns the final manifest, viewer, or BEFORE screenshots.

The exact base is copied to a disposable workspace, installs from the same trusted manifests, and its
canvas build also runs in the networkless build container; accepted historical canvas code is not
executed directly on the runner host. The host separately installs the preview runtime with
`npm ci --ignore-scripts` in the exact trusted base checkout. That checkout, including its lockfile-
pinned `playwright` package, is mounted read-only so the preview script can resolve its Node dependency;
the Playwright image itself is used only for its browser/runtime environment. BEFORE and PROPOSED AFTER render inside a separate official Playwright container with container networking disabled, a read-only trusted checkout, read-only base and proposed builds, no credentials, the same privilege/resource restrictions, and a seven-minute inner timeout.
Playwright container with container networking disabled, a read-only trusted checkout, read-only base
and proposed builds, no credentials, the same privilege/resource restrictions, and a seven-minute
inner timeout. Playwright additionally blocks service workers, WebSockets, and non-preview HTTP(S).

Every canonical route uses a 30-second navigation timeout, 30-second action/screenshot timeout,
maximum 20,000-pixel document height, and maximum 32 million screenshot pixels. The outer visual job
has a ten-minute timeout. Synchronous loops or resource exhaustion may cause a failed preview, never an
unbounded workflow.

On a maintainer machine with Docker running, `npm run test:pr-review:network` starts a disposable host
HTTP server and proves a `--network none` hostile container cannot reach it. This probe is separate
from ordinary unit tests so local contributors are not required to run Docker.

Download `pr-<number>-visual-review` and open `index.html`. It shows every canonical route as BEFORE
versus PROPOSED AFTER. Trusted code records the validated PR/base/head identity, routes, settings,
capture time, and screenshot checksums in `manifest.json`.

## Action pins

Security-sensitive Actions use immutable reviewed commit pins. Comments beside each use preserve the
corresponding upstream version:

- `actions/checkout` 6.0.3 — `9f698171ed81b15d1823a05fc7211befd50c8ae0`
- `actions/setup-node` 7.0.0 — `820762786026740c76f36085b0efc47a31fe5020`
- `actions/upload-artifact` 7.0.1 — `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`
- `actions/download-artifact` 8.0.0 — `70fc10c6e5e1ce46ad2ea6f2b72d43f7d47b13c3`

Review upstream security/runtime support before updating a pin.

Sandbox images are also immutable OCI-index pins:

- `node:22.23.1-bookworm-slim` — `sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3`
- `mcr.microsoft.com/playwright:v1.55.0-noble` — `sha256:b27e719ecbfef153e13fd24e8341736733bf2658b229677eb21ff57ff5d7fb29`

## Repository settings required before launch

YAML cannot enforce repository-level fork settings. In **Settings → Actions → General**, verify:

- fork pull-request workflows do not receive write-capable `GITHUB_TOKEN`s
- fork pull-request workflows do not receive repository secrets
- outside-contributor workflow approval remains required where applicable
- default workflow token permission is read-only
- Actions is restricted to GitHub-maintained actions or explicitly reviewed immutable pins

The hostile workflow is `workflow_run`, not a fork-provided workflow, so approval behavior should be
tested with a real outside fork before launch. Never add an environment or secrets to Contributor
review.

In branch rules/rulesets, require the actual base-owned `Contribution boundary / Trusted contribution
boundary` check. A plain `workflow_run` check is associated with its default-branch run rather than a
PR-head check, so do not claim it is a branch-protection status unless a real fork test proves that for
the selected GitHub ruleset. Treat the Contributor review artifact/run as a mandatory maintainer review
step. If GitHub organization rulesets offer a required workflow whose identity is controlled outside
the PR, use that for a required review status; otherwise a future minimal trusted status reporter would
need narrowly scoped write permission and a separate security design. Never accept an arbitrary status
context merely because it has a lookalike name. Require code-owner review for `.github/**`, keep those
paths contributor-protected, and test the final rule with a fork attempting a duplicate check name.

## Remaining limitations

- Static scanning cannot prove safety.
- A container/kernel/browser/runtime vulnerability could defeat isolation.
- Dependency installation remains networked but uses reviewed base manifests and code.
- Container and Action pins require deliberate periodic security/runtime updates.
- Artifact action extraction occurs before post-download validation; immutable action pins and a
  second clean-copy validation reduce but do not eliminate action/runtime vulnerabilities.
- Resource attacks can fail a job within its limits; CI availability is not guaranteed.
- Screenshots cover one frame and do not prove interaction, accessibility, privacy, or security.
