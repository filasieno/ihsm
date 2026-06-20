# Releasing ihsm

## Prerequisites

- [Nix](https://nixos.org/download/) with flakes enabled
- GitHub repo **`filasieno/ihsm`** push access
- npm publish access for **`ihsm`**, **`@ihsm/core`**, and **`@ihsm/otel`**
- **npm CI auth:** [Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) (OIDC) only — **no `NPM_TOKEN` GitHub secret**. Configure on each package → **Trusted publishing** → `filasieno/ihsm`, workflow **`release.yml`**.

## Pre-release checklist

Run locally on **`dev`**, then merge to **`master`** when green:

```shell
nix flake check
nix build .#release
```

`nix flake check` builds and tests **`ihsm`**, **`@ihsm/core`**, and **`@ihsm/otel`**, runs lint, and builds docs. `nix build .#release` stages all three publish trees under `result/{ihsm,core,otel}/`.

Optional local sanity (outside Nix):

```shell
bash packages/ihsm/scripts/verify-docs-site.sh packages/ihsm/docs-build
```

`nix flake check` already runs `scripts/verify-no-generated-in-source.sh` (via the
`lint` and `docs` derivations), so no separate generated-artifact check is needed.

Confirm **`packages/ihsm/package.json`**, **`packages/core/package.json`**, and **`packages/otel/package.json`** **`version`** values all match the tag you will push (`0.1.23` → tag `0.1.23`, no `v` prefix). Bump **patch +1** each release (`0.1.23` → `0.1.24`); stay on **`0.1.x`** — do not jump to **`0.2.0`** until a deliberate minor release. `@ihsm/core` depends on the same `ihsm` version; `@ihsm/otel` peer-depends on `ihsm` ≥ that version.

Update **`CHANGELOG.md`** in each published package for the new version.

**Do not** run `npm run sync:docs` for commit — generated docs are built in CI/Nix only.
Edit sources: `examples/`, `reference/REFERENCE.md`, `website/docs-src/`.

## Publish

1. Merge **`dev`** → **`master`** and push:

   ```shell
   git push upstream master
   ```

   Docs deploy automatically via `.github/workflows/docs.yml`.

2. Tag and push the release:

   ```shell
   git tag 0.1.23
   git push upstream 0.1.23
   ```

3. **Release workflow** (`.github/workflows/release.yml`) runs on the tag:
   - `nix flake check` (build, test, lint, docs for all packages)
   - `nix build .#release` (deterministic publish artifacts)
   - `npm publish` in order: **`ihsm`** → **`@ihsm/core`** → **`@ihsm/otel`** (Trusted Publishing / OIDC)
   - GitHub Release with auto-generated notes

Configure **Trusted publishing** on npm for all three packages (`ihsm`, `@ihsm/core`, `@ihsm/otel`), same repo/workflow (`release.yml`).

| Package | npm |
|---------|-----|
| `ihsm` | [npmjs.com/package/ihsm](https://www.npmjs.com/package/ihsm) |
| `@ihsm/core` | [npmjs.com/package/@ihsm/core](https://www.npmjs.com/package/@ihsm/core) |
| `@ihsm/otel` | [npmjs.com/package/@ihsm/otel](https://www.npmjs.com/package/@ihsm/otel) |

## Badges (README)

After the first push to `master` post-release:

| Badge | Source |
|-------|--------|
| CI | GitHub Actions `ci.yml` on `master` |
| docs | GitHub Actions `docs.yml` on `master` |
| Coverage | Coveralls — uploaded from CI (push only); `nyc check-coverage` gates ≥94% lines |
| npm | Updates after `npm publish` |
| License | GitHub license API |

If Coveralls shows *unknown*, open [coveralls.io/github/filasieno/ihsm](https://coveralls.io/github/filasieno/ihsm) and ensure the repo is activated; CI must complete a push to `master` with a green coverage upload.

## npm authentication (CI vs local)

| Context | What to use |
|---------|-------------|
| **GitHub Actions** (`release.yml`) | Trusted Publishing (OIDC) only — delete **`NPM_TOKEN`** from GitHub secrets |
| **Your laptop** | Normal npm login + 2FA (authenticator / passkey) when publishing interactively |

**Do not** add a GitHub job to enter OTP from an authenticator — npm does not support that for automation. OTP is only for interactive sessions.

### Trusted Publishing (recommended)

Configure on **each package**, not only your npm account:

1. Log in at the package page (you must be a maintainer).
2. **Settings** (package settings, top tab) → scroll to **Trusted publishing**.
3. Click **GitHub Actions**.
4. Fill in **exactly** (case-sensitive):

   | Field | Value |
   |-------|--------|
   | Repository owner | `filasieno` |
   | Repository name | `ihsm` |
   | Workflow filename | `release.yml` |
   | Environment | *(leave empty)* unless you use a GitHub Environment |

5. **Allowed actions**: enable **`npm publish`**.
6. Save — repeat for `ihsm`, `@ihsm/core`, and `@ihsm/otel`.

7. **`package.json`** must contain a `repository` field pointing at `https://github.com/filasieno/ihsm.git` with the correct `directory` for scoped packages.

8. **GitHub** (`filasieno/ihsm` → Settings → Secrets): **delete `NPM_TOKEN`** (or leave unset).

9. Push the current `release.yml` (Node 24 `setup-node`, **no** `NODE_AUTH_TOKEN`).

10. Re-run: Actions → **Release** → **Run workflow** with the release tag after bumping all `package.json` versions.

**Scoped packages (`@ihsm/core`, `@ihsm/otel`):** if `ihsm` publishes but scoped packages fail with `ENEEDAUTH`, Trusted Publishing is missing on that scoped package — configure it on **each** package page (not only `ihsm`). Until then, publish interactively with 2FA: `npm publish --access public --ignore-scripts` from `packages/core` and `packages/otel` after `nix build .#release`.

## Manual npm publish (fallback)

```shell
nix flake check
nix build .#release -o result
# publish from packages/* after copying result/*/lib (see release workflow)
cd packages/ihsm && npm publish --access public --ignore-scripts
cd packages/core && npm publish --access public --ignore-scripts
cd packages/otel && npm publish --access public --ignore-scripts
```

Use only if the release workflow is unavailable. Interactive 2FA applies on your machine. Publish **`ihsm` first**, then **`@ihsm/core`**, then **`@ihsm/otel`**.

## Maintainer

Fabio Nicola Filasieno — `fabio.filasieno@users.noreply.github.com` (GitHub noreply).
