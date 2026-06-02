# Releasing ihsm

## Prerequisites

- [Nix](https://nixos.org/download/) with flakes enabled
- GitHub repo **`filasieno/ihsm`** push access
- npm **`ihsm`** publish access
- **npm CI auth:** [Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) (OIDC) only — **no `NPM_TOKEN` GitHub secret**. Configure on [npmjs.com/package/ihsm](https://www.npmjs.com/package/ihsm) → **Trusted publishing** → `filasieno/ihsm`, workflow **`release.yml`**.
- **Local publishes** (your machine): use WebAuthn/passkey or the npm authenticator app when `npm publish` asks for 2FA — that is separate from CI.

## Pre-release checklist

Run locally on **`dev`**, then merge to **`master`** when green:

```shell
nix flake check
nix build .#docs
bash packages/ihsm/scripts/verify-docs-site.sh packages/ihsm/docs-build
```

`nix flake check` already runs `scripts/verify-no-generated-in-source.sh` (via the
`lint` and `docs` derivations), so no separate generated-artifact check is needed.

Confirm `packages/ihsm/package.json` **`version`** matches the tag you will push (`0.0.21` → tag `0.0.21`, no `v` prefix).

Update **`CHANGELOG.md`** for the new version.

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
   git tag 0.0.21
   git push upstream 0.0.21
   ```

3. **Release workflow** (`.github/workflows/release.yml`) runs on the tag:
   - full test suite + lint + docs
   - `npm publish` via Trusted Publishing (OIDC; provenance automatic) → [npmjs.com/package/ihsm](https://www.npmjs.com/package/ihsm)
   - GitHub Release with auto-generated notes

## Badges (README)

After the first push to `master` post-release:

| Badge | Source |
|-------|--------|
| CI | GitHub Actions `ci.yml` on `master` |
| docs | GitHub Actions `docs.yml` on `master` |
| Coverage | Coveralls — uploaded from CI (push only) |
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

Configure on the **package**, not only your npm account:

1. Log in at https://www.npmjs.com/package/ihsm (you must be a maintainer).
2. **Settings** (package settings, top tab) → scroll to **Trusted publishing**.
3. Click **GitHub Actions** (not “Connect to GitLab” etc.).
4. Fill in **exactly** (case-sensitive; npm does not validate until publish time):

   | Field | Value |
   |-------|--------|
   | Repository owner | `filasieno` |
   | Repository name | `ihsm` |
   | Workflow filename | `release.yml` |
   | Environment | *(leave empty)* unless you use a GitHub Environment |

5. **Allowed actions**: enable **`npm publish`** (required on configs created after 2026-05-20).
6. Save.

7. **`package.json`** must already contain:

   ```json
   "repository": {
     "type": "git",
     "url": "https://github.com/filasieno/ihsm.git"
   }
   ```

8. **GitHub** (`filasieno/ihsm` → Settings → Secrets): **delete `NPM_TOKEN`** (or leave unset). A stored publish token makes npm ask for OTP (`EOTP`) even if Trusted Publishing is configured.

9. Push the current `release.yml` (Node 24 `setup-node`, **no** `NODE_AUTH_TOKEN`, no `_authToken` in `.npmrc` during publish).

10. Re-run: Actions → **Release** → **Run workflow** with the release tag after bumping `package.json` version.

11. Optional hardening (after first green OIDC publish): package **Settings** → **Publishing access** → *Require two-factor authentication and disallow tokens*.

#### Why you saw `EOTP` with provenance still working

Those log lines are **two different auth paths**:

| Log line | Mechanism |
|----------|-----------|
| `Signed provenance statement… from GitHub Actions` | Sigstore OIDC (`id-token: write`) — works without Trusted Publishing |
| `EOTP` / one-time password | **npm publish** used your **`NPM_TOKEN`** (or `.npmrc` `_authToken`) — token auth + account 2FA |

Trusted Publishing was **not** used for the publish step if `NPM_TOKEN` was set in the workflow or `.npmrc`. The workflow on `master` until updated also used `nix develop` + `NPM_TOKEN` (npm 10.x), which cannot do OIDC publish.

#### If publish still fails after setup

| Error | Check |
|-------|--------|
| `EOTP` | Remove GitHub secret `NPM_TOKEN`; ensure workflow has **no** `NODE_AUTH_TOKEN`; re-run **Release** workflow file `release.yml` |
| `ENEEDAUTH` | Trusted publisher workflow name must be `release.yml`; repo `filasieno/ihsm`; use `ubuntu-latest` (not self-hosted) |
| Wrong version published | `workflow_dispatch` must checkout the tag (fixed in `release.yml` `ref:` on checkout) |

The release workflow uses `actions/setup-node` with Node 24 so npm ≥ 11.5 can exchange the GitHub OIDC token automatically. **Do not** add `NPM_TOKEN` to GitHub — the workflow will refuse token-based publish paths.

## Manual npm publish (fallback)

```shell
nix flake check
nix develop --command npm publish --access public
```

Use only if the release workflow is unavailable. Interactive 2FA (authenticator) applies on your machine.

## Maintainer

Fabio Nicola Filasieno — `fabio.filasieno@users.noreply.github.com` (GitHub noreply).
